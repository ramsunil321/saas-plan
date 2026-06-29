// =============================================================================
// ENVIRONMENT CONFIGURATION — Validated with Zod
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Raw process.env values are always strings (or undefined). If a required
//   environment variable is missing, your app crashes at runtime with a cryptic
//   "Cannot read property X of undefined" error — possibly in production.
//
//   This file validates ALL environment variables at startup using Zod.
//   If anything is missing or wrong, the process exits immediately with a
//   clear error message BEFORE the server starts. Fail fast, fail loud.
//
// HOW IT WORKS:
//   1. We define a Zod schema that describes every env var (type + default)
//   2. z.object({...}).parse(process.env) validates and transforms all at once
//   3. We export a typed `env` object — all values are guaranteed correct types
//   4. TypeScript knows exactly what `env.PORT` is (number, not string|undefined)
//
// INTERVIEW QUESTION:
//   "How do you manage environment variables safely in Node.js?"
//   Answer: Validate at startup with a schema library (Zod/Joi). This ensures:
//   1. Required vars are present before the app starts
//   2. Types are correct (PORT is a number, not "3000" string)
//   3. Defaults are applied centrally (not scattered across the codebase)
//   4. A single source of truth for all configuration
//
// BEST PRACTICE:
//   Never access process.env directly outside this file.
//   Always import from this config module. This makes tests easier (you can
//   mock this module) and prevents typos like process.env.DATABSE_URL.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { z } from 'zod';

type ProcessWithLoadEnvFile = NodeJS.Process & {
  loadEnvFile?: (path?: string) => void;
};

const loadEnvFile = (): void => {
  const processWithLoadEnvFile = process as ProcessWithLoadEnvFile;

  if (typeof processWithLoadEnvFile.loadEnvFile !== 'function') {
    return;
  }

  const envFileCandidates = [
    process.env.DOTENV_CONFIG_PATH,
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
  ].filter((filePath): filePath is string => Boolean(filePath));

  for (const envFilePath of envFileCandidates) {
    if (!fs.existsSync(envFilePath)) {
      continue;
    }

    processWithLoadEnvFile.loadEnvFile(envFilePath);
    break;
  }
};

loadEnvFile();

// Define the schema for all required and optional environment variables
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),

  // Database
  // DATABASE_URL format: postgresql://user:password@host:port/dbname
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection string'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT — Access tokens are short-lived (15 minutes), stored in memory on client
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),

  // JWT — Refresh tokens are long-lived (7 days), stored in httpOnly cookie
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Email (SMTP) — for verification and password reset emails
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.string().transform(Number).default('587'),
  SMTP_USER: z.string().email().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@flowforge.io'),

  // Frontend URL — for generating clickable links in emails
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // Bcrypt cost factor — higher = more secure but slower
  // 12 is the current industry recommendation for production
  BCRYPT_ROUNDS: z.string().transform(Number).default('12'),

  // Rate limiting — requests per window
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),
});

// parse() throws a ZodError with detailed messages if validation fails
// This crashes the process immediately at startup — intentional!
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:');
  // Format Zod errors into human-readable messages
  parsedEnv.error.issues.forEach((issue) => {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  });
  // Exit with non-zero code to signal failure to process managers (Docker, PM2)
  process.exit(1);
}

// Export the validated, type-safe configuration object
// TypeScript infers the exact type from the Zod schema — no manual interface needed
export const env = parsedEnv.data;

// Type export for use in tests or when passing config around
export type Env = z.infer<typeof envSchema>;
