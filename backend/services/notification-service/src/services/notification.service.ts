// =============================================================================
// NOTIFICATION SERVICE — Business logic layer
// =============================================================================
//
// This service sits between the HTTP controllers / event consumer and the
// repository layer. It handles:
//   1. Creating notifications (called by the event consumer)
//   2. Sending emails for high-priority notification types (fire-and-forget)
//   3. Cache invalidation on writes (unread count cache)
//   4. Cache-aside reads for unread count (Redis → DB fallback)
//
// DEPENDENCY INJECTION:
//   The constructor accepts INotificationRepository, not NotificationRepository.
//   This means tests can inject a mock without touching Prisma.
//   Manual DI: server.ts creates the concrete instance and passes it here.
//
// EMAIL STRATEGY:
//   Emails are sent fire-and-forget: we don't await the email send, and
//   failures don't propagate (they are logged). Rationale: the user's
//   notification was already created in the DB — the email is a bonus delivery
//   channel. A failed email should never fail the entire consumer message.
//
// CACHE STRATEGY (Cache-Aside / Lazy Loading):
//   Read:  check Redis first → miss → read from DB → store in Redis
//   Write: write to DB → then delete (invalidate) the Redis cache key
//   WHY DELETE instead of UPDATE the cache?
//     Deleting is simpler and avoids a race condition where the cache is
//     updated before the DB transaction commits (especially with bulk operations).
//     The next read will repopulate the cache from the fresh DB state.
//
// INTERVIEW QUESTION: "What is cache invalidation and why is it hard?"
//   Answer: Ensuring cached data is removed/updated when the source data changes.
//   It's hard because cache and DB are separate systems with no atomic transaction.
//   The window between DB write and cache invalidation can serve stale data.
//   Common strategies: TTL expiry (eventual), write-through (synchronous), and
//   delete-on-write (lazy reload). Each has latency vs consistency tradeoffs.
// =============================================================================

import nodemailer from 'nodemailer';
import { INotificationRepository, SafeNotification, CreateNotificationData, NotificationFilters, PaginatedResult } from '../interfaces/notification.interface';
import { redis, CacheKeys } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';

// =============================================================================
// EMAIL TRANSPORTER
// =============================================================================
// Nodemailer transporter singleton. Uses SMTP credentials from env.
// In development without SMTP_USER/PASS, falls back to a no-op (skip email).
// In production, you'd add SES or SendGrid transport here.
// =============================================================================
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465, // true for port 465 (SMTPS), false for 587 (STARTTLS)
  auth: env.SMTP_USER && env.SMTP_PASS
    ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
    : undefined,
});

// Notification types that warrant an email (not just in-app badge)
// Low-importance types (status changes, project created) only get in-app notifications
const EMAIL_WORTHY_TYPES = new Set([
  'TASK_ASSIGNED',
  'TASK_COMPLETED',
  'COMMENT_ADDED',
  'WORKSPACE_MEMBER_JOINED',
  'WORKSPACE_MEMBER_REMOVED',
]);

export class NotificationService {
  constructor(private readonly notificationRepo: INotificationRepository) {}

  // ==========================================================================
  // CREATE — Called by event consumer handlers for every processed event
  // ==========================================================================
  async create(data: CreateNotificationData): Promise<SafeNotification> {
    const notification = await this.notificationRepo.create(data);

    // Invalidate unread count cache — the new notification is unread
    // Fire-and-forget: cache errors should not fail notification creation
    this.invalidateUnreadCache(data.recipientId, data.organizationId).catch((err) => {
      logger.warn('[NotificationService] Cache invalidation failed', { error: err.message });
    });

    // Send email for high-priority notification types — fire-and-forget
    if (EMAIL_WORTHY_TYPES.has(data.type) && env.SMTP_USER) {
      this.sendEmail(notification).catch((err) => {
        logger.warn('[NotificationService] Email send failed', {
          notificationId: notification.id,
          error: err.message,
        });
      });
    }

    return notification;
  }

  // ==========================================================================
  // LIST FOR USER — Paginated notifications for the REST API
  // ==========================================================================
  async list(
    recipientId: string,
    orgId: string,
    filters: NotificationFilters,
  ): Promise<PaginatedResult<SafeNotification>> {
    return this.notificationRepo.listForUser(recipientId, orgId, filters);
  }

  // ==========================================================================
  // GET UNREAD COUNT — Cached count for the notification badge
  // ==========================================================================
  // Cache-aside: check Redis → miss → query DB → store in Redis
  // TTL: env.CACHE_TTL_SECONDS (default 300s = 5 minutes)
  // The cache is invalidated on every new notification and every markRead.
  // ==========================================================================
  async getUnreadCount(recipientId: string, orgId: string): Promise<number> {
    const cacheKey = CacheKeys.unreadCount(recipientId, orgId);

    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return parseInt(cached, 10);
    }

    // Cache miss — query DB
    const count = await this.notificationRepo.getUnreadCount(recipientId, orgId);

    // Store in cache with TTL
    await redis.set(cacheKey, count.toString(), 'EX', env.CACHE_TTL_SECONDS);

    return count;
  }

  // ==========================================================================
  // MARK AS READ — Marks a single notification as read
  // ==========================================================================
  async markAsRead(id: string, recipientId: string, orgId: string): Promise<SafeNotification> {
    const notification = await this.notificationRepo.markAsRead(id, recipientId);

    // Invalidate cache — unread count has decreased
    this.invalidateUnreadCache(recipientId, orgId).catch((err) => {
      logger.warn('[NotificationService] Cache invalidation failed on markAsRead', { error: err.message });
    });

    return notification;
  }

  // ==========================================================================
  // MARK ALL AS READ — Bulk mark all unread as read
  // ==========================================================================
  async markAllAsRead(recipientId: string, orgId: string): Promise<number> {
    const count = await this.notificationRepo.markAllAsRead(recipientId, orgId);

    // Invalidate cache — all unread are now gone
    if (count > 0) {
      this.invalidateUnreadCache(recipientId, orgId).catch((err) => {
        logger.warn('[NotificationService] Cache invalidation failed on markAllAsRead', { error: err.message });
      });
    }

    return count;
  }

  // ==========================================================================
  // DELETE — Remove a single notification
  // ==========================================================================
  // orgId comes from the notification record itself (not the caller) so the
  // cache invalidation key is always correct regardless of what the client sends.
  // ==========================================================================
  async delete(id: string, recipientId: string): Promise<void> {
    // findById first to check if the notification was unread and get its orgId
    const notification = await this.notificationRepo.findById(id);
    if (!notification) {
      throw new NotFoundError('Notification');
    }

    await this.notificationRepo.delete(id, recipientId);

    // Only invalidate if the deleted notification was unread (count changed)
    if (!notification.isRead) {
      this.invalidateUnreadCache(recipientId, notification.organizationId).catch((err) => {
        logger.warn('[NotificationService] Cache invalidation failed on delete', { error: err.message });
      });
    }
  }

  // ==========================================================================
  // DELETE ALL — Bulk clear all notifications
  // ==========================================================================
  async deleteAll(recipientId: string, orgId: string): Promise<number> {
    const count = await this.notificationRepo.deleteAll(recipientId, orgId);

    // Invalidate cache after bulk delete
    if (count > 0) {
      this.invalidateUnreadCache(recipientId, orgId).catch((err) => {
        logger.warn('[NotificationService] Cache invalidation failed on deleteAll', { error: err.message });
      });
    }

    return count;
  }

  // ==========================================================================
  // PRIVATE: SEND EMAIL
  // ==========================================================================
  // Builds and sends an HTML email for the notification.
  // Called fire-and-forget — errors are caught by the caller.
  // Deep-link URL uses env.FRONTEND_URL so users can click directly to the entity.
  // ==========================================================================
  private async sendEmail(notification: SafeNotification): Promise<void> {
    const metadata = notification.metadata ?? {};
    const taskKey = metadata.taskKey as string | undefined;
    const taskId = metadata.taskId as string | undefined;
    const projectId = metadata.projectId as string | undefined;

    // Build deep link — links to the task if available, else the project, else the app root
    let deepLink = env.FRONTEND_URL;
    if (projectId && taskId) {
      deepLink = `${env.FRONTEND_URL}/projects/${projectId}/tasks/${taskId}`;
    } else if (projectId) {
      deepLink = `${env.FRONTEND_URL}/projects/${projectId}`;
    }

    const subject = taskKey
      ? `[FlowForge] ${notification.title} — ${taskKey}`
      : `[FlowForge] ${notification.title}`;

    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to: notification.recipientId, // In production, resolve recipientId → email via DB lookup
      subject,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #3b82f6;">${notification.title}</h2>
          <p style="color: #374151; font-size: 16px;">${notification.message}</p>
          <a href="${deepLink}" style="
            display: inline-block;
            margin-top: 16px;
            padding: 12px 24px;
            background: #3b82f6;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
          ">View in FlowForge</a>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">
            You're receiving this because you're a member of a FlowForge workspace.
            <a href="${env.FRONTEND_URL}/settings/notifications" style="color: #9ca3af;">Manage preferences</a>
          </p>
        </div>
      `,
    });

    logger.debug('[NotificationService] Email sent', { notificationId: notification.id });
  }

  // ==========================================================================
  // PRIVATE: INVALIDATE UNREAD CACHE
  // ==========================================================================
  private async invalidateUnreadCache(recipientId: string, orgId: string): Promise<void> {
    const key = CacheKeys.unreadCount(recipientId, orgId);
    await redis.del(key);
  }
}
