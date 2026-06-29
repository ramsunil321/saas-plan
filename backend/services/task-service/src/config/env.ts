// =============================================================================
// TASK SERVICE — Environment Configuration
// =============================================================================
// Validates all environment variables at startup using Zod.
// The process crashes immediately with clear errors if any required var is missing.
// This is the "fail fast" principle — it's better to crash at startup than to
// crash later when the missing config is actually needed.
//
// INTERVIEW QUESTION: "Why validate env vars at startup?"
// Answer: If DATABASE_URL is wrong, you'd rather know immediately when the
// container starts, not 30 seconds later when the first DB query fails.
// Startup validation provides clear error messages identifying WHICH var is
// wrong, rather than cryptic runtime errors.
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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3003'),

  // Shared PostgreSQL database (same DB as all other services)
  DATABASE_URL: z.string().url(),

  // Redis for caching task boards and task details
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CACHE_TTL_SECONDS: z.string().transform(Number).default('300'), // 5 minutes

  // RabbitMQ — publishes task events consumed by Notification Service
  RABBITMQ_URL: z.string().default('amqp://flowforge:flowforge123@localhost:5672'),

  // JWT — validates access tokens issued by auth-service
  // Same secret as auth-service (HS256 symmetric key).
  // Production alternative: RS256 with separate public/private keys
  JWT_ACCESS_SECRET: z.string().min(32),

  // Frontend URL — used in notification messages
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // File upload configuration
  MAX_FILE_SIZE_MB: z.string().transform(Number).default('10'),
  UPLOAD_DIR: z.string().default('./uploads'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ [TaskService] Invalid environment variables:');
  parsed.error.issues.forEach((i) => {
    console.error(`  • ${i.path.join('.')}: ${i.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
