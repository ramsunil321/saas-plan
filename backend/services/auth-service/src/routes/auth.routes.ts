// =============================================================================
// AUTH ROUTES — Express Router
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Routes wire together: URL path + HTTP method + middlewares + controller handler
//   Separating routes from the controller keeps each file focused on one job.
//
// ROUTE TABLE:
//   POST   /auth/register          → Register a new user
//   POST   /auth/login             → Login with email + password
//   POST   /auth/logout            → Logout (revoke current refresh token)
//   POST   /auth/logout-all        → Logout from all devices (requires auth)
//   POST   /auth/refresh           → Refresh access token using refresh token
//   GET    /auth/verify-email      → Verify email with token from query string
//   POST   /auth/forgot-password   → Request password reset email
//   POST   /auth/reset-password    → Reset password with token
//   GET    /auth/me                → Get current user profile (requires auth)
//
// MIDDLEWARE EXECUTION ORDER (per route):
//   1. Rate limiter (Redis-backed — blocks brute force)
//   2. Validator (Zod — rejects malformed requests early)
//   3. Auth middleware (JWT check — only on protected routes)
//   4. Controller handler (business logic orchestration)
//   5. Global error middleware (catches any thrown errors)
//
// INTERVIEW QUESTION:
//   "What is the order of Express middleware execution?"
//   Answer: Middleware executes in the order it's registered.
//   Within a route definition: [middleware1, middleware2, handler].
//   Each middleware calls next() to pass control to the next one.
//   If a middleware doesn't call next(), the chain stops.
//   This is the "Chain of Responsibility" design pattern.
// =============================================================================

import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { AuthService } from '../services/auth.service';
import { AuthRepository } from '../repositories/auth.repository';
import { validate } from '../middlewares/validate.middleware';
import { requireAuth } from '../middlewares/auth.middleware';
import {
  loginRateLimit,
  registerRateLimit,
  forgotPasswordRateLimit,
} from '../middlewares/rate-limit.middleware';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
} from '../validators/auth.validator';

// Compose the layers (Dependency Injection by hand — no IoC container)
// In a larger app, use a DI container like InversifyJS or tsyringe
// INTERVIEW QUESTION: "What is Dependency Injection?"
// Answer: Instead of a class creating its own dependencies (new AuthRepository()),
// dependencies are PASSED IN from outside. This makes classes:
// 1. Testable (inject mocks in tests)
// 2. Flexible (swap implementations without changing the class)
// 3. Explicit (dependencies are visible, not hidden inside the class)
const authRepository = new AuthRepository();
const authService = new AuthService(authRepository);
const authController = new AuthController(authService);

export const authRouter = Router();

// PUBLIC ROUTES — No authentication required
// ---------------------------------------------------------------------------

// POST /auth/register
// Rate limited: 5 requests per hour per IP
// Validates: email, password, firstName, lastName
authRouter.post(
  '/register',
  registerRateLimit,
  validate(registerSchema),
  authController.register,
);

// POST /auth/login
// Rate limited: 10 requests per 15 minutes per IP (brute force protection)
// Validates: email, password
authRouter.post(
  '/login',
  loginRateLimit,
  validate(loginSchema),
  authController.login,
);

// POST /auth/logout
// No auth required — if the refresh token is valid, it gets revoked
// If client has no token, logout is still "successful" (idempotent)
authRouter.post('/logout', authController.logout);

// POST /auth/refresh
// No auth required — this is HOW we get a new access token when the old one expires
// Validates: refreshToken (optional — can also come from cookie)
authRouter.post(
  '/refresh',
  validate(refreshTokenSchema),
  authController.refreshTokens,
);

// GET /auth/verify-email?token=xxx
// Validates: token query parameter
authRouter.get(
  '/verify-email',
  validate(verifyEmailSchema),
  authController.verifyEmail,
);

// POST /auth/forgot-password
// Rate limited: 3 requests per 15 minutes (prevent email bombing)
// Validates: email
authRouter.post(
  '/forgot-password',
  forgotPasswordRateLimit,
  validate(forgotPasswordSchema),
  authController.forgotPassword,
);

// POST /auth/reset-password
// Validates: token, newPassword, confirmPassword
authRouter.post(
  '/reset-password',
  validate(resetPasswordSchema),
  authController.resetPassword,
);

// PROTECTED ROUTES — Valid JWT access token required
// ---------------------------------------------------------------------------

// POST /auth/logout-all — requires valid access token to know WHICH user to logout
authRouter.post('/logout-all', requireAuth, authController.logoutAll);

// GET /auth/me — Get current user profile
authRouter.get('/me', requireAuth, authController.getMe);
