// =============================================================================
// CUSTOM ERROR CLASSES
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   JavaScript's built-in Error class only has `message`. For an API, we need:
//   - HTTP status code (400, 401, 403, 404, 409, 500...)
//   - Machine-readable error code ("VALIDATION_ERROR", "USER_NOT_FOUND")
//   - Optional field-level details (for validation errors)
//
//   Custom error classes let us throw semantic errors deep in the business
//   logic layer, catch them in ONE central error middleware, and convert them
//   to consistent HTTP responses automatically.
//
//   This is the "throw early, catch once" pattern.
//
// HOW IT WORKS:
//   1. Service layer throws: throw new NotFoundError('User not found')
//   2. Error propagates up the Express middleware chain
//   3. Global error handler (error.middleware.ts) catches it
//   4. It checks instanceof AppError, extracts statusCode + code, sends response
//
// INTERVIEW QUESTION:
//   "How do you handle errors in Express.js?"
//   Answer: Express has a special 4-argument middleware (err, req, res, next)
//   called the error handler. When any middleware calls next(error) or throws
//   inside an async route (if wrapped), Express skips to this handler.
//   The pattern is: throw custom errors in business logic, catch ALL of them
//   in one global handler — single responsibility principle.
//
// INTERVIEW QUESTION:
//   "Why extend Error instead of just returning error objects?"
//   Answer: Throwing an error unwinds the call stack immediately (no need to
//   check return values at every level). instanceof checks let the error handler
//   distinguish between our custom errors and unexpected system errors.
//   Also: Error objects have stack traces, which are critical for debugging.
// =============================================================================

// Base class for all FlowForge application errors
export class AppError extends Error {
  public readonly statusCode: number;   // HTTP status code
  public readonly code: string;         // Machine-readable code for clients
  public readonly isOperational: boolean; // Operational = expected (user error), not a bug

  constructor(
    message: string,
    statusCode: number,
    code: string,
    isOperational = true,
  ) {
    // Call parent Error constructor — sets this.message
    super(message);

    // Restore the prototype chain — required when extending built-ins in TypeScript
    // Without this, `instanceof AppError` can return false
    Object.setPrototypeOf(this, new.target.prototype);

    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;

    // Capture stack trace, excluding the constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }
}

// 400 Bad Request — client sent invalid data
export class ValidationError extends AppError {
  public readonly details?: Array<{ field: string; message: string }>;

  constructor(
    message: string,
    details?: Array<{ field: string; message: string }>,
  ) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

// 401 Unauthorized — no valid credentials
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

// 403 Forbidden — valid credentials, but insufficient permissions
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403, 'FORBIDDEN');
  }
}

// 404 Not Found
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

// 409 Conflict — resource already exists
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

// 429 Too Many Requests
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please try again later.') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// 500 Internal Server Error — unexpected errors that are NOT operational
// These indicate bugs, not user errors
export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred') {
    super(message, 500, 'INTERNAL_ERROR', false); // isOperational = false
  }
}

// Type guard: check if an unknown thrown value is an AppError
export const isAppError = (error: unknown): error is AppError => {
  return error instanceof AppError;
};
