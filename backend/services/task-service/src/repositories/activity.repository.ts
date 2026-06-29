// =============================================================================
// ACTIVITY LOG REPOSITORY — Immutable audit trail
// =============================================================================
//
// DESIGN PRINCIPLES:
//   1. APPEND-ONLY: activity logs are NEVER updated or deleted.
//      Once written, they are an immutable record of what happened.
//      This is why there's no update() or delete() method.
//
//   2. JSONB METADATA: the `metadata` field stores event-specific data.
//      Different events have different shapes:
//        task.status_changed → { from: 'todo', to: 'in_progress', boardName: 'In Progress' }
//        task.assigned       → { assigneeId: '...', assigneeName: 'John Doe' }
//        task.created        → { taskKey: 'FF-42', boardName: 'Todo' }
//      JSONB allows flexible schema without adding columns for each event type.
//
//   3. ACTOR TRACKING: every log entry records who performed the action.
//      This enables audit reports: "John deleted task FF-42 on Jun 7 2026"
//
// INTERVIEW QUESTION: "How would you implement an undo feature?"
//   Answer: Read the activity log to find the last change, extract the `before`
//   state from metadata, and apply it as a new update. This is event sourcing.
//   A full event-sourced system would reconstruct entity state entirely from
//   the event log — no need for a separate data table.
// =============================================================================

import { prisma } from '../config/database';
import {
  IActivityRepository,
  SafeActivityLog,
  CreateActivityData,
  PaginationParams,
  PaginatedResult,
} from '../interfaces/task.interface';

export class ActivityRepository implements IActivityRepository {

  async listForTask(
    organizationId: string,
    taskId: string,
    { page, limit }: PaginationParams,
  ): Promise<PaginatedResult<SafeActivityLog>> {
    const skip = (page - 1) * limit;

    const [total, logs] = await Promise.all([
      prisma.activityLog.count({
        where: { organizationId, entityType: 'task', entityId: taskId },
      }),
      prisma.activityLog.findMany({
        where: { organizationId, entityType: 'task', entityId: taskId },
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
        // Newest first — activity timeline shows most recent at top
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
    ]);

    return {
      data: logs.map((log) => ({
        id: log.id,
        entityType: log.entityType,
        entityId: log.entityId,
        action: log.action,
        metadata: log.metadata as Record<string, unknown> | null,
        createdAt: log.createdAt,
        actor: {
          id: log.actor.id,
          firstName: log.actor.firstName,
          lastName: log.actor.lastName,
          avatarUrl: log.actor.avatarUrl,
        },
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Create is fire-and-forget in most places (non-blocking)
  // Failures are logged but don't fail the main operation
  async create(data: CreateActivityData): Promise<void> {
    await prisma.activityLog.create({
      data: {
        organizationId: data.organizationId,
        entityType: data.entityType,
        entityId: data.entityId,
        action: data.action,
        actorId: data.actorId,
        metadata: data.metadata,
      },
    });
  }
}
