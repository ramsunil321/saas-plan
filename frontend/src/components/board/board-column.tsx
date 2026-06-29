'use client';

// =============================================================================
// BOARD COLUMN — A single Kanban column (wraps @dnd-kit droppable area)
// =============================================================================
// Uses useDroppable to make the column a valid drop target.
// The column knows its own tasks and renders TaskCard for each.
//
// COLUMN SORTING STRATEGY:
//   SortableContext tells dnd-kit the ORDER of items in this column.
//   This enables animated reordering when tasks move within a column.
//   The strategy 'verticalListSortingStrategy' optimizes for vertical lists.
//
// INTERVIEW QUESTION: "How does dnd-kit know where to insert a dragged item?"
//   Answer: SortableContext provides the ordered item IDs. As you drag over
//   the list, dnd-kit computes the insertion index using the collision algorithm
//   (closestCenter, closestCorners, etc.). The collision result tells the
//   parent kanban-board.tsx which index to insert the task at.
// =============================================================================

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TaskCard } from './task-card';
import type { Board, Task } from '@/lib/types';

interface BoardColumnProps {
  board: Board;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onAddTask: (boardId: string) => void;
}

// Map board name → dark background color for visual distinction
const COLUMN_COLORS: Record<string, string> = {
  backlog:     'bg-zinc-900/20 backdrop-blur-md',
  todo:        'bg-zinc-900/20 backdrop-blur-md',
  'in progress': 'bg-zinc-900/20 backdrop-blur-md',
  'in_progress': 'bg-zinc-900/20 backdrop-blur-md',
  review:      'bg-zinc-900/20 backdrop-blur-md',
  done:        'bg-zinc-900/20 backdrop-blur-md',
};

// Map board name → header accent color
const HEADER_COLORS: Record<string, string> = {
  backlog:     'text-zinc-400 bg-zinc-900 border border-zinc-800/80',
  todo:        'text-zinc-300 bg-zinc-900 border border-zinc-800/80',
  'in progress': 'text-zinc-250 bg-zinc-900 border border-zinc-800/80',
  'in_progress': 'text-zinc-250 bg-zinc-900 border border-zinc-800/80',
  review:      'text-zinc-300 bg-zinc-900 border border-zinc-800/80',
  done:        'text-zinc-100 bg-zinc-900 border border-zinc-800/80',
};

export function BoardColumn({ board, tasks, onTaskClick, onAddTask }: BoardColumnProps) {
  // useDroppable makes this element a drop target — items dragged over it trigger onDragOver
  const { setNodeRef, isOver } = useDroppable({
    id: board.id,
    data: { type: 'column', board },
  });

  const normalizedName = board.name.toLowerCase();
  const bgColor = COLUMN_COLORS[normalizedName] ?? 'bg-zinc-900/20 backdrop-blur-md';
  const headerColor = HEADER_COLORS[normalizedName] ?? 'text-zinc-400 bg-zinc-900 border border-zinc-800/80';

  // Task IDs in order — passed to SortableContext
  const taskIds = tasks.map((t) => t.id);

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border border-zinc-850/80 min-w-[300px] w-[300px] max-h-full shadow-lg',
        bgColor,
        // Highlight column when a task is being dragged over it
        isOver && 'ring-2 ring-white/5 bg-zinc-900/40 border-zinc-700',
        'transition-all duration-200',
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-4 py-3.5 flex-shrink-0 border-b border-zinc-900/60 bg-zinc-950/60 backdrop-blur-sm rounded-t-2xl">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-zinc-200 tracking-tight capitalize">{board.name}</h3>
          <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full shadow-sm', headerColor)}>
            {tasks.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onAddTask(board.id)}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-lg transition-all"
            title="Add task"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Task list — droppable area */}
      {/* The ref is on the scrollable inner div so the full column height is a drop target */}
      <div
        ref={setNodeRef}
        className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[100px]"
      >
        {/*
          SortableContext: gives dnd-kit the ordered task IDs for this column.
          When a task is dragged WITHIN this column, dnd-kit animates the sort.
          When a task is dragged FROM another column, this context accepts the drop.
        */}
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={onTaskClick} />
          ))}
        </SortableContext>

        {/* Empty state inside the column */}
        {tasks.length === 0 && (
          <div
            className="flex flex-col items-center justify-center h-20 rounded-xl border-2 border-dashed border-zinc-850 text-xs text-zinc-500 cursor-pointer hover:border-zinc-700 hover:text-zinc-300 bg-zinc-950/20 hover:bg-zinc-900/40 transition-all duration-200 gap-1"
            onClick={() => onAddTask(board.id)}
          >
            <Plus className="h-4.5 w-4.5" />
            <span>Add task or drop here</span>
          </div>
        )}
      </div>
    </div>
  );
}
