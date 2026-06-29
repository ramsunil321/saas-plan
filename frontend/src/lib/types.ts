// =============================================================================
// SHARED FRONTEND TYPES
// =============================================================================
// These mirror the SafeX interfaces from the backend services.
// Keeping them in sync is important — a mismatch causes silent bugs
// (TypeScript sees correct types but runtime data is different).
//
// In a production system, these would be auto-generated from OpenAPI/Swagger
// specs or from a shared types package published to a private npm registry.
// =============================================================================

// --- Auth ---

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// --- Organization ---

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
  plan: string;
  role?: MemberRole;
  memberCount?: number;
  projectCount?: number;
  createdAt: string;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  };
}

export type MemberRole = 'owner' | 'admin' | 'manager' | 'developer' | 'viewer';

// --- Project ---

export interface Project {
  id: string;
  organizationId: string;
  teamId: string | null;
  name: string;
  description: string | null;
  key: string;
  status: 'active' | 'archived';
  startDate: string | null;
  endDate: string | null;
  taskCount?: number;
  boardCount?: number;
  createdAt: string;
}

// --- Board (Kanban Column) ---

export interface Board {
  id: string;
  projectId: string;
  organizationId: string;
  name: string;
  position: number;
  color: string | null;
  isDefault: boolean;
  taskCount?: number;
}

// --- Task ---

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  organizationId: string;
  projectId: string;
  boardId: string;
  taskKey: string;       // e.g. "FF-42"
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: string;
  dueDate: string | null;
  reporterId: string;
  position: number;
  estimatedHours: string | null;
  assignees: TaskAssignee[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskAssignee {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  content: string;
  isEdited: boolean;
  parentId: string | null;
  replies: Comment[];
  author: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

// --- Notification ---

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

export interface Notification {
  id: string;
  organizationId: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

// --- API Response wrappers ---

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// --- Pagination ---

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedData<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
