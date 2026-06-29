// =============================================================================
// INTEGRATION TESTS — Task Routes
// =============================================================================
//
// Tests verify the full HTTP → service → (mocked) repository flow.
// Key things tested:
// - Authentication: unauthenticated requests get 401
// - RBAC: viewers cannot create/update/delete tasks
// - Validation: invalid bodies get 400
// - Task creation: returns 201 with task data
// - Board move: changes task's board
// - Route correctness: right status codes and response shapes
//
// WHAT'S MOCKED:
//   - Prisma (all DB calls)
//   - Redis (cache always misses in tests)
//   - RabbitMQ (no event publishing)
//   - logger
//   - multer (file uploads tested separately)
//
// HOW REAL JWTS ARE GENERATED:
//   Unlike auth-service tests that mock jwt.verify, here we generate REAL JWTs
//   signed with the test JWT_ACCESS_SECRET from tests/setup.ts.
//   This tests the actual JWT verification logic with valid tokens.
// =============================================================================

import request from 'supertest';
import app from '../../src/app';
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env';

// Mock all external dependencies
jest.mock('../../src/config/database', () => ({
  prisma: {
    board: { findFirst: jest.fn() },
    task: {
      findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
      update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(),
      deleteMany: jest.fn(), count: jest.fn(), aggregate: jest.fn(),
    },
    taskAssignee: {
      create: jest.fn(), deleteMany: jest.fn(), findUnique: jest.fn(),
    },
    comment: {
      findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
      update: jest.fn(), deleteMany: jest.fn(),
    },
    attachment: {
      findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn(),
    },
    activityLog: {
      findMany: jest.fn(), count: jest.fn(), create: jest.fn(),
    },
    project: { findFirst: jest.fn() },
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

jest.mock('../../src/config/rabbitmq', () => ({
  rabbitMQ: { getChannel: jest.fn().mockReturnValue(null), connect: jest.fn(), close: jest.fn() },
  EXCHANGE_NAME: 'flowforge.events',
  RoutingKeys: {},
  FlowForgeEvent: {},
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../../src/config/database';

// =============================================================================
// JWT TOKEN HELPERS
// =============================================================================

const generateToken = (userId: string, email = 'test@example.com') =>
  jwt.sign({ sub: userId, email }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    issuer: 'flowforge-auth',
    audience: 'flowforge-api',
    expiresIn: '15m',
  });

const DEVELOPER_TOKEN = generateToken('dev-id', 'dev@example.com');
const VIEWER_TOKEN = generateToken('viewer-id', 'viewer@example.com');

// =============================================================================
// MEMBERSHIP FIXTURES
// =============================================================================

const mockDeveloperMembership = {
  id: 'member-1', organizationId: 'org-1', userId: 'dev-id',
  role: 'developer', joinedAt: new Date(), invitedBy: null,
};

const mockViewerMembership = {
  ...mockDeveloperMembership, id: 'member-2', userId: 'viewer-id', role: 'viewer',
};

// =============================================================================
// TASK FIXTURE — Raw Prisma shape (what findFirst returns)
// =============================================================================

const now = new Date();
const mockRawTask = {
  id: 'task-1',
  taskNumber: 1,
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
  reporterId: 'dev-id',
  parentTaskId: null,
  assignees: [],
  project: { key: 'FF' },
  createdAt: now,
  updatedAt: now,
};

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Task Routes — Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // AUTHENTICATION
  // ==========================================================================
  describe('Authentication', () => {
    it('GET /tasks/organizations/:orgId/tasks/:taskId — 401 without token', async () => {
      const res = await request(app).get('/tasks/organizations/org-1/tasks/task-1');
      expect(res.status).toBe(401);
    });

    it('GET /tasks/organizations/:orgId/tasks/:taskId — 401 with invalid token', async () => {
      const res = await request(app)
        .get('/tasks/organizations/org-1/tasks/task-1')
        .set('Authorization', 'Bearer bad-token');
      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET TASK
  // ==========================================================================
  describe('GET /tasks/organizations/:orgId/tasks/:taskId', () => {
    it('should return 200 for an org member', async () => {
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockDeveloperMembership);
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockRawTask);

      const res = await request(app)
        .get('/tasks/organizations/org-1/tasks/task-1')
        .set('Authorization', `Bearer ${DEVELOPER_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.task.taskKey).toBe('FF-1');
    });

    it('should return 404 if task does not exist', async () => {
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockDeveloperMembership);
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .get('/tasks/organizations/org-1/tasks/nonexistent')
        .set('Authorization', `Bearer ${DEVELOPER_TOKEN}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 if user is not an org member', async () => {
      // requireOrgMember returns 404 for non-members (not 403 — to prevent enumeration)
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .get('/tasks/organizations/org-1/tasks/task-1')
        .set('Authorization', `Bearer ${DEVELOPER_TOKEN}`);

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // CREATE TASK
  // ==========================================================================
  describe('POST /tasks/organizations/:orgId/projects/:projectId/tasks', () => {
    it('should create a task for developer role', async () => {
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockDeveloperMembership);
      (prisma.board.findFirst as jest.Mock).mockResolvedValue({ id: 'board-1', name: 'Todo' });
      (prisma.task.aggregate as jest.Mock).mockResolvedValue({ _max: { taskNumber: 0, position: null } });
      (prisma.task.create as jest.Mock).mockResolvedValue(mockRawTask);

      const res = await request(app)
        .post('/tasks/organizations/org-1/projects/project-1/tasks')
        .set('Authorization', `Bearer ${DEVELOPER_TOKEN}`)
        .send({
          title: 'Fix login bug',
          boardId: 'board-1',
          priority: 'high',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.task.title).toBe('Fix login bug');
    });

    it('should return 400 for missing title', async () => {
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockDeveloperMembership);

      const res = await request(app)
        .post('/tasks/organizations/org-1/projects/project-1/tasks')
        .set('Authorization', `Bearer ${DEVELOPER_TOKEN}`)
        .send({ boardId: 'board-1' }); // Missing title

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid priority', async () => {
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockDeveloperMembership);

      const res = await request(app)
        .post('/tasks/organizations/org-1/projects/project-1/tasks')
        .set('Authorization', `Bearer ${DEVELOPER_TOKEN}`)
        .send({ title: 'Task', boardId: 'board-1', priority: 'CRITICAL' }); // Invalid priority

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // RBAC
  // ==========================================================================
  describe('RBAC — Permission enforcement', () => {
    it('DELETE /tasks/organizations/:orgId/tasks/:taskId — 403 for viewer role', async () => {
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockViewerMembership);

      const res = await request(app)
        .delete('/tasks/organizations/org-1/tasks/task-1')
        .set('Authorization', `Bearer ${VIEWER_TOKEN}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /tasks/.../tasks — 403 for viewer role (no task:create permission)', async () => {
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockViewerMembership);

      const res = await request(app)
        .post('/tasks/organizations/org-1/projects/project-1/tasks')
        .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
        .send({ title: 'My Task', boardId: 'board-1' });

      expect(res.status).toBe(403);
    });

    it('DELETE /tasks/.../tasks/:taskId — 204 for developer+ role', async () => {
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({
        ...mockDeveloperMembership,
        role: 'manager', // manager can delete tasks
      });
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockRawTask);
      (prisma.task.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      const res = await request(app)
        .delete('/tasks/organizations/org-1/tasks/task-1')
        .set('Authorization', `Bearer ${DEVELOPER_TOKEN}`);

      expect(res.status).toBe(204);
    });
  });

  // ==========================================================================
  // MOVE TASK
  // ==========================================================================
  describe('POST /tasks/organizations/:orgId/tasks/:taskId/move', () => {
    it('should return 409 when moving to the same board', async () => {
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockDeveloperMembership);
      // Task is already on board-1
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockRawTask);

      const res = await request(app)
        .post('/tasks/organizations/org-1/tasks/task-1/move')
        .set('Authorization', `Bearer ${DEVELOPER_TOKEN}`)
        .send({ targetBoardId: 'board-1' }); // Same board as current

      expect(res.status).toBe(409);
    });
  });

  // ==========================================================================
  // COMMENTS
  // ==========================================================================
  describe('POST /tasks/organizations/:orgId/tasks/:taskId/comments', () => {
    it('should return 403 for viewer (no comment:create permission)', async () => {
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockViewerMembership);

      const res = await request(app)
        .post('/tasks/organizations/org-1/tasks/task-1/comments')
        .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
        .send({ content: 'Hello' });

      expect(res.status).toBe(403);
    });

    it('should return 400 for empty comment content', async () => {
      (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockDeveloperMembership);

      const res = await request(app)
        .post('/tasks/organizations/org-1/tasks/task-1/comments')
        .set('Authorization', `Bearer ${DEVELOPER_TOKEN}`)
        .send({ content: '' }); // Empty comment

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // HEALTH CHECK
  // ==========================================================================
  describe('Health check', () => {
    it('GET /health — should return 200', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.service).toBe('task-service');
    });
  });
});
