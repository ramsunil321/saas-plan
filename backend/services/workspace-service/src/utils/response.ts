// Standard API response helpers — identical pattern to auth-service.
// See auth-service/src/utils/response.ts for full documentation.
import { Response } from 'express';

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const sendSuccess = <T>(res: Response, data: T, statusCode = 200, meta?: PaginationMeta): void => {
  res.status(statusCode).json({ success: true, data, ...(meta && { meta }) });
};

export const sendCreated = <T>(res: Response, data: T): void => {
  sendSuccess(res, data, 201);
};

export const sendNoContent = (res: Response): void => {
  res.status(204).send();
};

export const sendError = (res: Response, statusCode: number, code: string, message: string, details?: unknown): void => {
  res.status(statusCode).json({ success: false, error: { code, message, ...(details && { details }) } });
};
