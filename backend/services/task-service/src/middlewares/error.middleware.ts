// Global error handler — see workspace-service/src/middlewares/error.middleware.ts for full docs.
import { Request, Response, NextFunction } from 'express';
import { AppError, isAppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { Prisma } from '@prisma/client';
import multer from 'multer';

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  const logContext = { method: req.method, url: req.url, userId: req.user?.sub };

  // Handle multer file upload errors
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: { code: 'PAYLOAD_TOO_LARGE', message: `File size exceeds the ${env.MAX_FILE_SIZE_MB}MB limit` },
      });
      return;
    }
    res.status(400).json({
      success: false,
      error: { code: 'UPLOAD_ERROR', message: `File upload error: ${error.message}` },
    });
    return;
  }

  if (isAppError(error)) {
    if (error.isOperational) {
      logger.warn('[TaskError] Operational error', { ...logContext, message: error.message });
    } else {
      logger.error('[TaskError] Non-operational', { ...logContext, stack: error.stack });
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

  logger.error('[TaskError] Unhandled', { ...logContext, error: error.message, stack: error.stack });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      ...(env.NODE_ENV === 'development' && { details: error.message }),
    },
  });
};

export const notFoundMiddleware = (req: Request, res: Response): void => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } });
};
