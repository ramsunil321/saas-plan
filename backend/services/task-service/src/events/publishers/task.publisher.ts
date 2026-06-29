// =============================================================================
// TASK EVENT PUBLISHER — Publishes task mutation events to RabbitMQ
// =============================================================================
//
// WHEN EVENTS ARE PUBLISHED:
//   - task.created      → team members may want to know about new work
//   - task.assigned     → the assignee MUST be notified (primary use case)
//   - task.unassigned   → assignee should know they were removed
//   - task.status_changed → reporter and assignees want to track progress
//   - task.completed    → reporter, assignees, managers want to know
//   - task.deleted      → assignees need to know their task is gone
//   - task.comment.added → task followers (reporter + assignees) should be notified
//   - task.attachment.added → informational
//
// WHAT HAPPENS ON EVENT:
//   The Notification Service (Phase 5) consumes 'task.#' events and:
//   1. Creates an in-app Notification record in the DB
//   2. Sends an email if the user has email notifications enabled
//   3. Can emit a Socket.IO event to connected clients (real-time)
//
// GRACEFUL DEGRADATION:
//   If RabbitMQ is unavailable, events are silently dropped (logged).
//   The task operation (create, assign, etc.) already succeeded — we don't
//   fail the whole operation just because notifications couldn't be queued.
//   In production, add a dead-letter queue or outbox pattern for reliability.
//
// See workspace-service/src/events/publishers/workspace.publisher.ts for full docs.
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import { rabbitMQ, EXCHANGE_NAME, RoutingKeys, FlowForgeEvent } from '../../config/rabbitmq';
import { logger } from '../../utils/logger';

const publishEvent = async <T extends Record<string, unknown>>(
  routingKey: string,
  organizationId: string,
  actorId: string,
  payload: T,
): Promise<void> => {
  const channel = rabbitMQ.getChannel();

  if (!channel) {
    logger.warn('[TaskPublisher] RabbitMQ channel not available — event not published', { routingKey });
    return;
  }

  const event: FlowForgeEvent<T> = {
    eventId: uuidv4(),
    eventType: routingKey,
    organizationId,
    actorId,
    timestamp: new Date().toISOString(),
    payload,
  };

  const messageBuffer = Buffer.from(JSON.stringify(event));

  try {
    await new Promise<void>((resolve, reject) => {
      const sent = channel.publish(
        EXCHANGE_NAME,
        routingKey,
        messageBuffer,
        {
          persistent: true,
          contentType: 'application/json',
          headers: {
            'x-event-id': event.eventId,
            'x-organization-id': organizationId,
          },
        },
        (err) => (err ? reject(err) : resolve()),
      );

      if (!sent) {
        logger.warn('[TaskPublisher] Channel buffer full', { routingKey });
        resolve();
      }
    });

    logger.info('[TaskPublisher] Event published', {
      eventId: event.eventId,
      routingKey,
      organizationId,
    });
  } catch (error) {
    logger.error('[TaskPublisher] Failed to publish event', { routingKey, error });
  }
};

// =============================================================================
// TYPED PUBLISHER FUNCTIONS
// =============================================================================

export const publishTaskCreated = (
  organizationId: string,
  actorId: string,
  payload: { taskId: string; taskKey: string; taskTitle: string; projectId: string; boardName: string },
) => publishEvent(RoutingKeys.TASK_CREATED, organizationId, actorId, payload);

export const publishTaskUpdated = (
  organizationId: string,
  actorId: string,
  payload: { taskId: string; taskKey: string; changes: Record<string, unknown> },
) => publishEvent(RoutingKeys.TASK_UPDATED, organizationId, actorId, payload);

export const publishTaskDeleted = (
  organizationId: string,
  actorId: string,
  payload: { taskId: string; taskKey: string; taskTitle: string; projectId: string },
) => publishEvent(RoutingKeys.TASK_DELETED, organizationId, actorId, payload);

export const publishTaskAssigned = (
  organizationId: string,
  actorId: string,
  payload: { taskId: string; taskKey: string; taskTitle: string; assigneeId: string; projectId: string },
) => publishEvent(RoutingKeys.TASK_ASSIGNED, organizationId, actorId, payload);

export const publishTaskUnassigned = (
  organizationId: string,
  actorId: string,
  payload: { taskId: string; taskKey: string; removedUserId: string },
) => publishEvent(RoutingKeys.TASK_UNASSIGNED, organizationId, actorId, payload);

export const publishTaskStatusChanged = (
  organizationId: string,
  actorId: string,
  payload: {
    taskId: string;
    taskKey: string;
    taskTitle: string;
    fromBoardId: string;
    toBoardId: string;
    toBoardName: string;
    projectId: string;
  },
) => publishEvent(RoutingKeys.TASK_STATUS_CHANGED, organizationId, actorId, payload);

export const publishTaskCompleted = (
  organizationId: string,
  actorId: string,
  payload: { taskId: string; taskKey: string; taskTitle: string; projectId: string },
) => publishEvent(RoutingKeys.TASK_COMPLETED, organizationId, actorId, payload);

export const publishCommentAdded = (
  organizationId: string,
  actorId: string,
  payload: { taskId: string; taskKey: string; commentId: string; taskTitle: string },
) => publishEvent(RoutingKeys.COMMENT_ADDED, organizationId, actorId, payload);
