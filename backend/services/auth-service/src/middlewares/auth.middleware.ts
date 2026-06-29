// =============================================================================
// AUTH MIDDLEWARE — JWT verification for protected routes
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Some routes require authentication (e.g., GET /auth/me, POST /auth/logout-all).
//   This middleware extracts and verifies the JWT from the Authorization header,
//   then attaches the decoded payload to req.user for downstream handlers.
//
// HOW IT WORKS:
//   Standard: Bearer token in Authorization header
//   Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.xyz
//
//   1. Extract the "Bearer <token>" from the header
//   2. Verify the JWT signature and expiry
//   3. Attach decoded payload to req.user
//   4. Call next() to proceed to the controller
//   5. If anything fails, throw UnauthorizedError (→ 401 response)
//
// INTERVIEW QUESTION:
//   "How does JWT authentication work stateless-ly?"
//   Answer: The server doesn't store sessions. Instead, the JWT contains all
//   the info the server needs (userId, role) in its PAYLOAD. The server only
//   needs the SECRET to verify the SIGNATURE — no DB lookup required.
//   This scales horizontally: any server with the secret can verify any token.
//   Trade-off: can't invalidate individual tokens before they expire
//   (hence why we also have refresh tokens in a DB for logout).
//
// EXTENDING Request:
//   TypeScript's Express Request type doesn't have a `user` field.
//   We extend it via module augmentation (see the declare module block).
//   This is TypeScript's way of adding properties to existing types.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, AccessTokenPayload } from '../utils/jwt';
import { UnauthorizedError } from '../utils/errors';

// Extend Express's Request type to include our user property
// This declaration lives in the auth middleware but affects the whole app
declare global {
  namespace Express {
    interface Request {
      // The decoded JWT payload — set by this middleware on protected routes
      user?: AccessTokenPayload & { sub: string };
    }
  }
}

// Middleware: requires a valid JWT to proceed
export const requireAuth = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedError('Authorization header is missing');
    }

    // Standard format: "Bearer <token>"
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedError('Invalid authorization format. Use: Bearer <token>');
    }

    const token = parts[1];

    // Verify signature and expiry — throws UnauthorizedError on failure
    const decoded = verifyAccessToken(token);

    // Attach decoded payload to request for downstream handlers
    req.user = decoded;

    next();
  } catch (error) {
    next(error); // Forward to global error middleware
  }
};

// Optional auth middleware — proceeds even without a valid token
// Useful for endpoints that have different behavior for auth vs non-auth users
export const optionalAuth = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      try {
        const decoded = verifyAccessToken(parts[1]);
        req.user = decoded;
      } catch {
        // Invalid token — just proceed without setting req.user
      }
    }
  }

  next();
};
