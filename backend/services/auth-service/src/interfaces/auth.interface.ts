// =============================================================================
// AUTH INTERFACES — TypeScript contracts for the Auth Service
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Interfaces define the "shape" of data flowing through the system.
//   By defining interfaces separately from implementation, we:
//   1. Enable dependency injection (swap implementations in tests)
//   2. Document what data looks like at each layer
//   3. Get TypeScript compile-time checks across the entire service
//
// HOW IT WORKS:
//   - IAuthRepository: defines what DB operations are available (used by Service)
//   - IAuthService: defines what business operations are available (used by Controller)
//   - Request/Response types: shape of data at the HTTP boundary
//
// INTERVIEW QUESTION:
//   "What is the difference between an interface and a type in TypeScript?"
//   Answer: Functionally similar for most use cases. Key differences:
//   - Interfaces can be extended with `extends` and merged (declaration merging)
//   - Types can represent unions: type A = B | C (interfaces can't)
//   - Types can represent primitives and tuples directly
//   Best practice: use `interface` for objects (data shapes, contracts),
//   use `type` for unions, intersections, and utility types.
// =============================================================================

import { User, RefreshToken } from '@prisma/client';

// =============================================================================
// REPOSITORY INTERFACE — What the data layer must implement
// =============================================================================
// The Controller depends on IAuthService, not AuthService directly.
// The Service depends on IAuthRepository, not AuthRepository directly.
// This enables unit testing with mock implementations.
// =============================================================================

export interface IAuthRepository {
  // User operations
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  findUserByVerifyToken(token: string): Promise<User | null>;
  findUserByResetToken(token: string): Promise<User | null>;
  createUser(data: CreateUserData): Promise<User>;
  updateUser(id: string, data: UpdateUserData): Promise<User>;

  // Refresh token operations
  createRefreshToken(data: CreateRefreshTokenData): Promise<RefreshToken>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null>;
  revokeRefreshToken(id: string): Promise<void>;
  revokeAllUserRefreshTokens(userId: string): Promise<void>;
  deleteExpiredRefreshTokens(): Promise<number>; // Returns count of deleted tokens
}

// =============================================================================
// DATA SHAPES — Internal to the service layer
// =============================================================================

export interface CreateUserData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  verifyToken: string;
  verifyTokenExpiresAt: Date;
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  isVerified?: boolean;
  verifyToken?: string | null;
  verifyTokenExpiresAt?: Date | null;
  resetToken?: string | null;
  resetTokenExpiresAt?: Date | null;
  passwordHash?: string;
}

export interface CreateRefreshTokenData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  deviceInfo?: {
    userAgent?: string;
    ip?: string;
  };
}

// =============================================================================
// SERVICE RESPONSE TYPES — What the service layer returns to controllers
// =============================================================================

// User safe to return in API responses — NO passwordHash, NO tokens
export interface SafeUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  createdAt: Date;
}

// Returned after successful login or token refresh
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // Access token expiry in seconds (for client to schedule refresh)
}

// Combined response after login/register
export interface AuthResponse {
  user: SafeUser;
  tokens: AuthTokens;
}

// =============================================================================
// REQUEST TYPES — Input data shapes (also defined in DTOs/validators)
// =============================================================================

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

export interface RefreshTokenInput {
  refreshToken: string;
}

// =============================================================================
// SERVICE INTERFACE — What the business layer must implement
// =============================================================================

export interface IAuthService {
  register(input: RegisterInput, deviceInfo?: { ip?: string; userAgent?: string }): Promise<{ message: string; userId: string }>;
  login(input: LoginInput, deviceInfo?: { ip?: string; userAgent?: string }): Promise<AuthResponse>;
  logout(refreshToken: string): Promise<void>;
  logoutAll(userId: string): Promise<void>;
  refreshTokens(refreshToken: string, deviceInfo?: { ip?: string; userAgent?: string }): Promise<AuthTokens>;
  verifyEmail(token: string): Promise<void>;
  forgotPassword(input: ForgotPasswordInput): Promise<void>;
  resetPassword(input: ResetPasswordInput): Promise<void>;
  getMe(userId: string): Promise<SafeUser>;
}
