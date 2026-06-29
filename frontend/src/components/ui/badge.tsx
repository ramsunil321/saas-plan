'use client';
import { cn } from '@/lib/utils';
import { PRIORITY_COLORS } from '@/lib/utils';
import type { TaskPriority } from '@/lib/types';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

const VARIANT = {
  default: 'bg-gray-100 text-gray-600',
  success: 'bg-green-50 text-green-700',
  warning: 'bg-yellow-50 text-yellow-700',
  danger:  'bg-red-50 text-red-700',
  info:    'bg-blue-50 text-blue-700',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', VARIANT[variant], className)}>
      {children}
    </span>
  );
}

// Specific component for task priority — uses the shared priority color map
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize', PRIORITY_COLORS[priority])}>
      {priority}
    </span>
  );
}
