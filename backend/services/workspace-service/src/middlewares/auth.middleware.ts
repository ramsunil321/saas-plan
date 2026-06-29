// =============================================================================
// AUTH MIDDLEWARE — JWT verification for workspace service
// =============================================================================
//
// HOW IT DIFFERS FROM AUTH-SERVICE VERSION:
//   The auth-service middleware validates JWTs it issued.
//   This middleware does the same (same secret, same algorithm), but it
//   ALSO loads the user's organization membership + role from the database.
//
//   Why load the role here instead of trusting the JWT's role claim?
//   Because role changes (admin→viewer) would otherwise not take effect until
//   the access token expires (15 minutes). By looking up the DB on every request,
//   role changes are effective immediately.
//
//   This is the trade-off: slightly more DB reads for immediacy vs purely
//   stateless JWT verification. For most apps, this is the right choice.
//
// REQUEST AUGMENTATION:
//   After this middleware, downstream handlers have access to:
//   - req.user.sub          → userId (from JWT)
//   - req.user.email        → user email (from JWT)
//   - req.orgMember         → { organizationId, userId, role, joinedAt }
//     (set by requireOrgMember middleware, not this one)
//
// INTERVIEW QUESTION:
//   "What is the difference between authentication and authorization?"
//   Answer: Authentication = proving WHO you are (JWT verification — this file).
//   Authorization = proving WHAT you're allowed to do (RBAC — rbac.middleware.ts).
//   Auth happens first, then authz checks the authenticated user's permissions.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { UnauthorizedError } from '../utils/errors';
import { OrganizationMember } from '@prisma/client';

// Extend Express Request with our custom properties
declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string;   // userId
        email: string;
      };
      // Set by requireOrgMember after membership verification
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

    // Attach user identity to request
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
