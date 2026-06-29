// =============================================================================
// GLOBAL ERROR MIDDLEWARE — Central error handling
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Without this, every route would need its own try/catch and error response
//   logic. That leads to duplicated code and inconsistent error formats.
//
//   Express's special 4-argument middleware (err, req, res, next) is called
//   when: next(error) is called, or when an error is thrown in a middleware
//   (if using a wrapper like asyncHandler).
//
//   This single middleware handles ALL errors for the entire service.
//
// HOW IT WORKS:
//   1. If it's an AppError (our custom class): use its statusCode + code
//   2. If it's a Prisma error: convert to user-friendly message
//   3. If it's anything else: 500 Internal Server Error
//   4. In production: don't send stack traces to clients (security)
//   5. In development: include stack trace (debugging)
//
// INTERVIEW QUESTION:
//   "What is the difference between operational errors and programmer errors?"
//   Answer: Operational errors (isOperational: true) are expected runtime
//   conditions: user not found, invalid password, duplicate email.
//   These get proper HTTP responses (404, 401, 409).
//   Programmer errors (isOperational: false) are bugs: TypeError, assertion
//   failures, unhandled Promise rejections. These should crash the process
//   (or alert the team) because the app is in an unknown state.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { AppError, isAppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { Prisma } from '@prisma/client';

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction, // Must be declared even if unused — Express requires 4 params
): void => {
  // Log all errors (with context for debugging)
  const logContext = {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userId: req.user?.sub,
    errorName: error.name,
    stack: error.stack,
  };

  // Handle known application errors
  if (isAppError(error)) {
    // Operational errors (expected): log as warning, not error
    if (error.isOperational) {
      logger.warn('[ErrorMiddleware] Operational error', {
        ...logContext,
        code: error.code,
        message: error.message,
      });
    } else {
      logger.error('[ErrorMiddleware] Non-operational AppError', logContext);
    }

    // Type-check for ValidationError to access details
    const validationError = error as AppError & { details?: unknown };

    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(validationError.details && { details: validationError.details }),
        ...(env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
    return;
  }

  // Handle Prisma-specific errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    logger.warn('[ErrorMiddleware] Prisma error', { ...logContext, prismaCode: error.code });

    // P2002: Unique constraint violation (e.g., duplicate email)
    if (error.code === 'P2002') {
      const fields = (error.meta?.target as string[])?.join(', ') ?? 'field';
      res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: `A record with this ${fields} already exists`,
        },
      });
      return;
    }

    // P2025: Record not found (e.g., update a non-existent user)
    if (error.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Record not found' },
      });
      return;
    }

    // Other Prisma errors → 400
    res.status(400).json({
      success: false,
      error: { code: 'DATABASE_ERROR', message: 'Database operation failed' },
    });
    return;
  }

  // Unhandled/unexpected errors — these are bugs
  logger.error('[ErrorMiddleware] Unhandled error', logContext);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
      // Never expose internal error details in production
      ...(env.NODE_ENV === 'development' && {
        details: error.message,
        stack: error.stack,
      }),
    },
  });
};

// 404 handler — must be registered AFTER all routes
// If no route matched the request, send a 404
export const notFoundMiddleware = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.url} not found`,
    },
  });
};
