// =============================================================================
// AUTH CONTROLLER — HTTP Layer
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   The Controller is responsible for the HTTP boundary ONLY:
//   1. Extract data from req (body, query, params, headers, cookies)
//   2. Call the appropriate service method
//   3. Send the HTTP response using the response utilities
//
// WHAT BELONGS HERE (and what doesn't):
//   ✅ Reading from req.body, req.params, req.query, req.cookies
//   ✅ Calling service methods
//   ✅ Sending responses (sendSuccess, sendCreated)
//   ✅ Setting cookies (for refresh token)
//   ❌ Business logic (checking passwords, generating tokens)
//   ❌ Database queries
//   ❌ try/catch around service calls — that's the error middleware's job
//
// WHY NO try/catch HERE?
//   Service methods throw AppErrors on failure. Express routes with async
//   handlers pass the error to next(err) which reaches the global error
//   middleware. We wrap all async routes with asyncHandler() to do this.
//   Result: controllers are clean, error handling is centralized.
//
// INTERVIEW QUESTION:
//   "Why use classes for controllers vs plain functions?"
//   Answer: Both work. Classes enable dependency injection (inject the service
//   in the constructor). Plain functions are simpler and have less boilerplate.
//   This codebase uses classes for educational consistency with OOP patterns.
//
// COOKIE STRATEGY for Refresh Tokens:
//   httpOnly: true  → JavaScript cannot read this cookie (XSS protection)
//   secure: true    → Cookie only sent over HTTPS (prevents interception)
//   sameSite: strict → Cookie not sent on cross-site requests (CSRF protection)
//   Combined: this is MORE secure than storing the refresh token in localStorage
//
// INTERVIEW QUESTION:
//   "localStorage vs httpOnly Cookie for token storage?"
//   Answer: localStorage is accessible via JavaScript → vulnerable to XSS.
//   httpOnly cookies are NOT accessible via JavaScript → XSS can't steal them.
//   httpOnly cookies have CSRF risk (mitigated with sameSite: strict + CSRF tokens).
//   Best practice: access tokens in memory, refresh tokens in httpOnly cookies.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { IAuthService } from '../interfaces/auth.interface';
import { sendSuccess, sendCreated } from '../utils/response';
import { env } from '../config/env';

// Helper: wrap async route handlers to forward errors to Express error middleware
// Without this, unhandled promise rejections in async routes crash the process
// or hang the request instead of returning a 500 response
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };

export class AuthController {
  constructor(private readonly authService: IAuthService) {}

  // ==========================================================================
  // POST /auth/register
  // ==========================================================================
  register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { email, password, firstName, lastName } = req.body;

    const result = await this.authService.register(
      { email, password, firstName, lastName },
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );

    sendCreated(res, result);
  });

  // ==========================================================================
  // POST /auth/login
  // ==========================================================================
  login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    const result = await this.authService.login(
      { email, password },
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );

    // Set refresh token as httpOnly cookie (XSS protection — JS cannot read it)
    this.setRefreshTokenCookie(res, result.tokens.refreshToken);

    // Also return the refresh token in the response body so the frontend can store
    // it in localStorage for cross-origin dev setups where cookies are not forwarded.
    // The cookie remains the primary mechanism (more secure); the body value is the fallback.
    // INTERVIEW NOTE: In a production SPA, prefer relying solely on the httpOnly cookie
    // + withCredentials: true on the Axios client, eliminating localStorage exposure.
    sendSuccess(res, {
      user: result.user,
      tokens: {
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        expiresIn: result.tokens.expiresIn,
      },
    });
  });

  // ==========================================================================
  // POST /auth/logout
  // ==========================================================================
  logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    // Get refresh token from cookie OR body (support both for flexibility)
    const refreshToken =
      req.cookies?.refreshToken ?? req.body?.refreshToken;

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    // Clear the cookie regardless of whether the token was valid
    this.clearRefreshTokenCookie(res);

    sendSuccess(res, { message: 'Logged out successfully' });
  });

  // ==========================================================================
  // POST /auth/logout-all
  // Requires authentication (JWT middleware must run first)
  // ==========================================================================
  logoutAll = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    // req.user is set by the auth middleware after JWT verification
    const userId = (req as Request & { user: { sub: string } }).user.sub;

    await this.authService.logoutAll(userId);

    this.clearRefreshTokenCookie(res);

    sendSuccess(res, { message: 'Logged out from all devices' });
  });

  // ==========================================================================
  // POST /auth/refresh
  // ==========================================================================
  refreshTokens = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    // Prefer cookie (more secure), fall back to body (for API clients)
    const refreshToken =
      req.cookies?.refreshToken ?? req.body?.refreshToken;

    if (!refreshToken) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Refresh token required' },
      });
      return;
    }

    const newTokens = await this.authService.refreshTokens(refreshToken, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Set the new refresh token in the cookie (rotation — old token is already revoked)
    this.setRefreshTokenCookie(res, newTokens.refreshToken);

    // Also return the new refresh token in the body for the localStorage fallback
    // so the frontend can rotate its stored copy after each refresh call
    sendSuccess(res, {
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      expiresIn: newTokens.expiresIn,
    });
  });

  // ==========================================================================
  // GET /auth/verify-email?token=xxx
  // ==========================================================================
  verifyEmail = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { token } = req.query as { token: string };

    await this.authService.verifyEmail(token);

    sendSuccess(res, { message: 'Email verified successfully. You can now log in.' });
  });

  // ==========================================================================
  // POST /auth/forgot-password
  // ==========================================================================
  forgotPassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body;

    await this.authService.forgotPassword({ email });

    // Always return the same message — don't reveal if email exists
    sendSuccess(res, {
      message: 'If an account exists with this email, you will receive a password reset link.',
    });
  });

  // ==========================================================================
  // POST /auth/reset-password
  // ==========================================================================
  resetPassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { token, newPassword } = req.body;

    await this.authService.resetPassword({ token, newPassword });

    sendSuccess(res, {
      message: 'Password reset successful. Please log in with your new password.',
    });
  });

  // ==========================================================================
  // GET /auth/me — Get current user profile (protected route)
  // ==========================================================================
  getMe = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as Request & { user: { sub: string } }).user.sub;

    const user = await this.authService.getMe(userId);

    sendSuccess(res, { user });
  });

  // ==========================================================================
  // PRIVATE COOKIE HELPERS
  // ==========================================================================

  private setRefreshTokenCookie(res: Response, refreshToken: string): void {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,                            // Not accessible via document.cookie
      secure: env.NODE_ENV === 'production',     // HTTPS only in production
      sameSite: 'strict',                        // Prevents CSRF attacks
      maxAge: 7 * 24 * 60 * 60 * 1000,          // 7 days in milliseconds
      path: '/auth',                             // Only sent to /auth routes
    });
  }

  private clearRefreshTokenCookie(res: Response): void {
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth',
    });
  }
}
