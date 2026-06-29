// =============================================================================
// TASK SERVICE INTERFACES — TypeScript contracts for all task resources
// =============================================================================
//
// WHY INTERFACES?
//   Interfaces define the CONTRACT between layers. The service layer only knows
//   about ITaskRepository — it doesn't care whether data comes from Prisma, a
//   mock, or a REST API. This makes unit testing trivial: inject a mock repo.
//
// REPOSITORY PATTERN:
//   Each repository interface defines the data access methods for one aggregate.
//   The concrete implementation (e.g., PrismaTaskRepository) uses Prisma.
//   Tests inject a jest.Mocked<ITaskRepository> instead.
// =============================================================================

import { Task, Comment, Attachment, ActivityLog, TaskAssignee } from '@prisma/client';

// =============================================================================
// SAFE / PUBLIC RESPONSE TYPES
// =============================================================================
// These types strip internal fields (organizationId, etc.) and add computed fields.
// Never return raw Prisma model objects from the API — they may leak sensitive data.
// =============================================================================

export interface SafeTask {
  id: string;
  taskNumber: number;
  taskKey: string;           // "FF-42" — project key + task number
  title: string;
  description: string | null;
  priority: string;          // low | medium | high | urgent
  status: string;            // mirrors the board name (denormalized)
  dueDate: Date | null;
  position: number;          // Float — fractional indexing for drag-and-drop
  estimatedHours: number | null;
  actualHours: number | null;
  organizationId: string;
  projectId: string;
  boardId: string;
  reporterId: string;
  parentTaskId: string | null;
  assignees: SafeTaskAssignee[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SafeTaskAssignee {
  userId: string;
  assignedAt: Date;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatarUrl: string | null;
  };
}

export interface SafeComment {
  id: string;
  taskId: string;
  content: string;
  isEdited: boolean;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  };
  replies?: SafeComment[];
}

export interface SafeAttachment {
  id: string;
  taskId: string;
  fileName: string;
  fileSize: string;          // BigInt serialized as string for JSON compatibility
  mimeType: string;
  storageUrl: string;
  uploadedAt: Date;
  uploader: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export interface SafeActivityLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;            // 'task.created' | 'task.status_changed' | etc.
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  actor: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  };
}

// =============================================================================
// PAGINATION TYPES
// =============================================================================

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// =============================================================================
// TASK FILTERS — Query parameters for listing tasks
// =============================================================================

export interface TaskFilters {
  boardId?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  reporterId?: string;
  search?: string;     // Full-text search on title
  dueDate?: string;    // ISO date — get tasks due before this date
}

// =============================================================================
// TASK REPOSITORY INTERFACE
// =============================================================================

export interface ITaskRepository {
  findById(organizationId: string, taskId: string): Promise<SafeTask | null>;
  listByProject(
    organizationId: string,
    projectId: string,
    filters: TaskFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SafeTask>>;
  listByBoard(
    organizationId: string,
    boardId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SafeTask>>;
  create(data: CreateTaskData): Promise<SafeTask>;
  update(organizationId: string, taskId: string, data: UpdateTaskData): Promise<Task>;
  delete(organizationId: string, taskId: string): Promise<void>;
  move(organizationId: string, taskId: string, targetBoardId: string, position: number): Promise<Task>;
  reorder(organizationId: string, taskId: string, position: number): Promise<void>;
  addAssignee(taskId: string, userId: string, assignedBy: string): Promise<TaskAssignee>;
  removeAssignee(taskId: string, userId: string): Promise<void>;
  getNextTaskNumber(projectId: string): Promise<number>;
  getLastPositionInBoard(boardId: string): Promise<number>;
  getProjectKey(organizationId: string, projectId: string): Promise<string | null>;
  getTaskWithProject(organizationId: string, taskId: string): Promise<{ boardId: string; projectId: string; title: string; taskNumber: number; projectKey: string } | null>;
}

// =============================================================================
// COMMENT REPOSITORY INTERFACE
// =============================================================================

export interface ICommentRepository {
  list(organizationId: string, taskId: string): Promise<SafeComment[]>;
  findById(organizationId: string, commentId: string): Promise<Comment | null>;
  create(data: CreateCommentData): Promise<SafeComment>;
  update(organizationId: string, commentId: string, content: string): Promise<Comment>;
  delete(organizationId: string, commentId: string): Promise<void>;
}

// =============================================================================
// ATTACHMENT REPOSITORY INTERFACE
// =============================================================================

export interface IAttachmentRepository {
  list(organizationId: string, taskId: string): Promise<SafeAttachment[]>;
  findById(organizationId: string, attachmentId: string): Promise<Attachment | null>;
  create(data: CreateAttachmentData): Promise<SafeAttachment>;
  delete(organizationId: string, attachmentId: string): Promise<void>;
}

// =============================================================================
// ACTIVITY LOG REPOSITORY INTERFACE
// =============================================================================

export interface IActivityRepository {
  listForTask(
    organizationId: string,
    taskId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SafeActivityLog>>;
  create(data: CreateActivityData): Promise<void>;
}

// =============================================================================
// INPUT DATA TYPES
// =============================================================================

export interface CreateTaskData {
  organizationId: string;
  projectId: string;
  boardId: string;
  title: string;
  description?: string;
  priority?: string;
  dueDate?: Date;
  reporterId: string;
  position?: number;
  estimatedHours?: number;
  parentTaskId?: string;
  assigneeIds?: string[];
}

export interface UpdateTaskData {
  title?: string;
  description?: string | null;
  priority?: string;
  dueDate?: Date | null;
  estimatedHours?: number | null;
  actualHours?: number;
  parentTaskId?: string | null;
}

export interface CreateCommentData {
  taskId: string;
  organizationId: string;
  authorId: string;
  content: string;
  parentId?: string;
}

export interface CreateAttachmentData {
  taskId: string;
  organizationId: string;
  uploadedBy: string;
  fileName: string;
  fileSize: bigint;
  mimeType: string;
  storageKey: string;
  storageUrl: string;
}

export interface CreateActivityData {
  organizationId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string;
  metadata?: Record<string, unknown>;
}
