// =============================================================================
// AUTH MIDDLEWARE — JWT verification for task service
// =============================================================================
// Identical to workspace-service auth middleware.
// See workspace-service/src/middlewares/auth.middleware.ts for full docs.
//
// Verifies the JWT access token issued by auth-service.
// On success, sets req.user = { sub: userId, email }.
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
