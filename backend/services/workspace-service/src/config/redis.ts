// Redis client singleton for workspace-service.
// See auth-service/src/config/redis.ts for full documentation.
import Redis from 'ioredis';
import { env } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

const createRedisClient = () =>
  new Redis(env.REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 100, 5000),
    keyPrefix: 'workspace:', // All keys namespaced to workspace service
    enableOfflineQueue: env.NODE_ENV !== 'production',
  });

export const redis = global.__redis ?? createRedisClient();

if (env.NODE_ENV !== 'production') {
  global.__redis = redis;
}

process.on('beforeExit', async () => {
  await redis.quit();
});

// =============================================================================
// WORKSPACE REDIS KEY PATTERNS
// =============================================================================
// Centralized key definitions prevent typos and make cache behavior visible.
// The 'workspace:' prefix is added automatically by ioredis keyPrefix.
// =============================================================================
export const CacheKeys = {
  // Organization detail — invalidated on any org update
  organization: (orgId: string) => `org:${orgId}`,

  // List of all projects in an org — invalidated on project create/update/delete
  projectList: (orgId: string) => `org:${orgId}:projects`,

  // Single project — invalidated on update/delete
  project: (orgId: string, projectId: string) => `org:${orgId}:project:${projectId}`,

  // Org member list — invalidated on member add/remove
  memberList: (orgId: string) => `org:${orgId}:members`,

  // Team list for an org
  teamList: (orgId: string) => `org:${orgId}:teams`,

  // Board list for a project
  boardList: (orgId: string, projectId: string) => `org:${orgId}:project:${projectId}:boards`,

  // User's org memberships — invalidated when user joins/leaves an org
  userOrgs: (userId: string) => `user:${userId}:orgs`,
} as const;
