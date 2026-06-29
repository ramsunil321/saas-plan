// =============================================================================
// AUTH MIDDLEWARE — JWT verification for notification service
// =============================================================================
// Identical to task-service auth middleware.
// See workspace-service/src/middlewares/auth.middleware.ts for full docs.
//
// WHY this middleware exists in EVERY service (not just auth-service):
//   Microservices are independently deployed and independently authenticated.
//   Each service verifies the JWT itself using the shared JWT_ACCESS_SECRET.
//   There is NO centralized session check — the token is self-contained.
//   This is the "stateless" benefit of JWT: no DB lookup per request.
//
// INTERVIEW QUESTION: "How do microservices share auth state?"
//   Answer: They don't share "state" — they share a SECRET. The auth-service
//   issues a signed JWT. Every other service validates the signature using the
//   same secret. No network call needed. The tradeoff: you can't immediately
//   invalidate a token (must wait for expiry). Mitigated by short TTL (15 min)
//   and token revocation via refresh token blacklist.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { UnauthorizedError } from '../utils/errors';
import { OrganizationMember } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string;
        email: string;
      };
      orgMember?: OrganizationMember;
    }
  }
}

export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authorization header missing or invalid format');
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'flowforge-auth',
      audience: 'flowforge-api',
    }) as JwtPayload;

    if (!decoded.sub || !decoded.email) {
      throw new UnauthorizedError('Invalid token payload');
    }

    req.user = {
      sub: decoded.sub as string,
      email: decoded.email as string,
    };

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
      return;
    }
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Access token has expired'));
      return;
    }
    next(new UnauthorizedError('Invalid access token'));
  }
};
