// =============================================================================
// NOTIFICATION CONTROLLER
// =============================================================================
//
// Thin HTTP layer — validates that user is the recipient, delegates to service.
// No business logic here: controllers only translate HTTP ↔ domain layer.
//
// AUTHORIZATION MODEL:
//   Notification endpoints use a simpler auth model than workspace/task services.
//   There is NO requireOrgMember middleware here because:
//     1. Notifications belong to a specific user (recipientId = req.user.sub)
//     2. Users can only see/modify THEIR OWN notifications
//     3. The repository enforces this via compound WHERE (id + recipientId)
//   This is attribute-based access control (ABAC): ownership check.
//
// ASYNC HANDLER PATTERN:
//   All controllers are wrapped in a try/catch. If async throws,
//   next(error) is called to hand it to the error middleware.
//   We use an inline asyncHandler pattern to keep controllers clean.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { NotificationService } from '../services/notification.service';
import { sendSuccess, sendNoContent } from '../utils/response';
import { UnauthorizedError } from '../utils/errors';

export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // ==========================================================================
  // GET /notifications?orgId=&page=&limit=&isRead=
  // ==========================================================================
  // Returns paginated notifications for the authenticated user in an org.
  // The authenticated user ID (req.user.sub) is the implicit filter —
  // users can never request another user's notifications.
  // ==========================================================================
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError();

      const { orgId, page, limit, isRead } = req.query as {
        orgId: string;
        page: number;
        limit: number;
        isRead?: boolean;
      };

      const result = await this.notificationService.list(req.user.sub, orgId, {
        page,
        limit,
        isRead,
      });

      sendSuccess(res, result.data, 200, {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      });
    } catch (error) {
      next(error);
    }
  };

  // ==========================================================================
  // GET /notifications/unread-count?orgId=
  // ==========================================================================
  // Returns { count: number } — called on every page load for the badge.
  // Served from Redis cache (5 min TTL) — DB only hit on cache miss.
  // ==========================================================================
  getUnreadCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError();

      const { orgId } = req.query as { orgId: string };

      const count = await this.notificationService.getUnreadCount(req.user.sub, orgId);

      sendSuccess(res, { count });
    } catch (error) {
      next(error);
    }
  };

  // ==========================================================================
  // PUT /notifications/:id/read
  // ==========================================================================
  // Marks a single notification as read. The service passes recipientId to
  // the repository which enforces ownership at DB level (no extra lookup).
  // ==========================================================================
  markAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError();

      const { orgId } = req.query as { orgId: string };
      const notification = await this.notificationService.markAsRead(
        req.params.id,
        req.user.sub,
        orgId,
      );

      sendSuccess(res, notification);
    } catch (error) {
      next(error);
    }
  };

  // ==========================================================================
  // PUT /notifications/read-all?orgId=
  // ==========================================================================
  // Bulk mark all unread notifications as read for user+org.
  // Returns { count } showing how many were updated.
  // ==========================================================================
  markAllAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError();

      const { orgId } = req.query as { orgId: string };
      const count = await this.notificationService.markAllAsRead(req.user.sub, orgId);

      sendSuccess(res, { count });
    } catch (error) {
      next(error);
    }
  };

  // ==========================================================================
  // DELETE /notifications/:id
  // ==========================================================================
  // Deletes a single notification. Repository enforces ownership.
  // Returns 204 No Content on success. orgId is resolved from the notification
  // record inside the service — no need for the client to send it here.
  // ==========================================================================
  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError();

      await this.notificationService.delete(req.params.id, req.user.sub);

      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  };

  // ==========================================================================
  // DELETE /notifications?orgId=
  // ==========================================================================
  // Bulk deletes all notifications for user+org ("Clear all" button in UI).
  // Returns { count } showing how many were deleted.
  // ==========================================================================
  deleteAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError();

      const { orgId } = req.query as { orgId: string };
      const count = await this.notificationService.deleteAll(req.user.sub, orgId);

      sendSuccess(res, { count });
    } catch (error) {
      next(error);
    }
  };
}
