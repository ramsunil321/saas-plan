'use client';

// =============================================================================
// NOTIFICATION PANEL — Slide-in panel showing the notification feed
// =============================================================================
// Shows paginated notifications. Mark-all-read and individual mark-read
// both optimistically update the UI and invalidate the unread count cache.
// =============================================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, CheckCheck, Trash2 } from 'lucide-react';
import { cn, formatRelativeTime, NOTIFICATION_ICONS } from '@/lib/utils';
import { notificationApi } from '@/lib/api/notification';
import { Spinner } from '../ui/spinner';
import { Button } from '../ui/button';
import type { Notification } from '@/lib/types';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
}

// Map notification type → Lucide icon name for dynamic rendering
function NotificationIcon({ type }: { type: string }) {
  const iconName = NOTIFICATION_ICONS[type] ?? 'Bell';
  // Simple emoji fallback since we can't dynamically import Lucide icons
  const EMOJI: Record<string, string> = {
    TASK_ASSIGNED: '👤', TASK_UNASSIGNED: '👤', TASK_COMPLETED: '✅',
    TASK_STATUS_CHANGED: '↔️', TASK_DELETED: '🗑️', COMMENT_ADDED: '💬',
    WORKSPACE_MEMBER_JOINED: '🎉', WORKSPACE_MEMBER_REMOVED: '👋',
    PROJECT_CREATED: '📁',
  };
  return <span className="text-base">{EMOJI[type] ?? '🔔'}</span>;
}

function NotificationItem({
  notification,
  onMarkRead,
  onDelete,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        'flex gap-3 px-5 py-4 hover:bg-zinc-900/40 border-b border-zinc-900/40 transition-all group',
        !notification.isRead && 'bg-zinc-900/20 hover:bg-zinc-900/30',
      )}
    >
      {/* Icon */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-950 border border-zinc-850 flex items-center justify-center mt-0.5">
        <NotificationIcon type={notification.type} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white line-clamp-1">{notification.title}</p>
        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2 leading-relaxed">{notification.message}</p>
        <p className="text-[10px] text-zinc-500 mt-1.5 font-medium">{formatRelativeTime(notification.createdAt)}</p>
      </div>

      {/* Actions — visible on hover */}
      <div className="flex-shrink-0 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {!notification.isRead && (
          <button
            onClick={() => onMarkRead(notification.id)}
            className="p-1 text-zinc-400 hover:text-white rounded transition-colors"
            title="Mark as read"
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={() => onDelete(notification.id)}
          className="p-1 text-zinc-400 hover:text-red-400 rounded transition-colors"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Unread dot */}
      {!notification.isRead && (
        <div className="flex-shrink-0 w-2 h-2 bg-white rounded-full mt-2 self-start" />
      )}
    </div>
  );
}

export function NotificationPanel({ open, onClose, orgId }: NotificationPanelProps) {
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'list', orgId],
    queryFn: () => notificationApi.list({ orgId, limit: 30 }),
    enabled: open,
  });

  const invalidateCount = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count', orgId] });
    queryClient.invalidateQueries({ queryKey: ['notifications', 'list', orgId] });
  };

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markAsRead(id, orgId),
    onSuccess: invalidateCount,
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationApi.markAllAsRead(orgId),
    onSuccess: invalidateCount,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => notificationApi.delete(id),
    onSuccess: invalidateCount,
  });

  const notifications = data?.data ?? [];
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  if (!open || !mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-all" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 z-50 h-full w-96 max-w-full bg-zinc-950/90 backdrop-blur-2xl shadow-2xl flex flex-col border-l border-zinc-900 animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-900 bg-zinc-950/60 flex-shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white">Notifications</h2>
            {unreadCount > 0 && (
              <span className="bg-white text-black text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllMutation.mutate()}
                loading={markAllMutation.isPending}
                className="text-xs text-zinc-400 hover:text-white hover:bg-zinc-900/60 font-semibold"
              >
                Mark all read
              </Button>
            )}
            <button onClick={onClose} className="p-1.5 text-white hover:bg-zinc-900/60 rounded-lg transition-all" aria-label="Close panel">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Spinner />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-4">
              <span className="text-4xl mb-3 opacity-60">🔔</span>
              <p className="text-sm font-semibold text-zinc-300">You&apos;re all caught up!</p>
              <p className="text-xs text-zinc-500 mt-1">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-900/60">
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkRead={(id) => markReadMutation.mutate(id)}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
