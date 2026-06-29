// =============================================================================
// RABBITMQ — Connection + Task Event Routing Keys
// =============================================================================
//
// The task service publishes events when tasks are mutated.
// The notification service subscribes and creates in-app notifications + emails.
//
// ROUTING KEY PATTERN (topic exchange):
//   task.created       → notify project members of new task
//   task.assigned      → notify the assignee
//   task.status_changed → notify the reporter and assignees
//   task.comment_added → notify task followers
//   task.deleted       → notify assignees
//
// WHY TOPIC EXCHANGE?
//   Notification service can subscribe to 'task.#' to get ALL task events.
//   Or subscribe to 'task.assigned' specifically to only get assignment events.
//   This flexibility is why topic exchange beats direct or fanout here.
//
// See workspace-service/src/config/rabbitmq.ts for full AMQP explanation.
// =============================================================================

import amqplib, { Connection, ConfirmChannel } from 'amqplib';
import { env } from './env';
import { logger } from '../utils/logger';

export const EXCHANGE_NAME = 'flowforge.events';
export const EXCHANGE_TYPE = 'topic';

// =============================================================================
// ROUTING KEYS
// =============================================================================
// All routing keys from workspace-service PLUS task-specific keys.
// Using the same exchange ('flowforge.events') keeps all events in one place.
// =============================================================================

export const RoutingKeys = {
  // Workspace events (republished here for reference — workspace-service owns them)
  PROJECT_CREATED:    'workspace.project.created',
  MEMBER_INVITED:     'workspace.member.invited',
  MEMBER_JOINED:      'workspace.member.joined',
  MEMBER_REMOVED:     'workspace.member.removed',

  // Task events — owned by this service
  TASK_CREATED:        'task.created',
  TASK_UPDATED:        'task.updated',
  TASK_DELETED:        'task.deleted',
  TASK_ASSIGNED:       'task.assigned',
  TASK_UNASSIGNED:     'task.unassigned',
  TASK_STATUS_CHANGED: 'task.status_changed',  // board/column change
  TASK_COMPLETED:      'task.completed',        // moved to "Done" board
  COMMENT_ADDED:       'task.comment.added',
  COMMENT_DELETED:     'task.comment.deleted',
  ATTACHMENT_ADDED:    'task.attachment.added',
} as const;

// =============================================================================
// CONNECTION MANAGER (Singleton)
// =============================================================================

class RabbitMQConnection {
  private connection: Connection | null = null;
  private channel: ConfirmChannel | null = null;
  private isConnecting = false;

  async connect(): Promise<void> {
    if (this.connection || this.isConnecting) return;

    this.isConnecting = true;
    try {
      this.connection = await amqplib.connect(env.RABBITMQ_URL);
      this.channel = await this.connection.createConfirmChannel();

      await this.channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, { durable: true });

      logger.info('[RabbitMQ] Connected and exchange asserted');

      this.connection.on('error', (err) => {
        logger.error('[RabbitMQ] Connection error', { error: err.message });
        this.cleanup();
      });

      this.connection.on('close', () => {
        logger.warn('[RabbitMQ] Connection closed — will reconnect in 5s');
        this.cleanup();
        setTimeout(() => this.connect(), 5000);
      });
    } catch (error) {
      this.isConnecting = false;
      logger.error('[RabbitMQ] Failed to connect', { error });
      setTimeout(() => this.connect(), 5000);
      return;
    }

    this.isConnecting = false;
  }

  private cleanup(): void {
    this.connection = null;
    this.channel = null;
  }

  getChannel(): ConfirmChannel | null {
    return this.channel;
  }

  async close(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch { /* ignore close errors */ }
    this.cleanup();
  }
}

export const rabbitMQ = new RabbitMQConnection();

// =============================================================================
// FLOWFORGE EVENT ENVELOPE
// =============================================================================

export interface FlowForgeEvent<T = Record<string, unknown>> {
  eventId: string;        // UUID — consumers use this for idempotency
  eventType: string;      // routing key (e.g., 'task.assigned')
  organizationId: string; // Tenant scope
  actorId: string;        // Who triggered this event
  timestamp: string;      // ISO 8601
  payload: T;             // Event-specific data shape
}
