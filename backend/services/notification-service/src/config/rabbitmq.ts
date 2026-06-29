// =============================================================================
// RABBITMQ — Consumer-Side Configuration
// =============================================================================
//
// THIS IS FUNDAMENTALLY DIFFERENT FROM THE PUBLISHER SERVICES.
//
// Previous services (workspace, task) were PRODUCERS:
//   They publish events and return immediately (fire-and-forget).
//
// This service is a CONSUMER:
//   It subscribes to a durable queue, receives events one at a time,
//   processes them, and sends an ACK or NACK to RabbitMQ.
//
// CONSUMER FLOW:
//   1. assertQueue('notification.queue') → durable queue survives broker restart
//   2. bindQueue → subscribe to events from the topic exchange
//   3. prefetch(1) → process one message at a time (fair dispatch)
//   4. consume() → callback fired for each new message
//   5. After processing: channel.ack(msg) OR channel.nack(msg)
//
// MESSAGE ACKNOWLEDGMENT:
//   - ACK (ack): message processed successfully → RabbitMQ deletes it from queue
//   - NACK (nack, requeue=false): processing failed → message goes to Dead Letter Queue (DLQ)
//
// DEAD LETTER QUEUE (DLQ):
//   When a message is NACKed with requeue=false, it goes to 'flowforge.dead-letters'
//   exchange, then to 'notification.dead-letter.queue'.
//   In production, you'd monitor the DLQ and alert on unexpected failures.
//   Messages in DLQ can be manually inspected and reprocessed.
//
// INTERVIEW QUESTION: "What is a Dead Letter Queue?"
//   Answer: A special queue that receives messages that couldn't be processed.
//   Reasons: max retries exceeded, message TTL expired, queue capacity exceeded.
//   DLQs let you "park" failed messages for later inspection instead of losing them.
//   Without a DLQ, failed messages would either loop forever (requeue=true) or
//   be silently dropped (nack, requeue=false with no DLQ binding).
//
// INTERVIEW QUESTION: "What is the difference between ACK and NACK?"
//   Answer: ACK tells the broker "I processed this successfully, you can delete it."
//   NACK tells the broker "I failed to process this." With requeue=true, the message
//   goes back to the front of the queue (could loop forever). With requeue=false,
//   the message goes to the DLQ (or is discarded if no DLQ is configured).
// =============================================================================

import amqplib, { Connection, Channel } from 'amqplib';
import { env } from './env';
import { logger } from '../utils/logger';

// Queue names
export const QUEUE_NAME = 'notification.queue';
export const DLQ_NAME = 'notification.dead-letter.queue';
export const DEAD_LETTER_EXCHANGE = 'flowforge.dead-letters';

// The same exchange name used by publisher services
export const EXCHANGE_NAME = 'flowforge.events';
export const EXCHANGE_TYPE = 'topic';

// Routing key patterns this service subscribes to
// '#' wildcard in topic exchange matches zero or more words separated by dots
// 'workspace.#' = workspace.project.created, workspace.member.invited, etc.
// 'task.#'      = task.created, task.assigned, task.comment.added, etc.
export const BINDING_PATTERNS = ['workspace.#', 'task.#'];

// =============================================================================
// FLOWFORGE EVENT ENVELOPE — Mirrors what publisher services send
// =============================================================================

export interface FlowForgeEvent<T = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  organizationId: string;
  actorId: string;
  timestamp: string;
  payload: T;
}

// =============================================================================
// CONSUMER CONNECTION MANAGER
// =============================================================================

class RabbitMQConsumer {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private isConnecting = false;
  // Callback registered by the consumer module — called for each message
  private messageHandler: ((event: FlowForgeEvent) => Promise<void>) | null = null;

  setMessageHandler(handler: (event: FlowForgeEvent) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<void> {
    if (this.connection || this.isConnecting) return;

    this.isConnecting = true;
    try {
      this.connection = await amqplib.connect(env.RABBITMQ_URL);
      this.channel = await this.connection.createChannel();

      // =======================================================================
      // EXCHANGE SETUP — Idempotent: safe to assert even if already exists
      // =======================================================================
      await this.channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, { durable: true });

      // =======================================================================
      // DEAD LETTER EXCHANGE — Where failed messages land
      // =======================================================================
      await this.channel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', { durable: true });

      // =======================================================================
      // DEAD LETTER QUEUE — Durable queue for failed messages
      // =======================================================================
      await this.channel.assertQueue(DLQ_NAME, { durable: true });

      // Bind DLQ to the dead-letter exchange with wildcard to catch all dead letters
      await this.channel.bindQueue(DLQ_NAME, DEAD_LETTER_EXCHANGE, '#');

      // =======================================================================
      // MAIN QUEUE — Where events are delivered for processing
      // =======================================================================
      // Arguments configure DLQ routing for rejected messages
      await this.channel.assertQueue(QUEUE_NAME, {
        durable: true, // Queue survives broker restart
        arguments: {
          'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
          'x-message-ttl': 86400000, // 24 hours max in queue (prevents stale notifications)
        },
      });

      // =======================================================================
      // BIND QUEUE TO EXCHANGE — Subscribe to event patterns
      // =======================================================================
      for (const pattern of BINDING_PATTERNS) {
        await this.channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, pattern);
        logger.info(`[RabbitMQ] Bound queue to pattern: ${pattern}`);
      }

      // =======================================================================
      // PREFETCH — Max unacked messages before pausing consumption
      // =======================================================================
      // prefetch(1) = process one message at a time before asking for the next
      // This ensures fair distribution if multiple notification service instances run
      await this.channel.prefetch(env.CONSUMER_PREFETCH);

      // =======================================================================
      // START CONSUMING
      // =======================================================================
      await this.channel.consume(QUEUE_NAME, async (msg) => {
        if (!msg) return; // Null message = consumer cancelled by server

        try {
          const raw = msg.content.toString();
          const event = JSON.parse(raw) as FlowForgeEvent;

          logger.info('[RabbitMQ] Message received', {
            eventType: event.eventType,
            eventId: event.eventId,
            organizationId: event.organizationId,
          });

          if (this.messageHandler) {
            await this.messageHandler(event);
          }

          // SUCCESS: Tell RabbitMQ we processed the message successfully
          this.channel?.ack(msg);
        } catch (error) {
          logger.error('[RabbitMQ] Failed to process message — sending to DLQ', { error });

          // FAILURE: Don't requeue — send to DLQ instead
          // requeue=false: message goes to DLQ via dead-letter-exchange
          this.channel?.nack(msg, false, false);
        }
      });

      logger.info('[RabbitMQ] Consumer started — listening for events');

      this.connection.on('error', (err) => {
        logger.error('[RabbitMQ] Connection error', { error: err.message });
        this.cleanup();
      });

      this.connection.on('close', () => {
        logger.warn('[RabbitMQ] Connection closed — reconnecting in 5s');
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

  getChannel(): Channel | null {
    return this.channel;
  }

  async close(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch { /* ignore */ }
    this.cleanup();
  }
}

export const rabbitMQConsumer = new RabbitMQConsumer();
