// =============================================================================
// RABBITMQ CONNECTION — AMQP message broker
// =============================================================================
//
// WHY RABBITMQ?
//   When a project is created or a member is invited, the Notification Service
//   needs to know so it can create in-app notifications and send emails.
//
//   Option A (bad): Workspace Service calls Notification Service directly via HTTP.
//     Problem: tight coupling, Notification Service downtime blocks workspace ops.
//
//   Option B (good): Workspace Service publishes an event to RabbitMQ.
//     Notification Service subscribes to and consumes events independently.
//     If Notification Service is down, events queue up and are processed when it recovers.
//     Workspace Service never waits for Notification Service.
//
// HOW AMQP WORKS:
//   Producer → Exchange → (routing key) → Queue → Consumer
//
//   Exchange types:
//   - direct: route to queue with exact matching key
//   - fanout: broadcast to ALL bound queues (ignores routing key)
//   - topic:  route by pattern matching (workspace.* or *.member.*)  ← we use this
//   - headers: route by message headers
//
//   Our setup:
//   Exchange: flowforge.events (topic)
//   Routing keys: workspace.project.created, workspace.member.invited, etc.
//   Queues: notification.queue (bound to workspace.# and task.#)
//
// INTERVIEW QUESTION:
//   "What is the difference between RabbitMQ and Kafka?"
//   Answer: RabbitMQ: message broker — routes messages, consumers acknowledge receipt,
//   messages are deleted after acknowledgment. Good for task queues, RPC, routing.
//   Kafka: distributed event log — messages are appended to a log and retained for
//   a configurable period. Consumers track their position. Good for event sourcing,
//   audit logs, high-throughput streaming. FlowForge uses RabbitMQ because we
//   need per-message routing and delivery guarantees, not replay semantics.
//
// INTERVIEW QUESTION:
//   "What is message durability in RabbitMQ?"
//   Answer: By default, queues and messages are in-memory — lost on broker restart.
//   `durable: true` on queues persists them to disk. `persistent: true` on messages
//   (deliveryMode: 2) persists message content. Both are needed for durability.
// =============================================================================

import amqplib, { Channel, Connection, ConfirmChannel } from 'amqplib';
import { env } from './env';
import { logger } from '../utils/logger';

// =============================================================================
// EXCHANGE AND QUEUE CONFIGURATION
// =============================================================================

export const EXCHANGE_NAME = 'flowforge.events';
export const EXCHANGE_TYPE = 'topic';

// Routing key patterns — consumers can subscribe to patterns:
// 'workspace.#' = all workspace events
// '*.member.*' = member events from any service
export const RoutingKeys = {
  PROJECT_CREATED: 'workspace.project.created',
  PROJECT_UPDATED: 'workspace.project.updated',
  PROJECT_ARCHIVED: 'workspace.project.archived',
  MEMBER_INVITED: 'workspace.member.invited',
  MEMBER_JOINED: 'workspace.member.joined',
  MEMBER_REMOVED: 'workspace.member.removed',
  TEAM_CREATED: 'workspace.team.created',
} as const;

// =============================================================================
// CONNECTION MANAGER
// =============================================================================

class RabbitMQConnection {
  private connection: Connection | null = null;
  private channel: ConfirmChannel | null = null;
  private isConnecting = false;

  async connect(): Promise<void> {
    if (this.connection || this.isConnecting) return;

    this.isConnecting = true;
    try {
      // Connect to RabbitMQ broker
      this.connection = await amqplib.connect(env.RABBITMQ_URL);

      // ConfirmChannel: publisher confirms — broker acknowledges each publish
      // This ensures messages aren't lost if RabbitMQ crashes between publish and write
      this.channel = await this.connection.createConfirmChannel();

      // Declare the exchange (idempotent — safe to call multiple times)
      // durable: true = exchange survives broker restarts
      await this.channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, {
        durable: true,
      });

      logger.info('[RabbitMQ] Connected and exchange asserted');

      // Handle connection errors
      this.connection.on('error', (err) => {
        logger.error('[RabbitMQ] Connection error', { error: err.message });
        this.cleanup();
      });

      this.connection.on('close', () => {
        logger.warn('[RabbitMQ] Connection closed — will reconnect');
        this.cleanup();
        // Exponential backoff reconnection
        setTimeout(() => this.connect(), 5000);
      });
    } catch (error) {
      this.isConnecting = false;
      logger.error('[RabbitMQ] Failed to connect', { error });
      // Retry after 5 seconds
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
    } catch {
      // Ignore errors on close
    }
    this.cleanup();
  }
}

// Singleton connection instance
export const rabbitMQ = new RabbitMQConnection();

// =============================================================================
// FLOWFORGE EVENT TYPE
// =============================================================================

export interface FlowForgeEvent<T = Record<string, unknown>> {
  eventId: string;        // UUID — for deduplication in consumers
  eventType: string;      // routing key (e.g., 'workspace.project.created')
  organizationId: string; // Tenant identifier
  actorId: string;        // Who triggered the event
  timestamp: string;      // ISO 8601
  payload: T;             // Event-specific data
}
