// =============================================================================
// REQUEST VALIDATORS — Zod schemas for all auth endpoints
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Never trust client input. Every value from req.body, req.params, and
//   req.query must be validated and sanitized before reaching the business logic.
//
//   Zod is our validation library. It:
//   1. Validates data (type checking at runtime)
//   2. Transforms data (trim strings, lowercase emails)
//   3. Generates TypeScript types automatically (no duplication!)
//
// HOW IT WORKS:
//   1. Define a Zod schema (the shape and rules)
//   2. Call schema.parse(req.body) — throws ZodError if invalid
//   3. The validate middleware (validate.middleware.ts) catches ZodErrors
//      and converts them to 400 responses with field-level error details
//   4. z.infer<typeof schema> gives us the TypeScript type for free
//
// INTERVIEW QUESTION:
//   "What is the difference between validation and sanitization?"
//   Answer: Validation checks if data is correct (email is valid format, password
//   is long enough). Sanitization transforms data to remove harmful content
//   (trim whitespace, lowercase email, strip HTML tags). Both are needed.
//   Zod does both: .trim() sanitizes, .email() validates.
//
// INTERVIEW QUESTION:
//   "Why validate on the server if the frontend already validates?"
//   Answer: Never trust the client. Frontend validation is for UX (instant feedback).
//   Anyone can bypass frontend validation with curl, Postman, or browser devtools.
//   Server-side validation is the actual security boundary.
// =============================================================================

import { z } from 'zod';

// Reusable password rules — centralized so they're consistent across schemas
// INTERVIEW QUESTION: "What makes a strong password validation?"
// Answer: Length is more important than complexity. A 12+ character passphrase
// is more secure than an 8-char "P@ssw0rd". We enforce length + mixed content.
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must not exceed 128 characters')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain at least one lowercase letter, one uppercase letter, and one number',
  );

// =============================================================================
// REGISTER
// =============================================================================
export const registerSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .email('Please enter a valid email address')
      .toLowerCase() // Normalize: "User@Example.COM" → "user@example.com"
      .trim(),

    password: passwordSchema,

    firstName: z
      .string({ required_error: 'First name is required' })
      .trim()
      .min(2, 'First name must be at least 2 characters')
      .max(50, 'First name must not exceed 50 characters'),

    lastName: z
      .string({ required_error: 'Last name is required' })
      .trim()
      .min(2, 'Last name must be at least 2 characters')
      .max(50, 'Last name must not exceed 50 characters'),
  }),
});

// =============================================================================
// LOGIN
// =============================================================================
export const loginSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .email('Invalid email address')
      .toLowerCase()
      .trim(),

    password: z
      .string({ required_error: 'Password is required' })
      .min(1, 'Password is required'),
  }),
});

// =============================================================================
// VERIFY EMAIL
// =============================================================================
export const verifyEmailSchema = z.object({
  query: z.object({
    token: z.string({ required_error: 'Verification token is required' }).min(1),
  }),
});

// =============================================================================
// FORGOT PASSWORD
// =============================================================================
export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .email('Please enter a valid email address')
      .toLowerCase()
      .trim(),
  }),
});

// =============================================================================
// RESET PASSWORD
// =============================================================================
export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string({ required_error: 'Reset token is required' }).min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string({ required_error: 'Confirm password is required' }),
  }).refine(
    // Custom refinement: ensure passwords match
    (data) => data.newPassword === data.confirmPassword,
    {
      message: 'Passwords do not match',
      path: ['confirmPassword'], // Error is on the confirmPassword field
    },
  ),
});

// =============================================================================
// REFRESH TOKEN
// =============================================================================
export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z
      .string({ required_error: 'Refresh token is required' })
      .min(1, 'Refresh token is required'),
  }),
});

// =============================================================================
// TypeScript types inferred directly from Zod schemas
// =============================================================================
// z.infer extracts the TypeScript type — no need to define it separately!
// This is "single source of truth" — schema IS the type definition.
export type RegisterBody = z.infer<typeof registerSchema>['body'];
export type LoginBody = z.infer<typeof loginSchema>['body'];
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>['body'];
export type RefreshTokenBody = z.infer<typeof refreshTokenSchema>['body'];
