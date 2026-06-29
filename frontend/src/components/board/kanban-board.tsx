'use client';

// =============================================================================
// KANBAN BOARD — Drag-and-drop project board (the core UI feature)
// =============================================================================
//
// DRAG-AND-DROP ARCHITECTURE (@dnd-kit):
//   DndContext: root context for all drag operations — one per board
//   DragOverlay: renders the "ghost" card that follows the cursor during drag
//   useDroppable (in BoardColumn): marks a column as a valid drop target
//   useSortable (in TaskCard): makes each card draggable AND sortable
//
// TWO TYPES OF DRAG MOVES:
//   1. Within same column (sort): drag from position 2 to position 4
//      → update task.position to average of neighbors (fractional indexing)
//   2. Between columns (move): drag from "Todo" to "In Progress"
//      → call moveTask API which updates boardId + denormalized status
//
// OPTIMISTIC UPDATES:
//   When a task is dropped, we update the LOCAL state IMMEDIATELY (optimistic),
//   then call the API in the background. If the API fails, we REVERT the local
//   state (rollback). This gives instant perceived performance:
//   the card "snaps" to its new position without waiting for the network.
//
// STATE SHAPE:
//   boardTasks: { [boardId]: Task[] }
//   One array per column, ordered by position (asc).
//   When a task moves, we splice it from source array and insert into target.
//
// FRACTIONAL POSITION CALCULATION:
//   New position = (before.position + after.position) / 2
//   If dropped at start: newPosition = firstTask.position / 2
//   If dropped at end:   newPosition = lastTask.position + 65536
//
// INTERVIEW QUESTION: "How does dnd-kit differ from react-beautiful-dnd?"
//   Answer: dnd-kit is headless (no default styles, full control), uses the
//   Pointer Events API (supports touch + mouse + keyboard natively), is tree-
//   shakeable (smaller bundle), and actively maintained. react-beautiful-dnd
//   is archived (no longer maintained). @hello-pangea/dnd is the community fork.
// =============================================================================

import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { taskApi } from '@/lib/api/task';
import { workspaceApi } from '@/lib/api/workspace';
import { TaskCard } from './task-card';
import { BoardColumn } from './board-column';
import { CreateTaskModal } from './create-task-modal';
import { TaskDetailModal } from './task-detail-modal';
import { Spinner } from '../ui/spinner';
import type { Board, Task } from '@/lib/types';

const POSITION_GAP = 65536;

interface KanbanBoardProps {
  orgId: string;
  projectId: string;
}

export function KanbanBoard({ orgId, projectId }: KanbanBoardProps) {
  const queryClient = useQueryClient();

  // ============================================================
  // DATA FETCHING
  // ============================================================

  const { data: boards = [], isLoading: boardsLoading } = useQuery({
    queryKey: ['boards', orgId, projectId],
    queryFn: () => workspaceApi.listBoards(orgId, projectId),
  });

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', orgId, projectId],
    queryFn: () => taskApi.listTasks(orgId, projectId, { limit: 500 }),
  });

  // ============================================================
  // LOCAL BOARD STATE — keyed by boardId for O(1) lookup
  // ============================================================

  const [boardTasks, setBoardTasks] = useState<Record<string, Task[]>>({});
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createBoardId, setCreateBoardId] = useState<string>('');
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Sync server data → local state whenever the query result changes
  useEffect(() => {
    if (!boards.length || !tasksData) return;

    const grouped: Record<string, Task[]> = {};
    for (const board of boards) grouped[board.id] = [];

    for (const task of tasksData.data) {
      if (grouped[task.boardId]) {
        grouped[task.boardId].push(task);
      }
    }

    // Sort each column by position (ascending)
    for (const tasks of Object.values(grouped)) {
      tasks.sort((a, b) => a.position - b.position);
    }

    setBoardTasks(grouped);
  }, [boards, tasksData]);

  // ============================================================
  // DND-KIT SENSORS
  // ============================================================
  // PointerSensor: handles mouse + touch drag
  // KeyboardSensor: handles keyboard drag (space → move with arrows → space to drop)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Only start dragging after 5px movement — prevents click vs drag confusion
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // ============================================================
  // MOVE TASK MUTATION
  // ============================================================

  const moveMutation = useMutation({
    mutationFn: ({
      taskId,
      targetBoardId,
      position,
    }: { taskId: string; targetBoardId: string; position: number }) =>
      taskApi.moveTask(orgId, projectId, taskId, { targetBoardId, position }),
    onError: (_err, _vars, context: { snapshot: Record<string, Task[]> } | undefined) => {
      // Rollback on failure — restore the pre-drag state
      if (context?.snapshot) setBoardTasks(context.snapshot);
    },
    onSuccess: () => {
      // Invalidate to sync any server-side changes (denormalized status, etc.)
      queryClient.invalidateQueries({ queryKey: ['tasks', orgId, projectId] });
    },
  });

  // ============================================================
  // CALCULATE NEW POSITION (fractional indexing)
  // ============================================================

  const calculatePosition = useCallback(
    (targetBoardId: string, activeTaskId: string, overId: string, overType: string): number => {
      const columnTasks = boardTasks[targetBoardId] ?? [];
      const cleanTasks = columnTasks.filter((t) => t.id !== activeTaskId);

      let overIndex: number;
      if (overType === 'column') {
        overIndex = cleanTasks.length;
      } else {
        overIndex = cleanTasks.findIndex((t) => t.id === overId);
        if (overIndex === -1) {
          overIndex = cleanTasks.length;
        }
      }

      const before = cleanTasks[overIndex - 1];
      const after = cleanTasks[overIndex];

      if (!before && !after) return POSITION_GAP;
      if (!before) return after.position / 2;
      if (!after) return before.position + POSITION_GAP;
      return (before.position + after.position) / 2;
    },
    [boardTasks],
  );

  // ============================================================
  // DRAG HANDLERS
  // ============================================================

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    const task = active.data.current?.task as Task | undefined;
    if (task) setActiveTask(task);
  }, []);

  // DragOver fires continuously while dragging — used for CROSS-COLUMN moves
  const handleDragOver = useCallback(
    ({ active, over }: DragOverEvent) => {
      if (!over) return;

      const activeTask = active.data.current?.task as Task | undefined;
      if (!activeTask) return;

      const overId = over.id as string;
      const overType = over.data.current?.type as string | undefined;

      // Determine the target boardId
      let targetBoardId: string;
      if (overType === 'column') {
        targetBoardId = overId;
      } else if (overType === 'task') {
        const overTask = over.data.current?.task as Task;
        targetBoardId = overTask.boardId;
      } else {
        return;
      }

      // Don't do anything if we're hovering over the same board
      if (activeTask.boardId === targetBoardId) return;

      // Optimistically move the task to the new column in local state
      setBoardTasks((prev) => {
        const sourceTasks = prev[activeTask.boardId]?.filter((t) => t.id !== activeTask.id) ?? [];
        const targetTasks = [...(prev[targetBoardId] ?? [])];

        // Find insertion index in target column
        if (overType === 'task') {
          const overTask = over.data.current?.task as Task;
          const overIndex = targetTasks.findIndex((t) => t.id === overTask.id);
          targetTasks.splice(overIndex, 0, { ...activeTask, boardId: targetBoardId });
        } else {
          targetTasks.push({ ...activeTask, boardId: targetBoardId });
        }

        return {
          ...prev,
          [activeTask.boardId]: sourceTasks,
          [targetBoardId]: targetTasks,
        };
      });

      // Update the active task's boardId for subsequent dragOver events
      setActiveTask((prev) => prev ? { ...prev, boardId: targetBoardId } : null);
    },
    [],
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setActiveTask(null);

      if (!over) return;

      const activeTask = active.data.current?.task as Task | undefined;
      if (!activeTask) return;

      const overId = over.id as string;
      const overType = over.data.current?.type as string | undefined;

      let targetBoardId: string;
      let overIndex: number;

      if (overType === 'column') {
        targetBoardId = overId;
        overIndex = (boardTasks[targetBoardId] ?? []).length;
      } else if (overType === 'task') {
        const overTask = over.data.current?.task as Task;
        targetBoardId = overTask.boardId;
        const targetTasks = boardTasks[targetBoardId] ?? [];
        overIndex = targetTasks.findIndex((t) => t.id === overId);
      } else {
        return;
      }

      // Handle same-column reorder
      if (activeTask.boardId === targetBoardId) {
        const columnTasks = [...(boardTasks[targetBoardId] ?? [])];
        const fromIndex = columnTasks.findIndex((t) => t.id === activeTask.id);

        if (fromIndex === overIndex || fromIndex === -1) return;

        // Apply the sort locally
        const reordered = arrayMove(columnTasks, fromIndex, overIndex);
        setBoardTasks((prev) => ({ ...prev, [targetBoardId]: reordered }));

        // Calculate new fractional position
        const newPosition = calculatePosition(targetBoardId, activeTask.id, overId, overType);

        // Take a snapshot for rollback
        const snapshot = { ...boardTasks };

        moveMutation.mutate(
          { taskId: activeTask.id, targetBoardId, position: newPosition },
          { onError: () => setBoardTasks(snapshot) },
        );
      } else {
        // Cross-column move — local state already updated in handleDragOver
        const newPosition = calculatePosition(targetBoardId, activeTask.id, overId, overType);
        const snapshot = { ...boardTasks };

        moveMutation.mutate(
          { taskId: activeTask.id, targetBoardId, position: newPosition },
          { onError: () => setBoardTasks(snapshot) },
        );
      }
    },
    [boardTasks, calculatePosition, moveMutation],
  );

  // ============================================================
  // RENDER
  // ============================================================

  const isLoading = boardsLoading || tasksLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  const defaultBoard = boards[0];

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* Horizontal scrolling container for columns */}
        <div className="flex gap-4 p-4 overflow-x-auto h-full items-start">
          {boards.map((board) => (
            <BoardColumn
              key={board.id}
              board={board}
              tasks={boardTasks[board.id] ?? []}
              onTaskClick={(task) => {
                setSelectedTask(task);
                setDetailModalOpen(true);
              }}
              onAddTask={(boardId) => {
                setCreateBoardId(boardId);
                setCreateModalOpen(true);
              }}
            />
          ))}
        </div>

        {/*
          DragOverlay renders the card that "follows" the cursor while dragging.
          It renders OUTSIDE the sortable lists so it isn't affected by their
          transforms. This is what makes the drag look smooth and 3D.
        */}
        <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
          {activeTask && (
            <div className="rotate-2 shadow-2xl opacity-95">
              <TaskCard task={activeTask} onClick={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {defaultBoard && (
        <CreateTaskModal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          orgId={orgId}
          projectId={projectId}
          boards={boards}
          defaultBoardId={createBoardId || defaultBoard.id}
        />
      )}

      <TaskDetailModal
        open={detailModalOpen}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedTask(null);
        }}
        orgId={orgId}
        projectId={projectId}
        boards={boards}
        task={selectedTask}
      />
    </>
  );
}
