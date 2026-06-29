// =============================================================================
// NOTIFICATION ROUTES — Integration Tests
// =============================================================================
//
// Tests the full HTTP request → middleware → controller → service stack.
// Prisma and Redis are mocked at the module level.
//
// WHAT WE VERIFY:
//   - Authentication middleware rejects missing/invalid tokens
//   - Validation middleware rejects malformed query params
//   - GET /notifications returns paginated list with correct status
//   - GET /notifications/unread-count serves cached value
//   - PUT /notifications/:id/read returns updated notification
//   - PUT /notifications/read-all returns count
//   - DELETE /notifications/:id returns 204
//   - DELETE /notifications returns bulk delete count
//   - 404 for unknown routes
//
// JWT SIGNING:
//   Tests sign JWTs with the same secret as the test env (setup.ts).
//   This exercises the real JWT verification middleware, not a stub.
// =============================================================================

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../src/app';

// =============================================================================
// MOCK PRISMA — prevents real DB connections
// =============================================================================
jest.mock('@prisma/client', () => {
  const notification = {
    id: 'notif-uuid-1',
    organizationId: 'org-uuid-1',
    recipientId: 'user-uuid-1',
    type: 'TASK_ASSIGNED',
    title: 'Assigned to FF-42',
    message: "You've been assigned.",
    metadata: { taskId: 'task-uuid-1', taskKey: 'FF-42' },
    isRead: false,
    readAt: null,
    createdAt: new Date(),
  };

  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      notification: {
        findMany: jest.fn().mockResolvedValue([notification]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(notification),
        findFirst: jest.fn().mockResolvedValue(notification),
        create: jest.fn().mockResolvedValue(notification),
        update: jest.fn().mockResolvedValue({ ...notification, isRead: true, readAt: new Date() }),
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    })),
    Prisma: {
      PrismaClientKnownRequestError: class extends Error {
        code: string;
        meta: unknown;
        constructor(message: string, opts: { code: string; clientVersion: string; meta?: unknown }) {
          super(message);
          this.code = opts.code;
          this.meta = opts.meta;
        }
      },
    },
  };
});

// =============================================================================
// MOCK IOREDIS — prevents real Redis connections
// =============================================================================
jest.mock('ioredis', () => {
  const mockRedis = {
    get: jest.fn().mockResolvedValue(null),  // default: cache miss
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  };
  return jest.fn(() => mockRedis);
});

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test' }),
  })),
}));

// =============================================================================
// HELPERS
// =============================================================================

const TEST_JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
const ORG_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const USER_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const NOTIF_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';

function makeToken(userId = USER_ID): string {
  return jwt.sign(
    { sub: userId, email: 'test@example.com' },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', issuer: 'flowforge-auth', audience: 'flowforge-api', expiresIn: '15m' },
  );
}

// =============================================================================
// TESTS
// =============================================================================

describe('Notification Routes Integration', () => {
  let token: string;

  beforeAll(() => {
    token = makeToken();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // AUTHENTICATION GUARD
  // ==========================================================================

  describe('Authentication', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app)
        .get(`/api/v1/notifications?orgId=${ORG_ID}`)
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 for an invalid JWT token', async () => {
      const res = await request(app)
        .get(`/api/v1/notifications?orgId=${ORG_ID}`)
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // ==========================================================================
  // GET /notifications
  // ==========================================================================

  describe('GET /api/v1/notifications', () => {
    it('returns 400 when orgId is missing', async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when orgId is not a valid UUID', async () => {
      const res = await request(app)
        .get('/api/v1/notifications?orgId=not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns paginated notifications with 200', async () => {
      const res = await request(app)
        .get(`/api/v1/notifications?orgId=${ORG_ID}&page=1&limit=20`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toMatchObject({
        page: 1,
        limit: 20,
        total: expect.any(Number),
        totalPages: expect.any(Number),
      });
    });

    it('filters by isRead=false (unread only)', async () => {
      const res = await request(app)
        .get(`/api/v1/notifications?orgId=${ORG_ID}&isRead=false`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ==========================================================================
  // GET /notifications/unread-count
  // ==========================================================================

  describe('GET /api/v1/notifications/unread-count', () => {
    it('returns unread count from DB (cache miss)', async () => {
      const res = await request(app)
        .get(`/api/v1/notifications/unread-count?orgId=${ORG_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.count).toBe('number');
    });

    it('returns 400 when orgId is missing', async () => {
      await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  // ==========================================================================
  // PUT /notifications/read-all
  // ==========================================================================

  describe('PUT /api/v1/notifications/read-all', () => {
    it('marks all notifications as read and returns count', async () => {
      const res = await request(app)
        .put(`/api/v1/notifications/read-all?orgId=${ORG_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.count).toBe('number');
    });
  });

  // ==========================================================================
  // PUT /notifications/:id/read
  // ==========================================================================

  describe('PUT /api/v1/notifications/:id/read', () => {
    it('marks a single notification as read', async () => {
      const res = await request(app)
        .put(`/api/v1/notifications/${NOTIF_ID}/read?orgId=${ORG_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isRead).toBe(true);
    });

    it('returns 400 when notification ID is not a valid UUID', async () => {
      const res = await request(app)
        .put(`/api/v1/notifications/not-a-uuid/read?orgId=${ORG_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // DELETE /notifications/:id
  // ==========================================================================

  describe('DELETE /api/v1/notifications/:id', () => {
    it('deletes a notification and returns 204 No Content', async () => {
      await request(app)
        .delete(`/api/v1/notifications/${NOTIF_ID}?orgId=${ORG_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
    });

    it('returns 400 for invalid UUID', async () => {
      await request(app)
        .delete(`/api/v1/notifications/bad-id?orgId=${ORG_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  // ==========================================================================
  // DELETE /notifications (bulk)
  // ==========================================================================

  describe('DELETE /api/v1/notifications', () => {
    it('deletes all notifications and returns count', async () => {
      const res = await request(app)
        .delete(`/api/v1/notifications?orgId=${ORG_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.count).toBe('number');
    });

    it('returns 400 when orgId is missing', async () => {
      await request(app)
        .delete('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  // ==========================================================================
  // 404 — Unknown routes
  // ==========================================================================

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app)
        .get('/api/v1/unknown-route')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ==========================================================================
  // Health check
  // ==========================================================================

  describe('GET /health', () => {
    it('returns service health status', async () => {
      const res = await request(app)
        .get('/health')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('notification-service');
    });
  });
});
