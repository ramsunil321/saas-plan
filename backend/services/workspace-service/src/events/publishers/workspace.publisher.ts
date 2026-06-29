// =============================================================================
// WORKSPACE EVENT PUBLISHER — RabbitMQ message publishing
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   When workspace-level actions happen (project created, member invited),
//   other services (Notification Service) need to know about it.
//   This publisher sends events to RabbitMQ's topic exchange.
//
// HOW IT WORKS:
//   1. Call publishEvent('workspace.project.created', orgId, actorId, payload)
//   2. Event is JSON-serialized and published to the 'flowforge.events' exchange
//   3. RabbitMQ routes the message to subscribed queues based on routing key
//   4. Notification Service (Phase 5) consumes from 'notification.queue'
//
// PUBLISHER CONFIRMS:
//   We use a ConfirmChannel which waits for RabbitMQ to acknowledge each message.
//   Without confirms: messages can be silently lost if the broker restarts.
//   With confirms: we know with certainty whether the message was accepted.
//
// FIRE-AND-FORGET vs ACKNOWLEDGMENT:
//   Publishing is async — we don't wait for the consumer to process the event.
//   We only wait for the BROKER to acknowledge receipt (durability guarantee).
//   If publishing fails, we log it but don't fail the main operation.
//   Missing a notification is better than failing a project creation.
//
// INTERVIEW QUESTION:
//   "What is at-least-once vs at-most-once vs exactly-once delivery?"
//   Answer:
//   - At-most-once: fire-and-forget. May be lost. Fast.
//   - At-least-once: ack-based. Message delivered, possibly multiple times on retry. Most common.
//   - Exactly-once: complex, requires idempotency keys and distributed transactions.
//   We use at-least-once (publisher confirms + consumer acks + dead-letter queues).
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import { rabbitMQ, EXCHANGE_NAME, RoutingKeys, FlowForgeEvent } from '../../config/rabbitmq';
import { logger } from '../../utils/logger';

// Publish any workspace event to RabbitMQ
const publishEvent = async <T extends Record<string, unknown>>(
  routingKey: string,
  organizationId: string,
  actorId: string,
  payload: T,
): Promise<void> => {
  const channel = rabbitMQ.getChannel();

  if (!channel) {
    // RabbitMQ not connected — log and skip (degraded mode)
    // The main operation (project creation) already succeeded
    logger.warn('[WorkspacePublisher] RabbitMQ channel not available — event not published', {
      routingKey,
    });
    return;
  }

  const event: FlowForgeEvent<T> = {
    eventId: uuidv4(),          // Unique ID for deduplication in consumers
    eventType: routingKey,
    organizationId,
    actorId,
    timestamp: new Date().toISOString(),
    payload,
  };

  const messageBuffer = Buffer.from(JSON.stringify(event));

  try {
    // publish() returns false if the send buffer is full (backpressure)
    // In production, handle backpressure with 'drain' event
    await new Promise<void>((resolve, reject) => {
      const sent = channel.publish(
        EXCHANGE_NAME,
        routingKey,
        messageBuffer,
        {
          persistent: true,       // Message survives broker restart (stored to disk)
          contentType: 'application/json',
          headers: {
            'x-event-id': event.eventId,
            'x-organization-id': organizationId,
          },
        },
        (err) => {
          // Confirm callback — called when broker acknowledges the message
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );

      if (!sent) {
        // Buffer full — we could wait for 'drain' but for now log and resolve
        logger.warn('[WorkspacePublisher] Channel buffer full', { routingKey });
        resolve();
      }
    });

    logger.info('[WorkspacePublisher] Event published', {
      eventId: event.eventId,
      routingKey,
      organizationId,
    });
  } catch (error) {
    // Publishing failure is non-fatal — log but don't throw
    // In production, consider a dead-letter mechanism or retry queue
    logger.error('[WorkspacePublisher] Failed to publish event', {
      routingKey,
      error,
    });
  }
};

// =============================================================================
// TYPED PUBLISHER FUNCTIONS
// =============================================================================
// Each function is strongly typed for its specific event payload.
// Callers don't need to know routing key strings.
// =============================================================================

export const publishProjectCreated = (
  organizationId: string,
  actorId: string,
  payload: { projectId: string; projectName: string; projectKey: string },
) => publishEvent(RoutingKeys.PROJECT_CREATED, organizationId, actorId, payload);

export const publishProjectUpdated = (
  organizationId: string,
  actorId: string,
  payload: { projectId: string; changes: Record<string, unknown> },
) => publishEvent(RoutingKeys.PROJECT_UPDATED, organizationId, actorId, payload);

export const publishProjectArchived = (
  organizationId: string,
  actorId: string,
  payload: { projectId: string; projectName: string },
) => publishEvent(RoutingKeys.PROJECT_ARCHIVED, organizationId, actorId, payload);

export const publishMemberInvited = (
  organizationId: string,
  actorId: string,
  payload: { inviteeEmail: string; role: string; inviterName: string; orgName: string },
) => publishEvent(RoutingKeys.MEMBER_INVITED, organizationId, actorId, payload);

export const publishMemberJoined = (
  organizationId: string,
  actorId: string,
  payload: { userId: string; role: string },
) => publishEvent(RoutingKeys.MEMBER_JOINED, organizationId, actorId, payload);

export const publishMemberRemoved = (
  organizationId: string,
  actorId: string,
  payload: { removedUserId: string },
) => publishEvent(RoutingKeys.MEMBER_REMOVED, organizationId, actorId, payload);

export const publishTeamCreated = (
  organizationId: string,
  actorId: string,
  payload: { teamId: string; teamName: string },
) => publishEvent(RoutingKeys.TEAM_CREATED, organizationId, actorId, payload);
