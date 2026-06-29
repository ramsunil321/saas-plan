'use client';

// =============================================================================
// TASK CARD — Individual card rendered inside a Kanban column
// =============================================================================
// Wrapped with useSortable from @dnd-kit/sortable to make it draggable.
// The visual transform/transition is handled by dnd-kit CSS vars.
//
// ACCESSIBILITY:
//   dnd-kit's useSortable provides keyboard drag-and-drop out of the box:
//   Space to pick up, arrow keys to move, Space/Enter to drop.
//   This satisfies WCAG 2.1 Level AA requirement for keyboard accessibility.
//
// PERFORMANCE:
//   Task cards are memoized. Without React.memo, moving one task would
//   re-render ALL cards in ALL columns (hundreds of DOM updates).
//   With memo, only the moved card and destination column re-render.
// =============================================================================

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { memo, useState } from 'react';
import { GripVertical, Calendar, User } from 'lucide-react';
import { cn, PRIORITY_BORDER, formatRelativeTime, getInitials, truncate } from '@/lib/utils';
import { PriorityBadge } from '../ui/badge';
import type { Task } from '@/lib/types';

interface TaskCardProps {
  task: Task;
  onClick: (task: Task) => void;
}

export const TaskCard = memo(function TaskCard({ task, onClick }: TaskCardProps) {
  // useSortable: gives us drag handles, transform state, and a11y props
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: 'task', task },  // pass task data so drop handlers can access it
  });

  const style = {
    // CSS.Transform.toString() converts {x, y, scaleX, scaleY} → CSS translate()
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const PRIORITY_THEME = {
    low: {
      dot: 'bg-zinc-500',
      bg: 'bg-zinc-950 border-zinc-850 text-zinc-400',
    },
    medium: {
      dot: 'bg-amber-500',
      bg: 'bg-zinc-950 border-amber-950/50 text-amber-500',
    },
    high: {
      dot: 'bg-orange-500',
      bg: 'bg-zinc-950 border-orange-950/50 text-orange-550',
    },
    urgent: {
      dot: 'bg-red-500 animate-pulse',
      bg: 'bg-zinc-950 border-red-950/50 text-red-400',
    },
  };

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        // Base card styles
        'bg-zinc-900/40 backdrop-blur-xl border border-zinc-850/80 p-3.5 cursor-pointer group',
        'hover:border-zinc-700 hover:bg-zinc-900/60 shadow-xl hover:-translate-y-0.5 transition-all duration-200 relative rounded-xl',
        // Left-side indicator bar for dragging / focus
        'before:absolute before:left-0 before:top-3 before:bottom-3 before:w-1 before:rounded-r-md before:bg-transparent hover:before:bg-white before:transition-colors',
        // While dragging: make the card semi-transparent
        isDragging && 'opacity-30 shadow-none border-dashed border-zinc-800',
      )}
      onClick={() => onClick(task)}
    >
      {/* Card header: task key + drag handle */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="text-[10px] font-bold tracking-wider text-zinc-400 font-mono bg-zinc-950 border border-zinc-850 px-1.5 py-0.5 rounded">
          {task.taskKey}
        </span>

        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-white hover:bg-zinc-950 cursor-grab active:cursor-grabbing transition-all rounded-md"
          onClick={(e) => e.stopPropagation()}
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
      </div>

      {/* Task title */}
      <p className="text-sm font-semibold text-zinc-200 leading-relaxed mb-3 group-hover:text-white transition-colors line-clamp-2">
        {task.title}
      </p>

      {/* Footer: priority + due date + assignees */}
      <div className="flex items-center justify-between gap-2 border-t border-zinc-900/80 pt-2.5 mt-1">
        {/* Custom priority pill */}
        <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border capitalize', PRIORITY_THEME[task.priority].bg)}>
          <span className={cn('w-1.5 h-1.5 rounded-full', PRIORITY_THEME[task.priority].dot)} />
          {task.priority}
        </span>

        <div className="flex items-center gap-2.5">
          {/* Due date */}
          {task.dueDate && (
            <span className={cn(
              'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium',
              isOverdue 
                ? 'text-red-400 bg-red-950/30 border border-red-900/50'
                : 'text-zinc-500 hover:text-zinc-300'
            )}>
              <Calendar className="h-3 w-3" />
              {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}

          {/* Assignee avatars — show max 3 */}
          {task.assignees.length > 0 && (
            <div className="flex -space-x-1.5">
              {task.assignees.slice(0, 3).map((a) => (
                <div
                  key={a.userId}
                  className="w-5.5 h-5.5 rounded-full bg-gradient-to-tr from-zinc-700 to-zinc-650 border border-zinc-900 flex items-center justify-center text-[8px] font-bold text-white shadow-sm"
                  title={`${a.firstName} ${a.lastName}`}
                >
                  {getInitials(a.firstName, a.lastName)}
                </div>
              ))}
              {task.assignees.length > 3 && (
                <div className="w-5.5 h-5.5 rounded-full bg-zinc-800 border border-zinc-900 flex items-center justify-center text-[8px] font-bold text-zinc-400 shadow-sm">
                  +{task.assignees.length - 3}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
