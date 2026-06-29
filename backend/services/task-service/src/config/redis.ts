// =============================================================================
// REDIS — Connection Singleton + Cache Key Factory
// =============================================================================
//
// WHY DIFFERENT KEY PREFIXES PER SERVICE?
//   Each microservice uses its own Redis key prefix ('task:').
//   This prevents key collisions when services share a Redis instance.
//   In production, you might use separate Redis instances per service,
//   but a shared instance with prefixes is fine for most scales.
//
// CACHE KEY DESIGN:
//   Keys follow a hierarchical naming convention:
//   org:{orgId}:task:{taskId}  → single task
//   org:{orgId}:project:{projectId}:board:{boardId}:tasks  → board task list
//
//   This hierarchy allows efficient pattern-based invalidation:
//   When a task is updated, invalidate org:{orgId}:task:{taskId}
//   When board changes, invalidate the board's task list
// =============================================================================

import Redis from 'ioredis';
import { env } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

export const redis: Redis = global.__redis ?? new Redis(env.REDIS_URL, {
  // All keys stored by this service will have this prefix
  // Prevents collision with auth-service keys (auth:*) and workspace-service keys (workspace:*)
  keyPrefix: 'task:',
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableReadyCheck: true,
});

if (env.NODE_ENV !== 'production') {
  global.__redis = redis;
}

redis.on('error', (err: Error) => {
  console.error('[TaskService Redis] Connection error:', err.message);
});

// =============================================================================
// CACHE KEY FACTORY
// =============================================================================
// Centralized key generation prevents scattered string literals (typo-prone).
// All cache keys for the task service are defined here.
// =============================================================================

export const CacheKeys = {
  // Single task with full details (assignees, counts)
  task: (orgId: string, taskId: string) => `org:${orgId}:task:${taskId}`,

  // All tasks in a specific board column (Kanban view)
  boardTasks: (orgId: string, projectId: string, boardId: string) =>
    `org:${orgId}:project:${projectId}:board:${boardId}:tasks`,

  // All tasks in a project (list view with filters)
  projectTasks: (orgId: string, projectId: string) =>
    `org:${orgId}:project:${projectId}:tasks`,

  // Comments for a specific task
  taskComments: (taskId: string) => `task:${taskId}:comments`,

  // Attachments list for a specific task
  taskAttachments: (taskId: string) => `task:${taskId}:attachments`,

  // Activity log for a specific task
  taskActivity: (taskId: string) => `task:${taskId}:activity`,
};
