'use client';

// =============================================================================
// NOTIFICATION BELL — Badge showing unread count + panel toggle
// =============================================================================
// Polls the notification count every 60 seconds (React Query refetchInterval).
// The backend serves this from Redis cache — very cheap to call frequently.
// =============================================================================

import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { notificationApi } from '@/lib/api/notification';
import { NotificationPanel } from './notification-panel';

interface NotificationBellProps {
  orgId: string;
}

export function NotificationBell({ orgId }: NotificationBellProps) {
  const [panelOpen, setPanelOpen] = useState(false);

  const { data: count = 0 } = useQuery({
    queryKey: ['notifications', 'unread-count', orgId],
    queryFn: () => notificationApi.getUnreadCount(orgId),
    refetchInterval: 60_000,   // poll every 60s (badge stays fresh)
    staleTime: 30_000,
  });

  return (
    <>
      <button
        onClick={() => setPanelOpen(true)}
        className="relative p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        aria-label={`Notifications — ${count} unread`}
      >
        <Bell className="h-5 w-5" />

        {/* Red badge — only visible when count > 0 */}
        {count > 0 && (
          <span
            className={cn(
              'absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center',
              'rounded-full bg-red-500 text-white text-[10px] font-bold px-1',
            )}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      <NotificationPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        orgId={orgId}
      />
    </>
  );
}
