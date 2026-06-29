// =============================================================================
// INTEGRATION TESTS — Organization Routes
// =============================================================================
//
// Tests verify the full HTTP → service → (mocked) repository flow.
// Key things tested:
// - RBAC: correct roles can perform actions, wrong roles get 403
// - Authentication: unauthenticated requests get 401
// - Validation: invalid bodies get 400
// - Route correctness: right status codes and response shapes
// =============================================================================

import request from 'supertest';
import app from '../../src/app';
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env';

// Mock all external deps
jest.mock('../../src/config/database', () => ({
  prisma: {
    organization: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    organizationMember: {
      findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(),
      delete: jest.fn(), updateMany: jest.fn(),
    },
    invitation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
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
    organization: (id: string) => `org:${id}`,
    memberList: (id: string) => `org:${id}:members`,
    userOrgs: (id: string) => `user:${id}:orgs`,
    teamList: (id: string) => `org:${id}:teams`,
    projectList: (id: string) => `org:${id}:projects`,
    project: (orgId: string, projectId: string) => `org:${orgId}:project:${projectId}`,
    boardList: (orgId: string, projectId: string) => `org:${orgId}:project:${projectId}:boards`,
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

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) }),
}));

import { prisma } from '../../src/config/database';
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// =============================================================================
// JWT HELPERS — Generate test tokens
// =============================================================================

const generateToken = (userId: string, email = 'test@example.com') =>
  jwt.sign({ sub: userId, email }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    issuer: 'flowforge-auth',
    audience: 'flowforge-api',
    expiresIn: '15m',
  });

const OWNER_TOKEN = generateToken('owner-id', 'owner@example.com');
const VIEWER_TOKEN = generateToken('viewer-id', 'viewer@example.com');

const mockOwnerMembership = {
  id: 'member-1', organizationId: 'org-1', userId: 'owner-id',
  role: 'owner', joinedAt: new Date(), invitedBy: null,
};

const mockViewerMembership = { ...mockOwnerMembership, id: 'member-2', userId: 'viewer-id', role: 'viewer' };

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Organization Routes — Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // AUTHENTICATION
  // ==========================================================================
  describe('Authentication', () => {
    it('GET /workspaces/organizations/:orgId — should return 401 without token', async () => {
      const response = await request(app).get('/workspaces/organizations/org-1');
      expect(response.status).toBe(401);
    });

    it('GET /workspaces/organizations/:orgId — should return 401 with invalid token', async () => {
      const response = await request(app)
        .get('/workspaces/organizations/org-1')
        .set('Authorization', 'Bearer invalid-token');
      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET ORGANIZATION
  // ==========================================================================
  describe('GET /workspaces/organizations/:orgId', () => {
    it('should return 200 for an org member', async () => {
      (mockPrisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockOwnerMembership);
      (mockPrisma.organization.findUnique as jest.Mock).mockResolvedValue({
        id: 'org-1', name: 'Acme', slug: 'acme', logoUrl: null, description: null,
        plan: 'free', createdBy: 'owner-id', createdAt: new Date(), updatedAt: new Date(),
      });
      (mockPrisma.organizationMember.findMany as jest.Mock).mockResolvedValue([mockOwnerMembership]);

      const response = await request(app)
        .get('/workspaces/organizations/org-1')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.organization.name).toBe('Acme');
    });

    it('should return 404 if user is not a member of the org', async () => {
      (mockPrisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(null); // Not a member

      const response = await request(app)
        .get('/workspaces/organizations/org-1')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`);

      // Returns 404 (not 403) to prevent org existence enumeration
      expect(response.status).toBe(404);
    });
  });

  // ==========================================================================
  // CREATE ORGANIZATION
  // ==========================================================================
  describe('POST /workspaces/organizations', () => {
    it('should create an org for any authenticated user', async () => {
      (mockPrisma.organization.findUnique as jest.Mock).mockResolvedValue(null); // Slug not taken
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          organization: { create: jest.fn().mockResolvedValue({ id: 'new-org', name: 'My Org', slug: 'my-org', logoUrl: null, description: null, plan: 'free', createdBy: 'owner-id', createdAt: new Date(), updatedAt: new Date() }) },
          organizationMember: { create: jest.fn().mockResolvedValue({}) },
        });
      });

      const response = await request(app)
        .post('/workspaces/organizations')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ name: 'My Org', slug: 'my-org' });

      expect(response.status).toBe(201);
    });

    it('should return 400 for invalid slug (special characters)', async () => {
      const response = await request(app)
        .post('/workspaces/organizations')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ name: 'My Org', slug: 'My Org!' }); // Invalid slug

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // RBAC — Permission enforcement
  // ==========================================================================
  describe('RBAC — Permission enforcement', () => {
    it('DELETE /workspaces/organizations/:orgId — should return 403 for viewer role', async () => {
      // Viewer tries to delete the org
      (mockPrisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockViewerMembership);

      const response = await request(app)
        .delete('/workspaces/organizations/org-1')
        .set('Authorization', `Bearer ${VIEWER_TOKEN}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /workspaces/organizations/:orgId/invite — should return 403 for developer role', async () => {
      const devMembership = { ...mockOwnerMembership, userId: 'dev-id', role: 'developer' };
      (mockPrisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(devMembership);

      const devToken = generateToken('dev-id', 'dev@example.com');

      const response = await request(app)
        .post('/workspaces/organizations/org-1/invite')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ email: 'new@example.com', role: 'developer' });

      expect(response.status).toBe(403);
    });

    it('DELETE /workspaces/organizations/:orgId — should succeed for owner', async () => {
      (mockPrisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(mockOwnerMembership);
      (mockPrisma.organization.delete as jest.Mock).mockResolvedValue({});

      const response = await request(app)
        .delete('/workspaces/organizations/org-1')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`);

      expect(response.status).toBe(204);
    });
  });

  // ==========================================================================
  // HEALTH CHECK
  // ==========================================================================
  describe('Health check', () => {
    it('GET /health — should return 200', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.service).toBe('workspace-service');
    });
  });
});
