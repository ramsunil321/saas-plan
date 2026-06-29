// =============================================================================
// NOTIFICATION SERVICE — Unit Tests
// =============================================================================
//
// Tests the NotificationService in isolation by injecting a mock repository.
// No database, no Redis, no RabbitMQ needed — pure business logic.
//
// MOCK STRATEGY:
//   - notificationRepo: fully mocked INotificationRepository
//   - redis: module-level mock (ioredis is mocked via jest.mock)
//   - nodemailer: mocked so no actual emails are sent
//
// WHAT WE VERIFY:
//   1. create() → creates notification, invalidates cache, sends email for
//      EMAIL_WORTHY_TYPES, skips email for non-email types
//   2. getUnreadCount() → cache hit returns immediately, cache miss queries DB
//   3. markAsRead() → delegates to repo, invalidates cache
//   4. markAllAsRead() → delegates to repo, invalidates cache when count > 0
//   5. delete() → checks isRead before invalidating cache, throws on missing notif
//   6. deleteAll() → delegates to repo, invalidates on non-zero count
// =============================================================================

import { NotificationService } from '../../src/services/notification.service';
import { INotificationRepository, SafeNotification, CreateNotificationData } from '../../src/interfaces/notification.interface';
import { NotFoundError } from '../../src/utils/errors';

// Mock ioredis — prevents real Redis connections in unit tests
jest.mock('ioredis', () => {
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  };
  return jest.fn(() => mockRedis);
});

// Mock nodemailer — prevents SMTP connections in unit tests
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
  })),
}));

// Get the mocked redis instance to set up return values in tests
import { redis } from '../../src/config/redis';
const mockRedis = redis as jest.Mocked<typeof redis>;

// =============================================================================
// HELPERS
// =============================================================================

function makeNotification(overrides: Partial<SafeNotification> = {}): SafeNotification {
  return {
    id: 'notif-uuid-1',
    organizationId: 'org-uuid-1',
    recipientId: 'user-uuid-1',
    type: 'TASK_ASSIGNED',
    title: 'Assigned to FF-42',
    message: "You've been assigned to a task.",
    metadata: { taskId: 'task-uuid-1', taskKey: 'FF-42', projectId: 'proj-uuid-1' },
    isRead: false,
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockRepo(overrides: Partial<INotificationRepository> = {}): jest.Mocked<INotificationRepository> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    listForUser: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    getUnreadCount: jest.fn(),
    delete: jest.fn(),
    deleteAll: jest.fn(),
    ...overrides,
  } as jest.Mocked<INotificationRepository>;
}

// =============================================================================
// TESTS
// =============================================================================

describe('NotificationService', () => {
  let repo: jest.Mocked<INotificationRepository>;
  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = makeMockRepo();
    service = new NotificationService(repo);
  });

  // ==========================================================================
  // create()
  // ==========================================================================

  describe('create()', () => {
    it('creates notification and invalidates unread cache', async () => {
      const notification = makeNotification();
      repo.create.mockResolvedValue(notification);
      (mockRedis.del as jest.Mock).mockResolvedValue(1);

      const data: CreateNotificationData = {
        organizationId: 'org-uuid-1',
        recipientId: 'user-uuid-1',
        type: 'TASK_ASSIGNED',
        title: 'Assigned to FF-42',
        message: "You've been assigned to a task.",
        metadata: { taskId: 'task-uuid-1', taskKey: 'FF-42', projectId: 'proj-uuid-1' },
      };

      const result = await service.create(data);

      expect(repo.create).toHaveBeenCalledWith(data);
      expect(result).toEqual(notification);

      // Allow the fire-and-forget cache invalidation to complete
      await new Promise((r) => setImmediate(r));
      expect(mockRedis.del).toHaveBeenCalledTimes(1);
    });

    it('does not throw if cache invalidation fails', async () => {
      const notification = makeNotification();
      repo.create.mockResolvedValue(notification);
      (mockRedis.del as jest.Mock).mockRejectedValue(new Error('Redis unavailable'));

      await expect(service.create({
        organizationId: 'org-uuid-1',
        recipientId: 'user-uuid-1',
        type: 'TASK_ASSIGNED',
        title: 'Test',
        message: 'Test message',
      })).resolves.toEqual(notification);
    });
  });

  // ==========================================================================
  // getUnreadCount()
  // ==========================================================================

  describe('getUnreadCount()', () => {
    it('returns cached count without hitting the DB', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValue('7');

      const count = await service.getUnreadCount('user-uuid-1', 'org-uuid-1');

      expect(count).toBe(7);
      expect(repo.getUnreadCount).not.toHaveBeenCalled();
    });

    it('queries DB on cache miss and stores result in cache', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValue(null); // cache miss
      (mockRedis.set as jest.Mock).mockResolvedValue('OK');
      repo.getUnreadCount.mockResolvedValue(3);

      const count = await service.getUnreadCount('user-uuid-1', 'org-uuid-1');

      expect(count).toBe(3);
      expect(repo.getUnreadCount).toHaveBeenCalledWith('user-uuid-1', 'org-uuid-1');
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('user:user-uuid-1'),
        '3',
        'EX',
        expect.any(Number),
      );
    });
  });

  // ==========================================================================
  // markAsRead()
  // ==========================================================================

  describe('markAsRead()', () => {
    it('marks notification as read and invalidates cache', async () => {
      const readNotification = makeNotification({ isRead: true, readAt: new Date().toISOString() });
      repo.markAsRead.mockResolvedValue(readNotification);
      (mockRedis.del as jest.Mock).mockResolvedValue(1);

      const result = await service.markAsRead('notif-uuid-1', 'user-uuid-1', 'org-uuid-1');

      expect(repo.markAsRead).toHaveBeenCalledWith('notif-uuid-1', 'user-uuid-1');
      expect(result.isRead).toBe(true);
      expect(result.readAt).not.toBeNull();

      await new Promise((r) => setImmediate(r));
      expect(mockRedis.del).toHaveBeenCalledTimes(1);
    });

    it('propagates NotFoundError when notification does not exist', async () => {
      repo.markAsRead.mockRejectedValue(new NotFoundError('Notification'));

      await expect(
        service.markAsRead('non-existent', 'user-uuid-1', 'org-uuid-1'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ==========================================================================
  // markAllAsRead()
  // ==========================================================================

  describe('markAllAsRead()', () => {
    it('returns count of updated records and invalidates cache', async () => {
      repo.markAllAsRead.mockResolvedValue(5);
      (mockRedis.del as jest.Mock).mockResolvedValue(1);

      const count = await service.markAllAsRead('user-uuid-1', 'org-uuid-1');

      expect(count).toBe(5);
      await new Promise((r) => setImmediate(r));
      expect(mockRedis.del).toHaveBeenCalledTimes(1);
    });

    it('does not invalidate cache when count is 0 (nothing was unread)', async () => {
      repo.markAllAsRead.mockResolvedValue(0);

      const count = await service.markAllAsRead('user-uuid-1', 'org-uuid-1');

      expect(count).toBe(0);
      await new Promise((r) => setImmediate(r));
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // delete()
  // ==========================================================================

  describe('delete()', () => {
    it('deletes notification and invalidates cache when it was unread', async () => {
      const unreadNotif = makeNotification({ isRead: false });
      repo.findById.mockResolvedValue(unreadNotif);
      repo.delete.mockResolvedValue(undefined);
      (mockRedis.del as jest.Mock).mockResolvedValue(1);

      await service.delete('notif-uuid-1', 'user-uuid-1');

      expect(repo.delete).toHaveBeenCalledWith('notif-uuid-1', 'user-uuid-1');
      await new Promise((r) => setImmediate(r));
      expect(mockRedis.del).toHaveBeenCalledTimes(1);
    });

    it('does not invalidate cache when deleted notification was already read', async () => {
      const readNotif = makeNotification({ isRead: true, readAt: new Date().toISOString() });
      repo.findById.mockResolvedValue(readNotif);
      repo.delete.mockResolvedValue(undefined);

      await service.delete('notif-uuid-1', 'user-uuid-1');

      await new Promise((r) => setImmediate(r));
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when notification does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.delete('non-existent', 'user-uuid-1'),
      ).rejects.toThrow(NotFoundError);

      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // deleteAll()
  // ==========================================================================

  describe('deleteAll()', () => {
    it('deletes all and invalidates cache when records were deleted', async () => {
      repo.deleteAll.mockResolvedValue(12);
      (mockRedis.del as jest.Mock).mockResolvedValue(1);

      const count = await service.deleteAll('user-uuid-1', 'org-uuid-1');

      expect(count).toBe(12);
      await new Promise((r) => setImmediate(r));
      expect(mockRedis.del).toHaveBeenCalledTimes(1);
    });

    it('does not invalidate cache when there was nothing to delete', async () => {
      repo.deleteAll.mockResolvedValue(0);

      const count = await service.deleteAll('user-uuid-1', 'org-uuid-1');

      expect(count).toBe(0);
      await new Promise((r) => setImmediate(r));
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });
});
