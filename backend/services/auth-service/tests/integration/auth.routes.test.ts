// =============================================================================
// INTEGRATION TESTS — Auth Routes (HTTP layer + Service + Repository)
// =============================================================================
//
// WHY INTEGRATION TESTS?
//   Unit tests verify logic in isolation. Integration tests verify that the
//   layers work together correctly:
//   - HTTP request parsing → validation → service → DB
//   - Response shape matches the API contract
//   - HTTP status codes are correct
//   - Error responses have the right format
//
// WHAT WE MOCK (and why):
//   - Database (Prisma): We mock prisma calls to avoid needing a real DB
//     in CI. In a "true" integration test, you'd use a test DB (Docker).
//     We mock at the repository level to still test the HTTP + service layers.
//   - Email: No real emails in tests
//   - Redis: No real Redis — mock the rate limiter to not block test flows
//
// TOOLS:
//   - supertest: Makes HTTP requests directly to the Express app (no real server)
//   - jest: Test runner and assertion library
//
// INTERVIEW QUESTION:
//   "What does supertest do?"
//   Answer: supertest wraps an Express app and lets you make HTTP requests
//   WITHOUT starting a real server on a port. It calls the app's request
//   handler directly. This makes tests faster and avoids port conflicts.
//   `request(app).post('/auth/login').send({...}).expect(200)` — clean and
//   declarative.
// =============================================================================

import request from 'supertest';
import app from '../../src/app';

// =============================================================================
// MOCK DEPENDENCIES
// =============================================================================

// Mock the entire Prisma module — replace with jest functions
jest.mock('../../src/config/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

// Mock Redis — disable rate limiting in tests
jest.mock('../../src/config/redis', () => ({
  redis: {
    pipeline: jest.fn().mockReturnValue({
      zremrangebyscore: jest.fn().mockReturnThis(),
      zcard: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      pexpire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([null, [null, 0], null, null]),
    }),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    quit: jest.fn().mockResolvedValue('OK'),
  },
  RedisKeys: {
    refreshTokenBlacklist: jest.fn((jti: string) => `refresh:blacklist:${jti}`),
    loginAttempts: jest.fn((ip: string) => `ratelimit:login:${ip}`),
    resetAttempts: jest.fn((email: string) => `ratelimit:reset:${email}`),
    verifyToken: jest.fn((token: string) => `verify:${token}`),
  },
}));

// Mock email sending
jest.mock('../../src/utils/email', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
}));

// Mock logger to silence test output
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    http: jest.fn(),
    debug: jest.fn(),
  },
  httpLogger: { log: jest.fn() },
}));

// =============================================================================
// IMPORT MOCKED MODULES (after mocks are set up)
// =============================================================================
import { prisma } from '../../src/config/database';
import bcrypt from 'bcryptjs';

// Cast to access mock methods
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// =============================================================================
// TEST FIXTURES
// =============================================================================

const hashedPassword = bcrypt.hashSync('Password123', 1); // Fast hash for tests

const mockDbUser = {
  id: 'user-uuid-123',
  email: 'john@example.com',
  passwordHash: hashedPassword,
  firstName: 'John',
  lastName: 'Doe',
  avatarUrl: null,
  isVerified: true,
  verifyToken: null,
  verifyTokenExpiresAt: null,
  resetToken: null,
  resetTokenExpiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockDbRefreshToken = {
  id: 'token-uuid-456',
  userId: 'user-uuid-123',
  tokenHash: 'hashed-jti',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  isRevoked: false,
  deviceInfo: null,
  createdAt: new Date(),
};

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Auth Routes — Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // POST /auth/register
  // ==========================================================================
  describe('POST /auth/register', () => {
    it('should return 201 and success message for valid registration', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null); // No existing user
      (mockPrisma.user.create as jest.Mock).mockResolvedValue({
        ...mockDbUser,
        email: 'new@example.com',
        isVerified: false,
      });

      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'new@example.com',
          password: 'Password123',
          firstName: 'Jane',
          lastName: 'Smith',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain('Registration successful');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com' }); // Missing password, firstName, lastName

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toBeInstanceOf(Array);
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'not-an-email',
          password: 'Password123',
          firstName: 'Jane',
          lastName: 'Smith',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'body.email' }),
        ]),
      );
    });

    it('should return 400 for weak password', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'weak', // Too short, no uppercase, no number
          firstName: 'Jane',
          lastName: 'Smith',
        });

      expect(response.status).toBe(400);
    });

    it('should return 409 if email already registered', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockDbUser);

      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'john@example.com',
          password: 'Password123',
          firstName: 'John',
          lastName: 'Doe',
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  // ==========================================================================
  // POST /auth/login
  // ==========================================================================
  describe('POST /auth/login', () => {
    it('should return 200 with access token and set refresh token cookie', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockDbUser);
      (mockPrisma.refreshToken.create as jest.Mock).mockResolvedValue(mockDbRefreshToken);

      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'john@example.com', password: 'Password123' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      // Access token should be in body
      expect(typeof response.body.data.tokens.accessToken).toBe('string');
      // Refresh token should be in httpOnly cookie, NOT in response body
      expect(response.body.data.tokens.refreshToken).toBeUndefined();
      // Cookie should be set
      expect(response.headers['set-cookie']).toBeDefined();
      expect(response.headers['set-cookie'][0]).toContain('refreshToken');
      expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    });

    it('should return 401 for wrong password', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockDbUser);

      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'john@example.com', password: 'WrongPassword' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for non-existent email', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'Password123' });

      expect(response.status).toBe(401);
    });

    it('should return 401 if email is not verified', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockDbUser,
        isVerified: false,
      });

      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'john@example.com', password: 'Password123' });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toContain('verify');
    });

    it('should return 400 for missing credentials', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // POST /auth/logout
  // ==========================================================================
  describe('POST /auth/logout', () => {
    it('should return 200 and clear the cookie', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .send({ refreshToken: 'any-token' });

      expect(response.status).toBe(200);
      expect(response.body.data.message).toContain('Logged out');
    });

    it('should succeed even with no token (idempotent)', async () => {
      const response = await request(app).post('/auth/logout').send({});

      expect(response.status).toBe(200);
    });
  });

  // ==========================================================================
  // POST /auth/forgot-password
  // ==========================================================================
  describe('POST /auth/forgot-password', () => {
    it('should return 200 with the same message regardless of whether email exists', async () => {
      // Email exists
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockDbUser);
      (mockPrisma.user.update as jest.Mock).mockResolvedValue(mockDbUser);

      const responseForExisting = await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'john@example.com' });

      // Email does NOT exist
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const responseForNonExistent = await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'nobody@example.com' });

      // SECURITY: Both should return 200 with the same message
      expect(responseForExisting.status).toBe(200);
      expect(responseForNonExistent.status).toBe(200);
      expect(responseForExisting.body.data.message).toBe(
        responseForNonExistent.body.data.message,
      );
    });
  });

  // ==========================================================================
  // GET /auth/me
  // ==========================================================================
  describe('GET /auth/me', () => {
    it('should return 401 if no token provided', async () => {
      const response = await request(app).get('/auth/me');

      expect(response.status).toBe(401);
    });

    it('should return 401 if token is invalid', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token-here');

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /health
  // ==========================================================================
  describe('GET /health', () => {
    it('should return 200 with service info', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('auth-service');
    });
  });

  // ==========================================================================
  // 404 Handler
  // ==========================================================================
  describe('Unknown routes', () => {
    it('should return 404 for unregistered routes', async () => {
      const response = await request(app).get('/auth/nonexistent-endpoint');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });
});
