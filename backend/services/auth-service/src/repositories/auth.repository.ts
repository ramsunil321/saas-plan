// =============================================================================
// AUTH REPOSITORY — Data Access Layer
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   The Repository Pattern separates data access logic from business logic.
//   The Service layer doesn't know OR CARE whether data comes from PostgreSQL,
//   MongoDB, an in-memory store, or an API. It just calls repository methods.
//
//   Benefits:
//   1. Testability: In unit tests, swap the real repository for a mock
//   2. Single Responsibility: Business logic in Service, DB logic here
//   3. Changeability: Replace Prisma with Drizzle/TypeORM → change ONE file
//
// CLEAN ARCHITECTURE RULE:
//   Direction of dependency: Controller → Service → Repository → Database
//   NEVER: Service imports from Controller, Repository imports from Service
//
// HOW IT WORKS:
//   Each method does ONE thing: one DB query.
//   No business logic here — no password hashing, no token generation.
//   Just "give me this data" and "store this data".
//
// INTERVIEW QUESTION:
//   "What is the Repository Pattern?"
//   Answer: An abstraction layer between the business logic and data access.
//   The service depends on an INTERFACE (IAuthRepository), not the concrete
//   class. This is the Dependency Inversion Principle (the D in SOLID):
//   high-level modules should not depend on low-level modules; both should
//   depend on abstractions (interfaces).
//
// INTERVIEW QUESTION:
//   "What is the difference between Repository and DAO (Data Access Object)?"
//   Answer: DAO maps directly to database tables (one DAO per table).
//   Repository maps to domain concepts (one Repository per aggregate).
//   In practice for small services, they're often interchangeable.
// =============================================================================

import { User, RefreshToken } from '@prisma/client';
import { prisma } from '../config/database';
import {
  IAuthRepository,
  CreateUserData,
  UpdateUserData,
  CreateRefreshTokenData,
} from '../interfaces/auth.interface';

export class AuthRepository implements IAuthRepository {
  // ==========================================================================
  // USER OPERATIONS
  // ==========================================================================

  // Find user by email — used during login and duplicate-check during registration
  async findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  // Find user by ID — used after JWT verification to load current user
  async findUserById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  // Find user by their email verification token
  // Used in the verify-email endpoint
  async findUserByVerifyToken(token: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        verifyToken: token,
        // Only return users whose token hasn't expired yet
        // gt = greater than (token expiry in the future = still valid)
        verifyTokenExpiresAt: { gt: new Date() },
      },
    });
  }

  // Find user by their password reset token
  // Used in the reset-password endpoint
  async findUserByResetToken(token: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiresAt: { gt: new Date() },
      },
    });
  }

  // Create a new user record
  // Note: passwordHash is already hashed by the service layer — never hash here
  async createUser(data: CreateUserData): Promise<User> {
    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        verifyToken: data.verifyToken,
        verifyTokenExpiresAt: data.verifyTokenExpiresAt,
        // isVerified defaults to false (defined in schema)
      },
    });
  }

  // Generic update — only updates fields that are provided (Partial)
  // Prisma's update with 'undefined' values ignores those fields automatically
  async updateUser(id: string, data: UpdateUserData): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: {
        // Spread only the defined fields
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
        ...(data.isVerified !== undefined && { isVerified: data.isVerified }),
        ...(data.verifyToken !== undefined && { verifyToken: data.verifyToken }),
        ...(data.verifyTokenExpiresAt !== undefined && { verifyTokenExpiresAt: data.verifyTokenExpiresAt }),
        ...(data.resetToken !== undefined && { resetToken: data.resetToken }),
        ...(data.resetTokenExpiresAt !== undefined && { resetTokenExpiresAt: data.resetTokenExpiresAt }),
        ...(data.passwordHash !== undefined && { passwordHash: data.passwordHash }),
      },
    });
  }

  // ==========================================================================
  // REFRESH TOKEN OPERATIONS
  // ==========================================================================

  // Store a new refresh token (hashed) in the database
  async createRefreshToken(data: CreateRefreshTokenData): Promise<RefreshToken> {
    return prisma.refreshToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        deviceInfo: data.deviceInfo ?? undefined,
      },
    });
  }

  // Find a refresh token record by its SHA-256 hash
  // Called during token refresh to validate the token hasn't been revoked
  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        isRevoked: false,       // Reject revoked tokens
        expiresAt: { gt: new Date() }, // Reject expired tokens
      },
    });
  }

  // Revoke a single refresh token (logout from one device)
  async revokeRefreshToken(id: string): Promise<void> {
    await prisma.refreshToken.update({
      where: { id },
      data: { isRevoked: true },
    });
  }

  // Revoke ALL refresh tokens for a user (logout from all devices)
  // Used when: password changed, account compromised, "logout everywhere" feature
  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: {
        userId,
        isRevoked: false, // Only update ones that are currently active
      },
      data: { isRevoked: true },
    });
  }

  // Cleanup job: delete expired tokens to keep the table size manageable
  // Called by a scheduled job (cron) — e.g., nightly at 2am
  // Returns the count of deleted tokens for logging
  async deleteExpiredRefreshTokens(): Promise<number> {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } }, // Expired
          { isRevoked: true },               // Already revoked
        ],
      },
    });
    return result.count;
  }
}
