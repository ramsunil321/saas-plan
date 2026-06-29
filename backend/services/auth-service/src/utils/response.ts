// =============================================================================
// API RESPONSE HELPERS — Consistent response format
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Without a standard response format, different endpoints return different
//   shapes. The frontend team can't build a reliable API client.
//   With this utility, EVERY response from FlowForge has the same envelope:
//
//   Success: { success: true, data: {...}, meta?: {...} }
//   Error:   { success: false, error: { code, message, details? } }
//
// HOW IT WORKS:
//   These are simple helper functions that wrap Express's res.json().
//   They set the HTTP status code and send the standard response body.
//   The controller calls these instead of res.json() directly.
//
// INTERVIEW QUESTION:
//   "Why use a response wrapper instead of res.json() directly?"
//   Answer: Consistency and single point of change. If you later need to add
//   a field to every success response (e.g., a request ID for tracing),
//   you change it in ONE place. Without wrappers, you'd modify every
//   controller in the entire codebase.
// =============================================================================

import { Response } from 'express';

// Generic pagination metadata type
interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Send a successful response
// Generic <T> means TypeScript knows the shape of `data` at the call site
export const sendSuccess = <T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: PaginationMeta,
): void => {
  res.status(statusCode).json({
    success: true,
    data,
    ...(meta && { meta }), // Only include meta if provided (for paginated responses)
  });
};

// Send a created response (201)
export const sendCreated = <T>(res: Response, data: T): void => {
  sendSuccess(res, data, 201);
};

// Send a no-content response (204) — for DELETE operations
export const sendNoContent = (res: Response): void => {
  res.status(204).send();
};

// Send an error response — used by the global error handler
export const sendError = (
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): void => {
  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(details && { details }), // Field-level validation errors
    },
  });
};
