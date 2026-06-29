// Global error handler — identical pattern to auth-service.
// See auth-service/src/middlewares/error.middleware.ts for full documentation.
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
  _next: NextFunction,
): void => {
  const logContext = { method: req.method, url: req.url, userId: req.user?.sub };

  if (isAppError(error)) {
    if (error.isOperational) {
      logger.warn('[WorkspaceError] Operational error', { ...logContext, message: error.message });
    } else {
      logger.error('[WorkspaceError] Non-operational', { ...logContext, stack: error.stack });
    }
    const ve = error as AppError & { details?: unknown };
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(ve.details && { details: ve.details }),
        ...(env.NODE_ENV === 'development' && { stack: error.stack }),
      },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const fields = (error.meta?.target as string[])?.join(', ') ?? 'field';
      res.status(409).json({ success: false, error: { code: 'CONFLICT', message: `A record with this ${fields} already exists` } });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Record not found' } });
      return;
    }
    res.status(400).json({ success: false, error: { code: 'DATABASE_ERROR', message: 'Database operation failed' } });
    return;
  }

  logger.error('[WorkspaceError] Unhandled', { ...logContext, error: error.message, stack: error.stack });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      ...(env.NODE_ENV === 'development' && { details: error.message, stack: error.stack }),
    },
  });
};

export const notFoundMiddleware = (req: Request, res: Response): void => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } });
};
