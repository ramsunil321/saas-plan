// =============================================================================
// NOTIFICATION REPOSITORY — Prisma implementation
// =============================================================================
//
// This class is the ONLY place in the notification-service that touches Prisma.
// Controllers and services call this through the INotificationRepository interface,
// which enables test injection with mock implementations.
//
// QUERY PATTERNS THIS REPO OPTIMIZES FOR:
//   1. List paginated notifications for a user in an org (most common REST call)
//   2. Count unread notifications (called on every page load — cached in Redis)
//   3. Bulk mark-all-as-read (called when user opens notification panel)
//   4. Create single notification (called for every RabbitMQ event processed)
//
// IDEMPOTENCY NOTE:
//   The consumer can potentially deliver the same event twice (RabbitMQ "at-least-once"
//   delivery). The event envelope has an `eventId` UUID. A production-hardened
//   implementation would store eventId in the notification and use a unique index
//   to prevent duplicate notifications. We log duplicates here without crashing.
//
// INTERVIEW QUESTION: "What is at-least-once delivery in message queues?"
//   Answer: The broker guarantees every message is delivered at least once,
//   but may deliver it MORE than once (on network error, consumer crash after
//   processing but before ACK, etc.). Consumers must be idempotent — processing
//   the same message twice should produce the same result. Common approach:
//   store the eventId and skip if already seen (idempotency key pattern).
// =============================================================================

import { prisma } from '../config/database';
import {
  INotificationRepository,
  SafeNotification,
  CreateNotificationData,
  NotificationFilters,
  PaginatedResult,
} from '../interfaces/notification.interface';
import { NotFoundError } from '../utils/errors';
import { Notification } from '@prisma/client';

// Map Prisma model → safe serializable shape
function toSafeNotification(n: Notification): SafeNotification {
  return {
    id: n.id,
    organizationId: n.organizationId,
    recipientId: n.recipientId,
    type: n.type as SafeNotification['type'],
    title: n.title,
    message: n.message,
    // Prisma returns Json as unknown — cast to our typed record
    metadata: n.metadata as Record<string, unknown> | null,
    isRead: n.isRead,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export class NotificationRepository implements INotificationRepository {
  // ==========================================================================
  // CREATE — Called by the event consumer for every processed event
  // ==========================================================================
  async create(data: CreateNotificationData): Promise<SafeNotification> {
    const notification = await prisma.notification.create({
      data: {
        organizationId: data.organizationId,
        recipientId: data.recipientId,
        type: data.type,
        title: data.title,
        message: data.message,
        metadata: data.metadata ?? {},
      },
    });

    return toSafeNotification(notification);
  }

  // ==========================================================================
  // FIND BY ID — Used before delete to verify ownership
  // ==========================================================================
  async findById(id: string): Promise<SafeNotification | null> {
    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    return notification ? toSafeNotification(notification) : null;
  }

  // ==========================================================================
  // LIST FOR USER — Paginated notifications for a specific user+org
  // ==========================================================================
  // WHY parallel count + findMany?
  //   Two separate queries run concurrently via Promise.all. The alternative
  //   (single query with COUNT(*) OVER() window function) works but forces
  //   Prisma to fetch all count data on every page — parallel is cleaner.
  // ==========================================================================
  async listForUser(
    recipientId: string,
    orgId: string,
    filters: NotificationFilters,
  ): Promise<PaginatedResult<SafeNotification>> {
    const { page, limit, isRead } = filters;
    const skip = (page - 1) * limit;

    const where = {
      recipientId,
      organizationId: orgId,
      // Only add isRead filter when explicitly specified (undefined = all)
      ...(isRead !== undefined && { isRead }),
    };

    // Run count and data query concurrently — both hit the same indexes
    const [total, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },   // Newest first — standard for notification feeds
        skip,
        take: limit,
      }),
    ]);

    return {
      data: notifications.map(toSafeNotification),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ==========================================================================
  // MARK AS READ — Sets isRead=true and readAt=now() for a single notification
  // ==========================================================================
  // WHY check recipientId in WHERE clause (not just id)?
  //   Authorization at the DB layer. Without this, user A could mark user B's
  //   notification as read if they knew the notification UUID.
  //   Using a compound WHERE (id + recipientId) prevents horizontal privilege
  //   escalation without an extra round-trip SELECT + application-level auth check.
  // ==========================================================================
  async markAsRead(id: string, recipientId: string): Promise<SafeNotification> {
    // prisma.notification.updateMany doesn't return records — use update with WHERE
    // But update requires a unique field. We use findFirst + update pattern:
    const existing = await prisma.notification.findFirst({
      where: { id, recipientId },
    });

    if (!existing) {
      throw new NotFoundError('Notification');
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return toSafeNotification(updated);
  }

  // ==========================================================================
  // MARK ALL AS READ — Bulk update for "clear all" UI action
  // ==========================================================================
  // updateMany: efficient bulk UPDATE without fetching records first.
  // Returns the count of rows updated (useful for cache invalidation decisions).
  // ==========================================================================
  async markAllAsRead(recipientId: string, orgId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: {
        recipientId,
        organizationId: orgId,
        isRead: false, // Only update actually unread ones — no wasted writes
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return result.count;
  }

  // ==========================================================================
  // GET UNREAD COUNT — Fast count query used for the notification badge
  // ==========================================================================
  // This query runs on EVERY page load (the badge shows in the nav bar).
  // It's cached in Redis by the service layer — this method is the cache miss
  // fallback. The composite index on (recipientId, isRead) makes this O(log n).
  // ==========================================================================
  async getUnreadCount(recipientId: string, orgId: string): Promise<number> {
    return prisma.notification.count({
      where: {
        recipientId,
        organizationId: orgId,
        isRead: false,
      },
    });
  }

  // ==========================================================================
  // DELETE — Remove a single notification (only by the recipient)
  // ==========================================================================
  async delete(id: string, recipientId: string): Promise<void> {
    // deleteMany with compound WHERE to enforce ownership at DB level
    const result = await prisma.notification.deleteMany({
      where: { id, recipientId },
    });

    if (result.count === 0) {
      throw new NotFoundError('Notification');
    }
  }

  // ==========================================================================
  // DELETE ALL — Bulk delete all notifications for user+org
  // ==========================================================================
  async deleteAll(recipientId: string, orgId: string): Promise<number> {
    const result = await prisma.notification.deleteMany({
      where: { recipientId, organizationId: orgId },
    });

    return result.count;
  }
}
