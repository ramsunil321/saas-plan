// =============================================================================
// TASK EVENT HANDLER
// =============================================================================
//
// Handles events originating from the task-service:
//   task.assigned         → notify the newly assigned user
//   task.unassigned       → notify the removed assignee
//   task.completed        → notify the reporter and all assignees
//   task.status_changed   → notify all assignees of the status change
//   task.deleted          → notify the reporter and all assignees
//   task.comment.added    → notify the task reporter + other assignees
//
// NOTIFICATION TARGETING STRATEGY:
//   Each event type has different recipients. For task events, we notify:
//     - task.assigned: only the newly assigned user (they care most)
//     - task.completed: reporter + all assignees (project stakeholders)
//     - task.comment.added: task reporter + all assignees except the commenter
//   This targeting avoids notification fatigue — don't notify people who don't care.
//
// INTERVIEW QUESTION: "How would you scale notification fanout?"
//   Answer: For events like "project.created" targeting 1000 members,
//   creating 1000 Postgres INSERTs synchronously blocks the consumer.
//   Solutions:
//     1. Batch INSERT (Prisma createMany) — single query for all recipients
//     2. Second-level fanout queue — push recipient IDs into a worker queue
//        that creates notifications in parallel workers (like Facebook's Haystack)
//     3. Lazy notification creation — store one record with a "seen by" bitmap
//   For FlowForge MVP, Promise.all() with individual inserts is acceptable.
// =============================================================================

import { FlowForgeEvent } from '../../config/rabbitmq';
import { NotificationService } from '../../services/notification.service';
import { logger } from '../../utils/logger';

export class TaskHandler {
  constructor(private readonly notificationService: NotificationService) {}

  async handle(event: FlowForgeEvent): Promise<void> {
    switch (event.eventType) {
      case 'task.assigned':
        await this.onTaskAssigned(event);
        break;
      case 'task.unassigned':
        await this.onTaskUnassigned(event);
        break;
      case 'task.completed':
        await this.onTaskCompleted(event);
        break;
      case 'task.status_changed':
        await this.onTaskStatusChanged(event);
        break;
      case 'task.deleted':
        await this.onTaskDeleted(event);
        break;
      case 'task.comment.added':
        await this.onCommentAdded(event);
        break;
      default:
        logger.debug('[TaskHandler] Unknown event type, skipping', { eventType: event.eventType });
    }
  }

  // ==========================================================================
  // task.assigned
  // ==========================================================================
  // Payload: { taskId, taskKey, taskTitle, projectId, projectName, assigneeId, assigneeName }
  // Target: the newly assigned user only (the assigner already knows)
  // ==========================================================================
  private async onTaskAssigned(event: FlowForgeEvent): Promise<void> {
    const payload = event.payload as {
      taskId: string;
      taskKey: string;       // e.g. "FF-42"
      taskTitle: string;
      projectId: string;
      projectName: string;
      assigneeId: string;
      assigneeName: string;
    };

    // Don't notify if the actor assigned themselves
    if (payload.assigneeId === event.actorId) return;

    await this.notificationService.create({
      organizationId: event.organizationId,
      recipientId: payload.assigneeId,
      type: 'TASK_ASSIGNED',
      title: `Assigned to ${payload.taskKey}`,
      message: `You've been assigned to "${payload.taskTitle}" in ${payload.projectName}.`,
      metadata: {
        taskId: payload.taskId,
        taskKey: payload.taskKey,
        taskTitle: payload.taskTitle,
        projectId: payload.projectId,
        projectName: payload.projectName,
        actorId: event.actorId,
      },
    });

    logger.info('[TaskHandler] Handled task.assigned', {
      eventId: event.eventId,
      taskId: payload.taskId,
      assigneeId: payload.assigneeId,
    });
  }

  // ==========================================================================
  // task.unassigned
  // ==========================================================================
  // Payload: { taskId, taskKey, taskTitle, projectId, projectName, unassignedUserId }
  // ==========================================================================
  private async onTaskUnassigned(event: FlowForgeEvent): Promise<void> {
    const payload = event.payload as {
      taskId: string;
      taskKey: string;
      taskTitle: string;
      projectId: string;
      projectName: string;
      unassignedUserId: string;
    };

    if (payload.unassignedUserId === event.actorId) return;

    await this.notificationService.create({
      organizationId: event.organizationId,
      recipientId: payload.unassignedUserId,
      type: 'TASK_UNASSIGNED',
      title: `Removed from ${payload.taskKey}`,
      message: `You've been unassigned from "${payload.taskTitle}" in ${payload.projectName}.`,
      metadata: {
        taskId: payload.taskId,
        taskKey: payload.taskKey,
        taskTitle: payload.taskTitle,
        projectId: payload.projectId,
        projectName: payload.projectName,
        actorId: event.actorId,
      },
    });

    logger.info('[TaskHandler] Handled task.unassigned', { eventId: event.eventId });
  }

  // ==========================================================================
  // task.completed
  // ==========================================================================
  // Payload: { taskId, taskKey, taskTitle, projectId, projectName, reporterId, assigneeIds[] }
  // Targets: reporter + all assignees (except the actor who marked it done)
  // ==========================================================================
  private async onTaskCompleted(event: FlowForgeEvent): Promise<void> {
    const payload = event.payload as {
      taskId: string;
      taskKey: string;
      taskTitle: string;
      projectId: string;
      projectName: string;
      reporterId: string;
      assigneeIds: string[];
    };

    // Deduplicate: reporter might also be an assignee
    const recipientSet = new Set([payload.reporterId, ...payload.assigneeIds]);
    // Don't notify the actor who completed it
    recipientSet.delete(event.actorId);
    const recipients = Array.from(recipientSet);

    await Promise.all(
      recipients.map((recipientId) =>
        this.notificationService.create({
          organizationId: event.organizationId,
          recipientId,
          type: 'TASK_COMPLETED',
          title: `${payload.taskKey} completed`,
          message: `"${payload.taskTitle}" in ${payload.projectName} has been marked as complete.`,
          metadata: {
            taskId: payload.taskId,
            taskKey: payload.taskKey,
            taskTitle: payload.taskTitle,
            projectId: payload.projectId,
            projectName: payload.projectName,
            actorId: event.actorId,
          },
        }),
      ),
    );

    logger.info('[TaskHandler] Handled task.completed', {
      eventId: event.eventId,
      taskId: payload.taskId,
      recipientCount: recipients.length,
    });
  }

  // ==========================================================================
  // task.status_changed
  // ==========================================================================
  // Payload: { taskId, taskKey, taskTitle, projectId, projectName, from, to, assigneeIds[] }
  // Targets: all assignees except the actor who changed the status
  // ==========================================================================
  private async onTaskStatusChanged(event: FlowForgeEvent): Promise<void> {
    const payload = event.payload as {
      taskId: string;
      taskKey: string;
      taskTitle: string;
      projectId: string;
      projectName: string;
      from: string;
      to: string;
      assigneeIds: string[];
    };

    const recipients = payload.assigneeIds.filter((id) => id !== event.actorId);
    if (recipients.length === 0) return;

    await Promise.all(
      recipients.map((recipientId) =>
        this.notificationService.create({
          organizationId: event.organizationId,
          recipientId,
          type: 'TASK_STATUS_CHANGED',
          title: `${payload.taskKey} moved to ${payload.to}`,
          message: `"${payload.taskTitle}" was moved from ${payload.from} to ${payload.to} in ${payload.projectName}.`,
          metadata: {
            taskId: payload.taskId,
            taskKey: payload.taskKey,
            taskTitle: payload.taskTitle,
            projectId: payload.projectId,
            projectName: payload.projectName,
            fromStatus: payload.from,
            toStatus: payload.to,
            actorId: event.actorId,
          },
        }),
      ),
    );

    logger.info('[TaskHandler] Handled task.status_changed', { eventId: event.eventId });
  }

  // ==========================================================================
  // task.deleted
  // ==========================================================================
  // Payload: { taskId, taskKey, taskTitle, projectId, projectName, reporterId, assigneeIds[] }
  // Targets: reporter + all assignees (they should know their task is gone)
  // ==========================================================================
  private async onTaskDeleted(event: FlowForgeEvent): Promise<void> {
    const payload = event.payload as {
      taskId: string;
      taskKey: string;
      taskTitle: string;
      projectId: string;
      projectName: string;
      reporterId: string;
      assigneeIds: string[];
    };

    const recipientSet = new Set([payload.reporterId, ...payload.assigneeIds]);
    recipientSet.delete(event.actorId);
    const recipients = Array.from(recipientSet);

    await Promise.all(
      recipients.map((recipientId) =>
        this.notificationService.create({
          organizationId: event.organizationId,
          recipientId,
          type: 'TASK_DELETED',
          title: `${payload.taskKey} was deleted`,
          message: `"${payload.taskTitle}" in ${payload.projectName} has been deleted.`,
          metadata: {
            taskKey: payload.taskKey,
            taskTitle: payload.taskTitle,
            projectId: payload.projectId,
            projectName: payload.projectName,
            actorId: event.actorId,
          },
        }),
      ),
    );

    logger.info('[TaskHandler] Handled task.deleted', { eventId: event.eventId });
  }

  // ==========================================================================
  // task.comment.added
  // ==========================================================================
  // Payload: { taskId, taskKey, taskTitle, projectId, projectName, commentId,
  //            commentAuthorName, commentPreview, reporterId, assigneeIds[] }
  // commentPreview: first 100 chars of the comment for the notification message
  // Targets: reporter + all assignees, EXCLUDING the comment author
  // ==========================================================================
  private async onCommentAdded(event: FlowForgeEvent): Promise<void> {
    const payload = event.payload as {
      taskId: string;
      taskKey: string;
      taskTitle: string;
      projectId: string;
      projectName: string;
      commentId: string;
      commentAuthorName: string;
      commentPreview: string;    // truncated preview of the comment text
      reporterId: string;
      assigneeIds: string[];
    };

    const recipientSet = new Set([payload.reporterId, ...payload.assigneeIds]);
    // The commenter (actorId) should not receive a notification about their own comment
    recipientSet.delete(event.actorId);
    const recipients = Array.from(recipientSet);

    if (recipients.length === 0) return;

    await Promise.all(
      recipients.map((recipientId) =>
        this.notificationService.create({
          organizationId: event.organizationId,
          recipientId,
          type: 'COMMENT_ADDED',
          title: `New comment on ${payload.taskKey}`,
          message: `${payload.commentAuthorName} commented: "${payload.commentPreview}"`,
          metadata: {
            taskId: payload.taskId,
            taskKey: payload.taskKey,
            taskTitle: payload.taskTitle,
            projectId: payload.projectId,
            projectName: payload.projectName,
            commentId: payload.commentId,
            actorId: event.actorId,
          },
        }),
      ),
    );

    logger.info('[TaskHandler] Handled task.comment.added', {
      eventId: event.eventId,
      taskId: payload.taskId,
      recipientCount: recipients.length,
    });
  }
}
