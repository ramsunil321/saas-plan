// =============================================================================
// NOTIFICATION SERVICE — Environment Configuration
// =============================================================================
// Zod-validated env vars — process exits immediately on misconfiguration.
// This service requires both JWT (for REST API) and RabbitMQ (for consumer).
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
  PORT: z.string().transform(Number).default('3004'),

  // Shared PostgreSQL database — reads notifications table + user/task data for context
  DATABASE_URL: z.string().url(),

  // Redis — caches unread notification count per user (queried on every page load)
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CACHE_TTL_SECONDS: z.string().transform(Number).default('300'),

  // RabbitMQ — CONSUME workspace.# and task.# events
  RABBITMQ_URL: z.string().default('amqp://flowforge:flowforge123@localhost:5672'),

  // JWT — validates access tokens for the REST API endpoints
  JWT_ACCESS_SECRET: z.string().min(32),

  // Frontend URL — used in email notification links
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // SMTP — sends email notifications for high-priority events (task assigned, etc.)
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.string().transform(Number).default('587'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@flowforge.io'),

  // Consumer config
  // Maximum number of messages to process concurrently before pausing consumption
  // INTERVIEW QUESTION: "What is prefetch count in RabbitMQ?"
  // Answer: Prefetch limits how many unacknowledged messages a consumer holds at once.
  // prefetch=1: process one message at a time (fair dispatch, slower throughput).
  // prefetch=10: hold up to 10 unacked messages (faster, but 10 messages lost on crash).
  // For notification emails (can be slow), prefetch=1 is safest.
  CONSUMER_PREFETCH: z.string().transform(Number).default('1'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ [NotificationService] Invalid environment variables:');
  parsed.error.issues.forEach((i) => {
    console.error(`  • ${i.path.join('.')}: ${i.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
