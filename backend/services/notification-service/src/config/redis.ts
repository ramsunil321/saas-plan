// =============================================================================
// REDIS — Connection Singleton + Cache Key Factory
// =============================================================================
// keyPrefix 'notif:' prevents collision with other services on shared Redis.
//
// WHAT THIS SERVICE CACHES:
//   Unread notification counts per user — queried on every UI page load to
//   show the notification badge. Cached for 5 minutes, invalidated when
//   a new notification is created or notifications are marked as read.
// =============================================================================

import Redis from 'ioredis';
import { env } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

export const redis: Redis = global.__redis ?? new Redis(env.REDIS_URL, {
  keyPrefix: 'notif:',
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableReadyCheck: true,
});

if (env.NODE_ENV !== 'production') {
  global.__redis = redis;
}

redis.on('error', (err: Error) => {
  console.error('[NotificationService Redis] Connection error:', err.message);
});

export const CacheKeys = {
  // Unread notification count for a user in a specific org (shown as badge)
  unreadCount: (userId: string, orgId: string) => `user:${userId}:org:${orgId}:unread`,

  // Total unread across all orgs (global badge in UI)
  totalUnread: (userId: string) => `user:${userId}:unread`,
};
