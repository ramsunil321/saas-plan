// =============================================================================
// EVENT CONSUMER — RabbitMQ message dispatcher
// =============================================================================
//
// THIS IS THE ENTRY POINT for all incoming RabbitMQ messages.
//
// RESPONSIBILITY:
//   1. Register itself as the message handler on rabbitMQConsumer
//   2. Route incoming events to the correct domain handler (workspace vs task)
//   3. Let domain handlers handle all business logic
//
// ROUTING STRATEGY — EVENT TYPE PREFIX:
//   'workspace.*' → WorkspaceHandler
//   'task.*'      → TaskHandler
//   unknown       → log warning and skip (don't throw — would cause NACK + DLQ)
//
// WHY NOT THROW ON UNKNOWN EVENTS?
//   Throwing here would NACK the message and send it to the DLQ.
//   Unknown event types are expected (new event types added to other services
//   before this service is updated). Skipping unknown types is the correct
//   behavior — fail loud on PROCESSING errors, fail silent on unknown types.
//
// WHY SEPARATE HANDLERS INSTEAD OF ONE GIANT SWITCH?
//   Single Responsibility Principle. Each handler owns its domain.
//   When the workspace team adds a new event, they only edit workspace.handler.ts.
//   The event.consumer.ts router stays stable — open-closed principle.
//
// INITIALIZATION:
//   Called once from server.ts during startup:
//     const consumer = new EventConsumer(notificationService);
//     consumer.start();  ← registers handler + triggers RabbitMQ connect()
// =============================================================================

import { rabbitMQConsumer, FlowForgeEvent } from '../config/rabbitmq';
import { NotificationService } from '../services/notification.service';
import { WorkspaceHandler } from './handlers/workspace.handler';
import { TaskHandler } from './handlers/task.handler';
import { logger } from '../utils/logger';

export class EventConsumer {
  private readonly workspaceHandler: WorkspaceHandler;
  private readonly taskHandler: TaskHandler;

  constructor(notificationService: NotificationService) {
    // Inject the SAME notificationService instance into both handlers
    // so they share the same Redis cache client and repository
    this.workspaceHandler = new WorkspaceHandler(notificationService);
    this.taskHandler = new TaskHandler(notificationService);
  }

  // ==========================================================================
  // START — Register handler and connect to RabbitMQ
  // ==========================================================================
  // Called once at startup. The handler is registered BEFORE connect() so
  // there's no race condition where a message arrives before the handler is set.
  // ==========================================================================
  start(): void {
    // Register this instance's dispatch() as the message handler
    // rabbitMQConsumer calls this for every incoming message
    rabbitMQConsumer.setMessageHandler(this.dispatch.bind(this));

    // Connect initiates the AMQP connection, declares exchanges/queues, and
    // starts consuming. Auto-reconnect on disconnect is handled by rabbitmq.ts.
    rabbitMQConsumer.connect().catch((err) => {
      logger.error('[EventConsumer] Failed to start consumer', { error: err.message });
    });

    logger.info('[EventConsumer] Event consumer initialized');
  }

  // ==========================================================================
  // DISPATCH — Route each event to the correct domain handler
  // ==========================================================================
  // This method is called by rabbitMQConsumer for each message.
  // If this throws, rabbitMQConsumer catches it and sends a NACK to DLQ.
  // So we only throw for actual processing failures, not unknown event types.
  // ==========================================================================
  private async dispatch(event: FlowForgeEvent): Promise<void> {
    const [domain] = event.eventType.split('.');

    logger.debug('[EventConsumer] Dispatching event', {
      eventId: event.eventId,
      eventType: event.eventType,
      domain,
    });

    switch (domain) {
      case 'workspace':
        await this.workspaceHandler.handle(event);
        break;
      case 'task':
        await this.taskHandler.handle(event);
        break;
      default:
        // Log but don't throw — unknown domains don't go to DLQ
        logger.warn('[EventConsumer] Unknown event domain — skipping', {
          eventType: event.eventType,
          eventId: event.eventId,
        });
    }
  }
}
