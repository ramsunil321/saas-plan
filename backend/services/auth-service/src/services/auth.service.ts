// =============================================================================
// AUTH SERVICE — Business Logic Layer
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   The Service layer is the heart of the application. It orchestrates:
//   - Business rules (a user must verify email before logging in)
//   - Security operations (hashing passwords, generating tokens)
//   - Cross-cutting concerns (sending emails AFTER creating the user)
//   - Error handling with semantic errors (ConflictError for duplicate email)
//
// WHAT BELONGS HERE (and what doesn't):
//   ✅ Business rules and orchestration
//   ✅ Calling repositories to read/write data
//   ✅ Calling external services (email, Redis)
//   ✅ Generating tokens, hashing passwords
//   ❌ HTTP concerns (req, res, status codes) — that's the Controller's job
//   ❌ Raw SQL / Prisma queries — that's the Repository's job
//
// INTERVIEW QUESTION:
//   "What is the difference between the Service layer and the Repository layer?"
//   Answer: Repository = HOW to get data (DB-specific, SQL/ORM).
//   Service = WHAT to do with data (business rules, orchestration).
//   Example: "Create user" in Repository is just `INSERT INTO users...`.
//   "Register user" in Service is: check duplicate → hash password →
//   create user → generate verify token → send email.
//
// INTERVIEW QUESTION:
//   "Why is bcrypt preferred over SHA-256 for passwords?"
//   Answer: bcrypt is intentionally slow (configurable cost factor).
//   SHA-256 hashes millions of values per second → GPU brute force is feasible.
//   bcrypt with cost 12 hashes ~250 passwords/second → brute force is impractical.
//   bcrypt also includes a salt automatically → prevents rainbow table attacks.
// =============================================================================

import bcrypt from 'bcryptjs';
import { IAuthRepository } from '../interfaces/auth.interface';
import type {
  IAuthService,
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  AuthResponse,
  AuthTokens,
  SafeUser,
} from '../interfaces/auth.interface';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  getTokenExpiryDate,
} from '../utils/jwt';
import { generateSecureToken, hashToken } from '../utils/crypto';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from '../utils/email';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from '../utils/errors';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { User } from '@prisma/client';

export class AuthService implements IAuthService {
  // Dependency injection — the repository is injected, not instantiated here
  // This is the Dependency Inversion Principle: depend on abstractions
  constructor(private readonly authRepository: IAuthRepository) {}

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  // Convert a full User record to a SafeUser (safe to send to clients)
  // This strips sensitive fields: passwordHash, verifyToken, resetToken
  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
    };
  }

  // Generate both tokens and store the refresh token in DB
  // Called after login and after token refresh
  private async generateTokenPair(
    user: User,
    deviceInfo?: { ip?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    // Generate access token (JWT, stateless, 15 min)
    const accessToken = generateAccessToken({
      sub: user.id,
      email: user.email,
    });

    // Generate refresh token (JWT with jti, 7 days)
    const { token: refreshToken, jti } = generateRefreshToken(user.id);

    // Hash the jti (unique token ID) for DB storage
    // NEVER store the actual refresh token — store its hash
    const tokenHash = hashToken(jti);
    const expiresAt = getTokenExpiryDate(env.JWT_REFRESH_EXPIRES_IN);

    // Persist the hashed token in the database
    await this.authRepository.createRefreshToken({
      userId: user.id,
      tokenHash,
      expiresAt,
      deviceInfo,
    });

    // Return the TTL in seconds for the client to schedule a refresh before expiry
    const expiresIn = 15 * 60; // 15 minutes in seconds (matches JWT_ACCESS_EXPIRES_IN)

    return { accessToken, refreshToken, expiresIn };
  }

  // ==========================================================================
  // REGISTER
  // ==========================================================================
  // Flow: validate → check duplicate → hash password → create user → send email
  // Returns a message (not the user + tokens) because email must be verified first
  async register(
    input: RegisterInput,
    deviceInfo?: { ip?: string; userAgent?: string },
  ): Promise<{ message: string; userId: string }> {
    // Step 1: Check if email already exists
    // We check BEFORE hashing (bcrypt is slow — no point hashing if we'll reject anyway)
    const existingUser = await this.authRepository.findUserByEmail(input.email);
    if (existingUser) {
      // Use a generic message to prevent user enumeration
      // BUT for UX, many products DO tell you "email already registered"
      // This is a product decision: security vs usability
      throw new ConflictError('An account with this email already exists');
    }

    // Step 2: Hash the password
    // INTERVIEW QUESTION: "What is bcrypt's salt?"
    // Answer: A random string appended to the password before hashing.
    // Even if two users have the same password, their hashes will differ.
    // bcrypt.genSalt(rounds) generates the salt. bcrypt.hash() uses it internally.
    // env.BCRYPT_ROUNDS = 12 means 2^12 = 4096 iterations (more = slower = more secure)
    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);

    // Step 3: Generate email verification token
    // This is a random 32-byte hex string (64 characters)
    // We store it directly in the DB (not hashed) because we query by exact match
    // and it's a one-time use token with an expiry — lower risk than passwords
    const verifyToken = generateSecureToken();
    const verifyTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Step 4: Create user in database
    const user = await this.authRepository.createUser({
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      verifyToken,
      verifyTokenExpiresAt,
    });

    logger.info('[AuthService] New user registered', { userId: user.id, email: user.email });

    // Step 5: Send verification email (async — don't await, don't block the response)
    // Fire and forget — if email fails, user can request a new one
    // In production, this would be a RabbitMQ event consumed by Notification Service
    sendVerificationEmail(user.email, user.firstName, verifyToken).catch((err) => {
      logger.error('[AuthService] Failed to send verification email', {
        userId: user.id,
        error: err,
      });
    });

    return {
      message: 'Registration successful. Please check your email to verify your account.',
      userId: user.id,
    };
  }

  // ==========================================================================
  // LOGIN
  // ==========================================================================
  // Flow: find user → check verified → compare password → generate tokens
  async login(
    input: LoginInput,
    deviceInfo?: { ip?: string; userAgent?: string },
  ): Promise<AuthResponse> {
    // Step 1: Find user by email
    const user = await this.authRepository.findUserByEmail(input.email);

    // SECURITY: Always compare passwords even if user not found
    // This prevents timing attacks that reveal whether an email exists
    // (the attacker measures response time: fast = no user, slow = wrong password)
    const dummyHash = '$2a$12$dummyhashfortimingsafety.notarealthing.padded';

    if (!user) {
      // Compare against a dummy hash to normalize response time
      await bcrypt.compare(input.password, dummyHash);
      throw new UnauthorizedError('Invalid email or password');
    }

    // Step 2: Verify password against stored hash
    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Step 3: Check email verification
    if (!user.isVerified && env.NODE_ENV === 'production') {
      throw new UnauthorizedError(
        'Please verify your email address before logging in. Check your inbox for a verification link.',
      );
    }

    // Step 4: Generate access + refresh tokens
    const tokens = await this.generateTokenPair(user, deviceInfo);

    logger.info('[AuthService] User logged in', {
      userId: user.id,
      ip: deviceInfo?.ip,
    });

    return {
      user: this.toSafeUser(user),
      tokens,
    };
  }

  // ==========================================================================
  // LOGOUT
  // ==========================================================================
  // Revoke the specific refresh token used in this session
  async logout(refreshToken: string): Promise<void> {
    try {
      // Verify the token to extract the jti (unique token ID)
      const decoded = verifyRefreshToken(refreshToken);

      // Hash the jti to look it up in the database
      const tokenHash = hashToken(decoded.jti);
      const storedToken = await this.authRepository.findRefreshTokenByHash(tokenHash);

      if (storedToken) {
        await this.authRepository.revokeRefreshToken(storedToken.id);
      }
      // If token not found (already revoked or expired), silently succeed
      // This makes logout idempotent — calling it twice doesn't error

      logger.info('[AuthService] User logged out', { userId: decoded.sub });
    } catch {
      // If token verification fails, just succeed silently
      // The client is removing their token anyway — this is the desired outcome
    }
  }

  // ==========================================================================
  // LOGOUT ALL DEVICES
  // ==========================================================================
  async logoutAll(userId: string): Promise<void> {
    await this.authRepository.revokeAllUserRefreshTokens(userId);
    logger.info('[AuthService] User logged out from all devices', { userId });
  }

  // ==========================================================================
  // REFRESH TOKENS
  // ==========================================================================
  // Implements Refresh Token Rotation:
  // 1. Validate the incoming refresh token
  // 2. Find and revoke it in the database
  // 3. Issue a brand new access + refresh token pair
  async refreshTokens(
    refreshToken: string,
    deviceInfo?: { ip?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    // Step 1: Verify the JWT signature and expiry
    const decoded = verifyRefreshToken(refreshToken);

    // Step 2: Hash the jti to look up in DB
    const tokenHash = hashToken(decoded.jti);
    const storedToken = await this.authRepository.findRefreshTokenByHash(tokenHash);

    if (!storedToken) {
      // Token not found in DB means either:
      // - Already used (rotation violation → possible token theft)
      // - Manually revoked (logout)
      // SECURITY: Revoke ALL tokens for this user — assume compromise
      // This is the "Refresh Token Reuse Detection" security mechanism
      logger.warn('[AuthService] Refresh token reuse detected!', {
        userId: decoded.sub,
        jti: decoded.jti,
      });
      await this.authRepository.revokeAllUserRefreshTokens(decoded.sub);
      throw new UnauthorizedError('Invalid refresh token. Please log in again.');
    }

    // Step 3: Load the user (to get current state)
    const user = await this.authRepository.findUserById(decoded.sub);
    if (!user || !user.isVerified) {
      throw new UnauthorizedError('Authentication failed');
    }

    // Step 4: Revoke the OLD refresh token (rotation — one-time use)
    await this.authRepository.revokeRefreshToken(storedToken.id);

    // Step 5: Issue NEW token pair
    const newTokens = await this.generateTokenPair(user, deviceInfo);

    logger.info('[AuthService] Tokens refreshed', { userId: user.id });

    return newTokens;
  }

  // ==========================================================================
  // VERIFY EMAIL
  // ==========================================================================
  async verifyEmail(token: string): Promise<void> {
    // Find user with this verification token (repository checks expiry too)
    const user = await this.authRepository.findUserByVerifyToken(token);

    if (!user) {
      throw new ValidationError(
        'Invalid or expired verification link. Please request a new one.',
      );
    }

    if (user.isVerified) {
      // Idempotent — already verified, just succeed
      return;
    }

    // Mark as verified and clear the token fields
    await this.authRepository.updateUser(user.id, {
      isVerified: true,
      verifyToken: null,
      verifyTokenExpiresAt: null,
    });

    logger.info('[AuthService] Email verified', { userId: user.id });

    // Send welcome email asynchronously
    sendWelcomeEmail(user.email, user.firstName).catch((err) => {
      logger.error('[AuthService] Failed to send welcome email', { error: err });
    });
  }

  // ==========================================================================
  // FORGOT PASSWORD
  // ==========================================================================
  // Security principle: ALWAYS return success even if email doesn't exist
  // This prevents user enumeration (revealing which emails are registered)
  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const user = await this.authRepository.findUserByEmail(input.email);

    // Return the same message whether or not the email exists
    if (!user) {
      // Intentional: don't reveal that this email isn't registered
      logger.info('[AuthService] Forgot password requested for unknown email', {
        email: input.email,
      });
      return; // Silently succeed
    }

    // Generate a reset token (1-hour expiry)
    const resetToken = generateSecureToken();
    const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.authRepository.updateUser(user.id, {
      resetToken,
      resetTokenExpiresAt,
    });

    // Send reset email asynchronously
    sendPasswordResetEmail(user.email, user.firstName, resetToken).catch((err) => {
      logger.error('[AuthService] Failed to send reset email', { error: err });
    });

    logger.info('[AuthService] Password reset requested', { userId: user.id });
  }

  // ==========================================================================
  // RESET PASSWORD
  // ==========================================================================
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    // Find user by their reset token (repository checks expiry)
    const user = await this.authRepository.findUserByResetToken(input.token);

    if (!user) {
      throw new ValidationError(
        'Invalid or expired password reset link. Please request a new one.',
      );
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(input.newPassword, env.BCRYPT_ROUNDS);

    // Update password and clear the reset token fields
    await this.authRepository.updateUser(user.id, {
      passwordHash,
      resetToken: null,
      resetTokenExpiresAt: null,
    });

    // Revoke ALL existing refresh tokens — force re-login on all devices
    // Security: after password change, all existing sessions are invalidated
    await this.authRepository.revokeAllUserRefreshTokens(user.id);

    logger.info('[AuthService] Password reset successful', { userId: user.id });
  }

  // ==========================================================================
  // GET ME — Return current user's profile
  // ==========================================================================
  async getMe(userId: string): Promise<SafeUser> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }
    return this.toSafeUser(user);
  }
}
