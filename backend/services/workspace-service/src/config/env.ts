// =============================================================================
// WORKSPACE SERVICE — Environment Configuration
// =============================================================================
// Same Zod-validation pattern as auth-service.
// NOTE: In a monorepo (Turborepo/Nx), shared config lives in packages/config.
// Each service copies its own env.ts to stay self-contained for now.
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
  PORT: z.string().transform(Number).default('3002'),

  // Shared PostgreSQL database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CACHE_TTL_SECONDS: z.string().transform(Number).default('300'), // 5 minutes default

  // RabbitMQ — for publishing workspace events
  RABBITMQ_URL: z.string().default('amqp://flowforge:flowforge123@localhost:5672'),

  // JWT — workspace service validates access tokens directly (same secret as auth-service)
  // In a full zero-trust setup, use RS256: auth-service signs with private key,
  // workspace-service verifies with the public key (no secret sharing needed)
  JWT_ACCESS_SECRET: z.string().min(32),

  // Frontend URL — for invitation email links
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // SMTP for invitation emails
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.string().transform(Number).default('587'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@flowforge.io'),

  // Invitation token expiry in hours
  INVITATION_EXPIRES_HOURS: z.string().transform(Number).default('72'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ [WorkspaceService] Invalid environment variables:');
  parsed.error.issues.forEach((i) => {
    console.error(`  • ${i.path.join('.')}: ${i.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
