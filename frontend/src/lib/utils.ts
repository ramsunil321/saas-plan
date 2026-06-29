// Utility functions shared across the frontend
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format } from 'date-fns';

// =============================================================================
// cn — Tailwind class merging utility
// =============================================================================
// clsx builds a class string from conditional values.
// twMerge resolves Tailwind conflicts (e.g. "p-4 p-8" → "p-8").
// Usage: cn('px-4 py-2', isActive && 'bg-blue-500', 'hover:bg-blue-600')
// =============================================================================
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Format a date as "2 hours ago" or "Jan 15" for older dates
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 24) {
    return formatDistanceToNow(date, { addSuffix: true });
  }
  return format(date, 'MMM d');
}

// Format a full date for tooltips
export function formatFullDate(dateString: string): string {
  return format(new Date(dateString), 'MMM d, yyyy HH:mm');
}

// Get initials from first + last name for avatar fallback
// Guards against undefined/empty strings — the user object may not be fully populated
// when the component first renders (before /me response arrives)
export function getInitials(firstName: string, lastName: string): string {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase();
}

// Priority → color mapping for task cards and badges
export const PRIORITY_COLORS = {
  low:    'text-slate-500 bg-slate-100',
  medium: 'text-yellow-600 bg-yellow-50',
  high:   'text-orange-600 bg-orange-50',
  urgent: 'text-red-600 bg-red-50',
} as const;

// Priority → border-left color for Kanban cards
export const PRIORITY_BORDER = {
  low:    'border-l-slate-300',
  medium: 'border-l-yellow-400',
  high:   'border-l-orange-400',
  urgent: 'border-l-red-500',
} as const;

// Notification type → icon name mapping (Lucide icon names)
export const NOTIFICATION_ICONS: Record<string, string> = {
  TASK_ASSIGNED:            'UserPlus',
  TASK_UNASSIGNED:          'UserMinus',
  TASK_COMPLETED:           'CheckCircle',
  TASK_STATUS_CHANGED:      'ArrowRight',
  TASK_DELETED:             'Trash2',
  COMMENT_ADDED:            'MessageSquare',
  WORKSPACE_MEMBER_JOINED:  'UserCheck',
  WORKSPACE_MEMBER_REMOVED: 'UserX',
  PROJECT_CREATED:          'FolderPlus',
};

// Truncate long strings with ellipsis
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength)}…`;
}

// Safe localStorage access (SSR-safe — Next.js renders on the server too)
export const storage = {
  get: (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set: (key: string, value: string): void => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(key, value); } catch { /* quota exceeded */ }
  },
  remove: (key: string): void => {
    if (typeof window === 'undefined') return;
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};
