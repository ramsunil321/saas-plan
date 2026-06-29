// =============================================================================
// WORKSPACE EVENT HANDLER
// =============================================================================
//
// Handles events originating from the workspace-service:
//   workspace.member.joined   → notify the org owner/admins
//   workspace.member.removed  → notify the removed member
//   workspace.project.created → notify all org members
//
// HOW THIS FITS IN THE CONSUMER PIPELINE:
//   RabbitMQ → event.consumer.ts (router) → THIS FILE (workspace events)
//   → NotificationService.create() → Prisma INSERT + email + cache invalidation
//
// DESIGN PATTERN — HANDLER ISOLATION:
//   Each domain (workspace, task) has its own handler file.
//   The dispatcher (event.consumer.ts) routes by eventType prefix.
//   Keeping handlers separate means: adding a new workspace event type only
//   requires editing this file — not the main dispatcher.
//
// EVENT ENVELOPE SHAPE (from workspace-service publishers):
//   {
//     eventId: string,        // UUID for idempotency deduplication
//     eventType: string,      // e.g. "workspace.member.joined"
//     organizationId: string,
//     actorId: string,        // who triggered the event
//     timestamp: string,      // ISO string
//     payload: {...}          // event-specific data (see each handler below)
//   }
// =============================================================================

import { FlowForgeEvent } from '../../config/rabbitmq';
import { NotificationService } from '../../services/notification.service';
import { logger } from '../../utils/logger';

export class WorkspaceHandler {
  constructor(private readonly notificationService: NotificationService) {}

  // ==========================================================================
  // ROUTE — Dispatch to specific handler based on eventType
  // ==========================================================================
  async handle(event: FlowForgeEvent): Promise<void> {
    switch (event.eventType) {
      case 'workspace.member.joined':
        await this.onMemberJoined(event);
        break;
      case 'workspace.member.removed':
        await this.onMemberRemoved(event);
        break;
      case 'workspace.project.created':
        await this.onProjectCreated(event);
        break;
      default:
        // Unknown workspace event — log and ignore (don't NACK — don't send to DLQ)
        logger.debug('[WorkspaceHandler] Unknown event type, skipping', { eventType: event.eventType });
    }
  }

  // ==========================================================================
  // workspace.member.joined
  // ==========================================================================
  // Payload shape: { memberId, memberEmail, memberName, role, organizationName }
  // Recipient: the actor who invited them (or the joining user themselves for self-join)
  // We notify the NEW MEMBER that they've joined successfully.
  // ==========================================================================
  private async onMemberJoined(event: FlowForgeEvent): Promise<void> {
    const payload = event.payload as {
      memberId: string;
      memberEmail: string;
      memberName: string;
      role: string;
      organizationName: string;
    };

    await this.notificationService.create({
      organizationId: event.organizationId,
      recipientId: payload.memberId,
      type: 'WORKSPACE_MEMBER_JOINED',
      title: `Welcome to ${payload.organizationName}!`,
      message: `You've joined ${payload.organizationName} as ${payload.role}.`,
      metadata: {
        organizationId: event.organizationId,
        organizationName: payload.organizationName,
        role: payload.role,
        actorId: event.actorId,
      },
    });

    logger.info('[WorkspaceHandler] Handled workspace.member.joined', {
      eventId: event.eventId,
      recipientId: payload.memberId,
    });
  }

  // ==========================================================================
  // workspace.member.removed
  // ==========================================================================
  // Payload shape: { memberId, memberName, organizationName }
  // NOTE: The removed member may not have access to the org REST API anymore,
  // but the notification still gets created in the DB so they see it next time.
  // In a real app, you'd also revoke their active JWT sessions here.
  // ==========================================================================
  private async onMemberRemoved(event: FlowForgeEvent): Promise<void> {
    const payload = event.payload as {
      memberId: string;
      memberName: string;
      organizationName: string;
    };

    await this.notificationService.create({
      organizationId: event.organizationId,
      recipientId: payload.memberId,
      type: 'WORKSPACE_MEMBER_REMOVED',
      title: `Removed from ${payload.organizationName}`,
      message: `You have been removed from ${payload.organizationName}.`,
      metadata: {
        organizationId: event.organizationId,
        organizationName: payload.organizationName,
        actorId: event.actorId,
      },
    });

    logger.info('[WorkspaceHandler] Handled workspace.member.removed', {
      eventId: event.eventId,
      recipientId: payload.memberId,
    });
  }

  // ==========================================================================
  // workspace.project.created
  // ==========================================================================
  // Payload shape: { projectId, projectName, teamId?, teamName?, memberIds[] }
  // memberIds = all org members to notify (workspace-service includes this list)
  // We create one notification per recipient — batch insert would be more
  // efficient at scale but individual creates are simpler and debuggable.
  // ==========================================================================
  private async onProjectCreated(event: FlowForgeEvent): Promise<void> {
    const payload = event.payload as {
      projectId: string;
      projectName: string;
      projectKey: string;
      teamName?: string;
      memberIds: string[];
    };

    // Notify all members except the actor who created the project (they know)
    const recipients = payload.memberIds.filter((id) => id !== event.actorId);

    // Create notifications concurrently — all insert simultaneously
    await Promise.all(
      recipients.map((recipientId) =>
        this.notificationService.create({
          organizationId: event.organizationId,
          recipientId,
          type: 'PROJECT_CREATED',
          title: `New project: ${payload.projectName}`,
          message: payload.teamName
            ? `A new project "${payload.projectName}" (${payload.projectKey}) was created in ${payload.teamName}.`
            : `A new project "${payload.projectName}" (${payload.projectKey}) was created.`,
          metadata: {
            projectId: payload.projectId,
            projectName: payload.projectName,
            projectKey: payload.projectKey,
            teamName: payload.teamName,
            actorId: event.actorId,
          },
        }),
      ),
    );

    logger.info('[WorkspaceHandler] Handled workspace.project.created', {
      eventId: event.eventId,
      projectId: payload.projectId,
      recipientCount: recipients.length,
    });
  }
}
