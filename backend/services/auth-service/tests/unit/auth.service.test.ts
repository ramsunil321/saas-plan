// =============================================================================
// UNIT TESTS — AuthService
// =============================================================================
//
// WHY UNIT TESTS?
//   Unit tests test ONE unit of code in isolation.
//   "Isolation" means we MOCK all dependencies (repository, email, Redis).
//   This ensures:
//   1. Tests run fast (no DB, no network)
//   2. Tests are deterministic (no flaky external dependencies)
//   3. Failures pinpoint exactly which function has the bug
//
// MOCKING STRATEGY:
//   We mock the IAuthRepository — the service depends on the interface,
//   not the implementation. We create a mock that returns whatever we need.
//   This is the Dependency Injection pattern paying off for testability.
//
// WHAT TO TEST:
//   - Happy path: valid input → expected output
//   - Error paths: invalid input → correct error thrown
//   - Edge cases: duplicate email, expired token, wrong password
//   - Side effects: was the email sent? Was the token revoked?
//
// INTERVIEW QUESTION:
//   "What is the difference between unit, integration, and e2e tests?"
//   Answer:
//   - Unit: Test one function/class in isolation. Fast, precise, many.
//   - Integration: Test multiple components working together (service + DB).
//     Slower, catches integration bugs. Medium count.
//   - E2E (end-to-end): Test the full flow through the real system.
//     Slowest, catches user-facing bugs. Few but critical.
//   The "Testing Pyramid": many unit → fewer integration → fewest e2e.
//
// INTERVIEW QUESTION:
//   "What is Jest's jest.fn()?"
//   Answer: Creates a "spy" or "mock function" that records every call
//   (arguments, return values, call count). Use .mockResolvedValue() to
//   make it return a specific value when awaited.
// =============================================================================

import { AuthService } from '../../src/services/auth.service';
import { IAuthRepository } from '../../src/interfaces/auth.interface';
import { ConflictError, UnauthorizedError, ValidationError } from '../../src/utils/errors';
import bcrypt from 'bcryptjs';

// =============================================================================
// MOCKS
// =============================================================================

// Mock email utilities — don't actually send emails in tests
jest.mock('../../src/utils/email', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
}));

// Mock JWT utilities — return predictable values
jest.mock('../../src/utils/jwt', () => ({
  generateAccessToken: jest.fn().mockReturnValue('mock-access-token'),
  generateRefreshToken: jest.fn().mockReturnValue({ token: 'mock-refresh-token', jti: 'mock-jti' }),
  verifyRefreshToken: jest.fn().mockReturnValue({ sub: 'user-1', jti: 'mock-jti', type: 'refresh' }),
  getTokenExpiryDate: jest.fn().mockReturnValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
}));

// Mock crypto — predictable tokens
jest.mock('../../src/utils/crypto', () => ({
  generateSecureToken: jest.fn().mockReturnValue('mock-secure-token'),
  hashToken: jest.fn().mockReturnValue('mock-token-hash'),
  verifyTokenHash: jest.fn().mockReturnValue(true),
}));

// Mock logger — silence output during tests
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// =============================================================================
// TEST FIXTURES — Reusable test data
// =============================================================================

const mockUser = {
  id: 'user-1',
  email: 'john@example.com',
  passwordHash: bcrypt.hashSync('Password123', 1), // Low rounds for speed in tests
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

const mockRefreshToken = {
  id: 'token-1',
  userId: 'user-1',
  tokenHash: 'mock-token-hash',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  isRevoked: false,
  deviceInfo: null,
  createdAt: new Date(),
};

// Create a mock repository — implements IAuthRepository with jest.fn()
const createMockRepository = (): jest.Mocked<IAuthRepository> => ({
  findUserByEmail: jest.fn(),
  findUserById: jest.fn(),
  findUserByVerifyToken: jest.fn(),
  findUserByResetToken: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  createRefreshToken: jest.fn(),
  findRefreshTokenByHash: jest.fn(),
  revokeRefreshToken: jest.fn(),
  revokeAllUserRefreshTokens: jest.fn(),
  deleteExpiredRefreshTokens: jest.fn(),
});

// =============================================================================
// TEST SUITES
// =============================================================================

describe('AuthService', () => {
  let authService: AuthService;
  let mockRepository: jest.Mocked<IAuthRepository>;

  // Run before each test — create fresh instances to avoid test pollution
  beforeEach(() => {
    jest.clearAllMocks(); // Reset all mock call counts and implementations
    mockRepository = createMockRepository();
    authService = new AuthService(mockRepository);
  });

  // ==========================================================================
  // REGISTER
  // ==========================================================================
  describe('register()', () => {
    const validInput = {
      email: 'new@example.com',
      password: 'Password123',
      firstName: 'Jane',
      lastName: 'Smith',
    };

    it('should register a new user successfully', async () => {
      // Arrange: email doesn't exist yet
      mockRepository.findUserByEmail.mockResolvedValue(null);
      mockRepository.createUser.mockResolvedValue({ ...mockUser, email: validInput.email, id: 'new-user-id' });

      // Act
      const result = await authService.register(validInput);

      // Assert
      expect(result.message).toContain('Registration successful');
      expect(result.userId).toBe('new-user-id');
      expect(mockRepository.findUserByEmail).toHaveBeenCalledWith(validInput.email);
      expect(mockRepository.createUser).toHaveBeenCalledOnce();
    });

    it('should throw ConflictError if email already exists', async () => {
      // Arrange: email already in DB
      mockRepository.findUserByEmail.mockResolvedValue(mockUser);

      // Act & Assert: expect the async function to throw ConflictError
      await expect(authService.register(validInput)).rejects.toThrow(ConflictError);
      await expect(authService.register(validInput)).rejects.toThrow(
        'An account with this email already exists',
      );
      expect(mockRepository.createUser).not.toHaveBeenCalled();
    });

    it('should hash the password (never store plain text)', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(null);
      mockRepository.createUser.mockResolvedValue({ ...mockUser, id: 'new-id' });

      await authService.register(validInput);

      // Verify that createUser was NOT called with the plain password
      const createCall = mockRepository.createUser.mock.calls[0][0];
      expect(createCall.passwordHash).not.toBe(validInput.password);
      // The hash should be a valid bcrypt hash
      expect(createCall.passwordHash).toMatch(/^\$2[ab]\$\d{2}\$/);
    });
  });

  // ==========================================================================
  // LOGIN
  // ==========================================================================
  describe('login()', () => {
    const loginInput = {
      email: 'john@example.com',
      password: 'Password123',
    };

    it('should return user and tokens on successful login', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(mockUser);
      mockRepository.createRefreshToken.mockResolvedValue(mockRefreshToken);

      const result = await authService.login(loginInput);

      expect(result.user.email).toBe(mockUser.email);
      expect(result.tokens.accessToken).toBe('mock-access-token');
      expect(result.tokens.refreshToken).toBe('mock-refresh-token');
      // SafeUser should NOT include passwordHash
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('should throw UnauthorizedError if user not found', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(null);

      await expect(authService.login(loginInput)).rejects.toThrow(UnauthorizedError);
      await expect(authService.login(loginInput)).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('should throw UnauthorizedError if password is wrong', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.login({ ...loginInput, password: 'WrongPassword' }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError if email is not verified', async () => {
      const unverifiedUser = { ...mockUser, isVerified: false };
      mockRepository.findUserByEmail.mockResolvedValue(unverifiedUser);

      await expect(authService.login(loginInput)).rejects.toThrow(UnauthorizedError);
      await expect(authService.login(loginInput)).rejects.toThrow('verify your email');
    });

    it('should NOT reveal which part of the login failed (security)', async () => {
      // Both "user not found" and "wrong password" should throw the SAME error message
      // This prevents user enumeration attacks
      mockRepository.findUserByEmail.mockResolvedValue(null);
      let errorForNoUser: Error | null = null;
      try {
        await authService.login(loginInput);
      } catch (e) {
        errorForNoUser = e as Error;
      }

      mockRepository.findUserByEmail.mockResolvedValue(mockUser);
      let errorForWrongPass: Error | null = null;
      try {
        await authService.login({ ...loginInput, password: 'Wrong' });
      } catch (e) {
        errorForWrongPass = e as Error;
      }

      expect(errorForNoUser?.message).toBe(errorForWrongPass?.message);
    });
  });

  // ==========================================================================
  // REFRESH TOKENS
  // ==========================================================================
  describe('refreshTokens()', () => {
    it('should return new tokens and revoke old refresh token', async () => {
      mockRepository.findRefreshTokenByHash.mockResolvedValue(mockRefreshToken);
      mockRepository.findUserById.mockResolvedValue(mockUser);
      mockRepository.revokeRefreshToken.mockResolvedValue(undefined);
      mockRepository.createRefreshToken.mockResolvedValue(mockRefreshToken);

      const result = await authService.refreshTokens('valid-refresh-token');

      expect(result.accessToken).toBe('mock-access-token');
      // Old token must be revoked
      expect(mockRepository.revokeRefreshToken).toHaveBeenCalledWith(mockRefreshToken.id);
      // New token must be created
      expect(mockRepository.createRefreshToken).toHaveBeenCalled();
    });

    it('should revoke ALL tokens and throw if refresh token not found (reuse detection)', async () => {
      // Token not in DB — means it was already used (potential theft)
      mockRepository.findRefreshTokenByHash.mockResolvedValue(null);

      await expect(authService.refreshTokens('used-token')).rejects.toThrow(
        UnauthorizedError,
      );
      // Security: revoke all tokens for this user
      expect(mockRepository.revokeAllUserRefreshTokens).toHaveBeenCalledWith('user-1');
    });
  });

  // ==========================================================================
  // VERIFY EMAIL
  // ==========================================================================
  describe('verifyEmail()', () => {
    it('should verify user email and clear the token', async () => {
      const unverifiedUser = {
        ...mockUser,
        isVerified: false,
        verifyToken: 'valid-verify-token',
      };
      mockRepository.findUserByVerifyToken.mockResolvedValue(unverifiedUser);
      mockRepository.updateUser.mockResolvedValue({ ...unverifiedUser, isVerified: true });

      await authService.verifyEmail('valid-verify-token');

      expect(mockRepository.updateUser).toHaveBeenCalledWith(unverifiedUser.id, {
        isVerified: true,
        verifyToken: null,
        verifyTokenExpiresAt: null,
      });
    });

    it('should throw ValidationError for invalid/expired token', async () => {
      mockRepository.findUserByVerifyToken.mockResolvedValue(null);

      await expect(authService.verifyEmail('bad-token')).rejects.toThrow(ValidationError);
    });

    it('should be idempotent — succeed if already verified', async () => {
      // Already verified user
      mockRepository.findUserByVerifyToken.mockResolvedValue(mockUser); // isVerified: true

      await expect(authService.verifyEmail('token')).resolves.toBeUndefined();
      // Should NOT call updateUser again
      expect(mockRepository.updateUser).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // FORGOT PASSWORD
  // ==========================================================================
  describe('forgotPassword()', () => {
    it('should succeed silently even if email does not exist (prevent enumeration)', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(null);

      // Should not throw
      await expect(
        authService.forgotPassword({ email: 'nonexistent@example.com' }),
      ).resolves.toBeUndefined();

      // Should not update anything
      expect(mockRepository.updateUser).not.toHaveBeenCalled();
    });

    it('should generate reset token and send email for valid user', async () => {
      const { sendPasswordResetEmail } = require('../../src/utils/email');
      mockRepository.findUserByEmail.mockResolvedValue(mockUser);
      mockRepository.updateUser.mockResolvedValue(mockUser);

      await authService.forgotPassword({ email: mockUser.email });

      expect(mockRepository.updateUser).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          resetToken: expect.any(String),
          resetTokenExpiresAt: expect.any(Date),
        }),
      );
    });
  });

  // ==========================================================================
  // RESET PASSWORD
  // ==========================================================================
  describe('resetPassword()', () => {
    it('should update password and revoke all refresh tokens', async () => {
      const userWithResetToken = {
        ...mockUser,
        resetToken: 'valid-reset-token',
        resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      };
      mockRepository.findUserByResetToken.mockResolvedValue(userWithResetToken);
      mockRepository.updateUser.mockResolvedValue(mockUser);
      mockRepository.revokeAllUserRefreshTokens.mockResolvedValue(undefined);

      await authService.resetPassword({
        token: 'valid-reset-token',
        newPassword: 'NewPassword123',
      });

      // Password must be updated (and hashed)
      const updateCall = mockRepository.updateUser.mock.calls[0][1];
      expect(updateCall.passwordHash).not.toBe('NewPassword123');
      expect(updateCall.resetToken).toBeNull();

      // All existing sessions must be invalidated
      expect(mockRepository.revokeAllUserRefreshTokens).toHaveBeenCalledWith(mockUser.id);
    });

    it('should throw ValidationError for invalid reset token', async () => {
      mockRepository.findUserByResetToken.mockResolvedValue(null);

      await expect(
        authService.resetPassword({ token: 'bad-token', newPassword: 'NewPass123' }),
      ).rejects.toThrow(ValidationError);
    });
  });
});
