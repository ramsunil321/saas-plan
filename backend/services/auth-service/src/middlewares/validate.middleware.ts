// =============================================================================
// VALIDATION MIDDLEWARE — Zod schema validation for Express routes
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Instead of calling schema.parse(req.body) in every controller,
//   we create a reusable middleware factory. Pass in the schema, get back
//   a middleware function that validates and returns 400 on failure.
//
//   This keeps controllers clean and ensures validation always happens
//   BEFORE the controller runs — you can't forget to validate.
//
// HOW IT WORKS:
//   1. `validate(schema)` returns an Express middleware function
//   2. The middleware calls schema.parse() on { body, query, params }
//   3. On success: req.body/query/params are REPLACED with the validated
//      (and transformed) values (trimmed strings, lowercased emails, etc.)
//   4. On failure: ZodError is caught and converted to a 400 response
//      with field-level error details
//
// INTERVIEW QUESTION:
//   "What is a middleware factory in Express?"
//   Answer: A function that RETURNS a middleware function.
//   `validate(schema)` is called at route DEFINITION time (once).
//   The returned (req, res, next) => void is called at REQUEST time (per request).
//   This pattern allows the middleware to be configured with parameters
//   (like the Zod schema) while remaining reusable.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';

// Factory function: takes a Zod schema, returns an Express middleware
export const validate = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Parse and validate the request
      // The schema defines which parts to validate: body, query, params
      const validated = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // REPLACE the original req fields with the validated + transformed values
      // This means controllers get trimmed, typed, normalized data — not raw strings
      if (validated.body) req.body = validated.body;
      if (validated.query) req.query = validated.query;
      if (validated.params) req.params = validated.params;

      next(); // Validation passed — continue to controller
    } catch (error) {
      if (error instanceof ZodError) {
        // Convert Zod's error format to our standard error format
        const details = error.issues.map((issue) => ({
          field: issue.path.join('.'), // e.g., "body.email" → "email"
          message: issue.message,
        }));

        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details,
          },
        });
        return;
      }

      // Unexpected error (not from Zod) — pass to global error handler
      next(error);
    }
  };
};
