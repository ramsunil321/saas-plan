// =============================================================================
// NOTIFICATION SERVICE — Interfaces & Repository Contract
// =============================================================================
//
// WHY INTERFACES?
//   Same reason as task-service: the repository interface separates "what" the
//   data layer does from "how". Tests inject mock repositories; production uses
//   the Prisma implementation. Controllers and services only ever reference these
//   interfaces — they never import Prisma directly.
//
// NOTIFICATION TYPES:
//   Each NotificationType maps directly to a RabbitMQ event type.
//   The frontend uses this string to choose the right icon and text template.
//   Keeping them as string constants (not TypeScript enum) avoids the enum
//   pitfall where numeric values leak into JSON (e.g. 0, 1, 2 instead of names).
//
// INTERVIEW QUESTION: "Why use string literal unions instead of TypeScript enums?"
//   Answer: String literals serialize predictably to JSON and are readable in DB.
//   TypeScript numeric enums compile to { TASK_ASSIGNED: 0, 0: 'TASK_ASSIGNED' }
//   which is confusing. String enums are cleaner but still have the "reverse
//   mapping" issue at runtime. String literal unions are the most explicit.
// =============================================================================

// Notification types — one per triggering event type
export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'TASK_UNASSIGNED'
  | 'TASK_COMPLETED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_DELETED'
  | 'COMMENT_ADDED'
  | 'WORKSPACE_MEMBER_JOINED'
  | 'WORKSPACE_MEMBER_REMOVED'
  | 'PROJECT_CREATED';

// =============================================================================
// SAFE NOTIFICATION — Serializable shape returned by the API
// =============================================================================
// Mirrors the Prisma Notification model but typed for our domain layer.
// `metadata` typed as Record<string, unknown> since its shape varies per type.
// =============================================================================
export interface SafeNotification {
  id: string;
  organizationId: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;    // ISO string — Date serialized for JSON
  createdAt: string;        // ISO string
}

// =============================================================================
// CREATE NOTIFICATION DATA — Input to NotificationRepository.create()
// =============================================================================
export interface CreateNotificationData {
  organizationId: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// PAGINATED RESULT — Generic wrapper for list endpoints
// =============================================================================
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// =============================================================================
// LIST FILTERS — Parameters accepted by listForUser()
// =============================================================================
export interface NotificationFilters {
  isRead?: boolean;       // null/undefined = all; true = read only; false = unread only
  page: number;
  limit: number;
}

// =============================================================================
// NOTIFICATION REPOSITORY INTERFACE — Contract for the data layer
// =============================================================================
// Methods:
//   create         — called by the event consumer when a new event arrives
//   findById       — used internally and for delete authorization
//   listForUser    — paginated list for the REST API
//   markAsRead     — marks a single notification as read + sets readAt timestamp
//   markAllAsRead  — bulk update — marks every unread notification for a user+org
//   getUnreadCount — used for the badge count (cached in Redis)
//   delete         — removes a single notification by id
//   deleteAll      — removes all notifications for a user+org (bulk clear)
// =============================================================================
export interface INotificationRepository {
  create(data: CreateNotificationData): Promise<SafeNotification>;
  findById(id: string): Promise<SafeNotification | null>;
  listForUser(recipientId: string, orgId: string, filters: NotificationFilters): Promise<PaginatedResult<SafeNotification>>;
  markAsRead(id: string, recipientId: string): Promise<SafeNotification>;
  markAllAsRead(recipientId: string, orgId: string): Promise<number>; // returns count updated
  getUnreadCount(recipientId: string, orgId: string): Promise<number>;
  delete(id: string, recipientId: string): Promise<void>;
  deleteAll(recipientId: string, orgId: string): Promise<number>; // returns count deleted
}
