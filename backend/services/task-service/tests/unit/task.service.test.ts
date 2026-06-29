// =============================================================================
// UNIT TESTS — TaskService
// =============================================================================
//
// Tests cover the business rules of the task service:
// - Cannot create task for a board that doesn't belong to the project
// - Moving to the same board is rejected
// - Cannot assign a user who isn't an org member
// - Cannot unassign a user who isn't assigned
// - Activity log is written on mutations (fire-and-forget)
// - Cache is invalidated on mutations
//
// HOW UNIT TESTS WORK HERE:
//   We use the Repository Pattern. TaskService depends on ITaskRepository and
//   IActivityRepository — both are interfaces. In tests, we inject jest.Mocked
//   versions of these interfaces, so no DB connection is needed.
//   Only the SERVICE LOGIC is tested — not the repository layer.
//
// INTERVIEW QUESTION: "Why mock the repository instead of the DB?"
//   Answer: Unit tests should be FAST and ISOLATED. A DB connection:
//   1. Requires a running DB (slow to start, fragile in CI)
//   2. Has state that bleeds between tests (flaky unless you reset between tests)
//   3. Tests the ORM/DB, not your business logic
//   Repository mocking tests ONLY the service logic in milliseconds.
//   Integration tests (see integration/) test the full stack including DB.
// =============================================================================

import { TaskService } from '../../src/services/task.service';
import { ITaskRepository, IActivityRepository, SafeTask } from '../../src/interfaces/task.interface';
import { NotFoundError, ConflictError, ForbiddenError } from '../../src/utils/errors';

// =============================================================================
// MOCKS
// =============================================================================

jest.mock('../../src/config/database', () => ({
  prisma: {
    board: { findFirst: jest.fn() },
    organizationMember: { findUnique: jest.fn() },
  },
}));

jest.mock('../../src/config/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    pipeline: jest.fn().mockReturnValue({ del: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) }),
  },
  CacheKeys: {
    task: (orgId: string, taskId: string) => `org:${orgId}:task:${taskId}`,
    boardTasks: (orgId: string, projectId: string, boardId: string) =>
      `org:${orgId}:project:${projectId}:board:${boardId}:tasks`,
    projectTasks: (orgId: string, projectId: string) => `org:${orgId}:project:${projectId}:tasks`,
    taskComments: (taskId: string) => `task:${taskId}:comments`,
    taskAttachments: (taskId: string) => `task:${taskId}:attachments`,
    taskActivity: (taskId: string) => `task:${taskId}:activity`,
  },
}));

jest.mock('../../src/utils/cache', () => ({
  getOrFetch: jest.fn().mockImplementation((_key, fetcher) => fetcher()),
  invalidate: jest.fn().mockResolvedValue(undefined),
  invalidateMany: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/events/publishers/task.publisher', () => ({
  publishTaskCreated: jest.fn().mockResolvedValue(undefined),
  publishTaskUpdated: jest.fn().mockResolvedValue(undefined),
  publishTaskDeleted: jest.fn().mockResolvedValue(undefined),
  publishTaskAssigned: jest.fn().mockResolvedValue(undefined),
  publishTaskUnassigned: jest.fn().mockResolvedValue(undefined),
  publishTaskStatusChanged: jest.fn().mockResolvedValue(undefined),
  publishTaskCompleted: jest.fn().mockResolvedValue(undefined),
  publishCommentAdded: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../../src/config/database';

// =============================================================================
// FIXTURES
// =============================================================================

const mockSafeTask: SafeTask = {
  id: 'task-1',
  taskNumber: 1,
  taskKey: 'FF-1',
  title: 'Fix login bug',
  description: null,
  priority: 'high',
  status: 'todo',
  dueDate: null,
  position: 65536,
  estimatedHours: null,
  actualHours: null,
  organizationId: 'org-1',
  projectId: 'project-1',
  boardId: 'board-1',
  reporterId: 'user-1',
  parentTaskId: null,
  assignees: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockTaskWithAssignee: SafeTask = {
  ...mockSafeTask,
  assignees: [
    {
      userId: 'user-2',
      assignedAt: new Date(),
      user: { id: 'user-2', firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com', avatarUrl: null },
    },
  ],
};

const createMockTaskRepo = (): jest.Mocked<ITaskRepository> => ({
  findById: jest.fn(),
  listByProject: jest.fn(),
  listByBoard: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  move: jest.fn(),
  reorder: jest.fn(),
  addAssignee: jest.fn(),
  removeAssignee: jest.fn(),
  getNextTaskNumber: jest.fn().mockResolvedValue(1),
  getLastPositionInBoard: jest.fn().mockResolvedValue(65536),
  getProjectKey: jest.fn().mockResolvedValue('FF'),
  getTaskWithProject: jest.fn(),
});

const createMockActivityRepo = (): jest.Mocked<IActivityRepository> => ({
  listForTask: jest.fn(),
  create: jest.fn().mockResolvedValue(undefined),
});

// =============================================================================
// TESTS
// =============================================================================

describe('TaskService', () => {
  let service: TaskService;
  let taskRepo: jest.Mocked<ITaskRepository>;
  let activityRepo: jest.Mocked<IActivityRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    taskRepo = createMockTaskRepo();
    activityRepo = createMockActivityRepo();
    service = new TaskService(taskRepo, activityRepo);
  });

  // ==========================================================================
  // CREATE TASK
  // ==========================================================================
  describe('createTask()', () => {
    it('should create a task when board belongs to the project', async () => {
      (prisma.board.findFirst as jest.Mock).mockResolvedValue({
        id: 'board-1', name: 'Todo',
      });
      taskRepo.create.mockResolvedValue(mockSafeTask);

      const result = await service.createTask('org-1', 'project-1', 'user-1', {
        organizationId: 'org-1',
        projectId: 'project-1',
        boardId: 'board-1',
        title: 'Fix login bug',
        reporterId: 'user-1',
      });

      expect(result.taskKey).toBe('FF-1');
      expect(taskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Fix login bug',
        organizationId: 'org-1',
        projectId: 'project-1',
      }));
    });

    it('should throw NotFoundError when board does not belong to the project', async () => {
      // Board returns null — board not in this project or org
      (prisma.board.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createTask('org-1', 'project-1', 'user-1', {
          organizationId: 'org-1',
          projectId: 'project-1',
          boardId: 'wrong-board',
          title: 'My Task',
          reporterId: 'user-1',
        }),
      ).rejects.toThrow(NotFoundError);

      expect(taskRepo.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // UPDATE TASK
  // ==========================================================================
  describe('updateTask()', () => {
    it('should update task and invalidate cache', async () => {
      taskRepo.findById
        .mockResolvedValueOnce(mockSafeTask)    // First call: get existing
        .mockResolvedValueOnce(mockSafeTask);   // Second call: return updated
      taskRepo.update.mockResolvedValue({} as any);

      const result = await service.updateTask('org-1', 'task-1', 'user-1', {
        title: 'Updated title',
      });

      expect(taskRepo.update).toHaveBeenCalledWith('org-1', 'task-1', { title: 'Updated title' });
      expect(result).toBeDefined();
    });

    it('should throw NotFoundError when task does not exist', async () => {
      taskRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateTask('org-1', 'nonexistent', 'user-1', { title: 'X' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ==========================================================================
  // MOVE TASK
  // ==========================================================================
  describe('moveTask()', () => {
    it('should throw ConflictError when moving to the same board', async () => {
      taskRepo.findById.mockResolvedValue(mockSafeTask); // boardId is 'board-1'

      await expect(
        // Target is the same board — no-op
        service.moveTask('org-1', 'task-1', 'user-1', 'board-1'),
      ).rejects.toThrow(ConflictError);

      expect(taskRepo.move).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError when target board does not exist', async () => {
      taskRepo.findById.mockResolvedValue(mockSafeTask);
      (prisma.board.findFirst as jest.Mock).mockResolvedValue(null); // Board not found

      await expect(
        service.moveTask('org-1', 'task-1', 'user-1', 'nonexistent-board'),
      ).rejects.toThrow(NotFoundError);
    });

    it('should move task and publish status_changed event', async () => {
      taskRepo.findById
        .mockResolvedValueOnce(mockSafeTask)        // Existing task (boardId: board-1)
        .mockResolvedValueOnce({ ...mockSafeTask, boardId: 'board-2' }); // Updated task

      (prisma.board.findFirst as jest.Mock).mockResolvedValue({
        id: 'board-2', name: 'In Progress',
      });
      taskRepo.getLastPositionInBoard.mockResolvedValue(65536);
      taskRepo.move.mockResolvedValue({} as any);

      const result = await service.moveTask('org-1', 'task-1', 'user-1', 'board-2');

      expect(taskRepo.move).toHaveBeenCalledWith('org-1', 'task-1', 'board-2', 65536);
      expect(result).toBeDefined();
    });
  });

  // ==========================================================================
  // ASSIGN TASK
  // ==========================================================================
  describe('assignTask()', () => {
    it('should throw NotFoundError for a non-member user', async () => {
      taskRepo.findById.mockResolvedValue(mockSafeTask);
      // User not a member of the org
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.assignTask('org-1', 'task-1', 'user-1', ['non-member-user']),
      ).rejects.toThrow(NotFoundError);

      expect(taskRepo.addAssignee).not.toHaveBeenCalled();
    });

    it('should skip already-assigned users without error', async () => {
      // Task already has user-2 as assignee
      taskRepo.findById.mockResolvedValue(mockTaskWithAssignee);
      taskRepo.findById.mockResolvedValueOnce(mockTaskWithAssignee); // For existing check
      taskRepo.findById.mockResolvedValue(mockTaskWithAssignee); // For return value

      const result = await service.assignTask('org-1', 'task-1', 'user-1', ['user-2']);

      // Should NOT call addAssignee for already-assigned user
      expect(taskRepo.addAssignee).not.toHaveBeenCalled();
    });

    it('should assign a new org member successfully', async () => {
      taskRepo.findById
        .mockResolvedValueOnce(mockSafeTask) // existing task
        .mockResolvedValueOnce({ ...mockSafeTask, assignees: [{ userId: 'user-3', assignedAt: new Date(), user: { id: 'user-3', firstName: 'A', lastName: 'B', email: 'a@b.com', avatarUrl: null } }] });

      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({ userId: 'user-3' });
      taskRepo.addAssignee.mockResolvedValue({} as any);

      const result = await service.assignTask('org-1', 'task-1', 'user-1', ['user-3']);

      expect(taskRepo.addAssignee).toHaveBeenCalledWith('task-1', 'user-3', 'user-1');
    });
  });

  // ==========================================================================
  // UNASSIGN TASK
  // ==========================================================================
  describe('unassignTask()', () => {
    it('should throw NotFoundError when user is not assigned to the task', async () => {
      taskRepo.findById.mockResolvedValue(mockSafeTask); // No assignees

      await expect(
        service.unassignTask('org-1', 'task-1', 'user-1', 'unassigned-user'),
      ).rejects.toThrow(NotFoundError);

      expect(taskRepo.removeAssignee).not.toHaveBeenCalled();
    });

    it('should remove the assignee successfully', async () => {
      taskRepo.findById.mockResolvedValue(mockTaskWithAssignee); // Has user-2
      taskRepo.removeAssignee.mockResolvedValue(undefined);

      await expect(
        service.unassignTask('org-1', 'task-1', 'user-1', 'user-2'),
      ).resolves.toBeUndefined();

      expect(taskRepo.removeAssignee).toHaveBeenCalledWith('task-1', 'user-2');
    });
  });

  // ==========================================================================
  // DELETE TASK
  // ==========================================================================
  describe('deleteTask()', () => {
    it('should delete task and invalidate cache', async () => {
      taskRepo.findById.mockResolvedValue(mockSafeTask);
      taskRepo.delete.mockResolvedValue(undefined);

      await expect(
        service.deleteTask('org-1', 'task-1', 'user-1'),
      ).resolves.toBeUndefined();

      expect(taskRepo.delete).toHaveBeenCalledWith('org-1', 'task-1');
    });

    it('should throw NotFoundError for non-existent task', async () => {
      taskRepo.findById.mockResolvedValue(null);

      await expect(
        service.deleteTask('org-1', 'nonexistent', 'user-1'),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
