'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { taskApi } from '@/lib/api/task';
import { Modal } from '../ui/modal';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { getApiErrorMessage } from '@/lib/api/client';
import { useEffect, useState } from 'react';
import type { Board, Task } from '@/lib/types';

const editTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  boardId: z.string().uuid(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  description: z.string().max(5000).optional(),
  dueDate: z.string().optional(),
  estimatedHours: z.string().optional().transform((v) => (v ? parseFloat(v) : undefined)),
});

type EditTaskFormInput = z.input<typeof editTaskSchema>;
type EditTaskFormOutput = z.output<typeof editTaskSchema>;

interface TaskDetailModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  projectId: string;
  boards: Board[];
  task: Task | null;
}

export function TaskDetailModal({
  open,
  onClose,
  orgId,
  projectId,
  boards,
  task,
}: TaskDetailModalProps) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditTaskFormInput>({
    resolver: zodResolver(editTaskSchema),
  });

  // Sync form defaults when the task changes
  useEffect(() => {
    if (task) {
      // Format ISO string to YYYY-MM-DD for input type="date"
      let formattedDate = '';
      if (task.dueDate) {
        formattedDate = new Date(task.dueDate).toISOString().split('T')[0];
      }

      reset({
        title: task.title,
        boardId: task.boardId,
        priority: task.priority,
        description: task.description || '',
        dueDate: formattedDate,
        estimatedHours: task.estimatedHours ? String(task.estimatedHours) : '',
      });
    }
  }, [task, reset]);

  const mutation = useMutation({
    mutationFn: async (values: EditTaskFormInput) => {
      if (!task) return;

      // 1. Move task if column/board changed
      if (values.boardId !== task.boardId) {
        await taskApi.moveTask(orgId, projectId, task.id, {
          targetBoardId: values.boardId,
        });
      }

      // 2. Update other details
      await taskApi.updateTask(orgId, projectId, task.id, {
        title: values.title,
        description: values.description || null,
        priority: values.priority || 'medium',
        dueDate: values.dueDate || null,
        estimatedHours: values.estimatedHours ? Number(values.estimatedHours) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', orgId, projectId] });
      setServerError(null);
      onClose();
    },
    onError: (err) => setServerError(getApiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!task) throw new Error('No task selected');
      return taskApi.deleteTask(orgId, projectId, task.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', orgId, projectId] });
      setServerError(null);
      onClose();
    },
    onError: (err) => setServerError(getApiErrorMessage(err)),
  });

  if (!task) return null;

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      deleteMutation.mutate();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Task Details — ${task.taskKey}`}
      size="md"
    >
      <form
        onSubmit={handleSubmit((v) => {
          setServerError(null);
          mutation.mutate(v);
        })}
        className="space-y-5"
      >
        <Input
          label="Title"
          placeholder="Task title"
          error={errors.title?.message}
          className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
          {...register('title')}
        />

        <div className="grid grid-cols-2 gap-4">
          {/* Column/Status Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-zinc-300">Column (Status)</label>
            <select
              className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-sm bg-zinc-900 text-white focus:border-white focus:ring-1 focus:ring-white focus:outline-none transition-all"
              {...register('boardId')}
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id} className="bg-zinc-900 text-white">
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Priority Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-zinc-300">Priority</label>
            <select
              className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-sm bg-zinc-900 text-white focus:border-white focus:ring-1 focus:ring-white focus:outline-none transition-all"
              {...register('priority')}
            >
              <option value="low" className="bg-zinc-900 text-white">Low</option>
              <option value="medium" className="bg-zinc-900 text-white">Medium</option>
              <option value="high" className="bg-zinc-900 text-white">High</option>
              <option value="urgent" className="bg-zinc-900 text-white">Urgent</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-zinc-300">Description</label>
          <textarea
            className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-sm resize-none bg-zinc-900 text-white placeholder-zinc-500 focus:border-white focus:ring-1 focus:ring-white focus:outline-none transition-all"
            rows={4}
            placeholder="Add a more detailed description..."
            {...register('description')}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Due date"
            type="date"
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
            {...register('dueDate')}
          />
          <Input
            label="Estimated hours"
            type="number"
            step="0.5"
            min="0"
            placeholder="e.g. 8"
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
            {...register('estimatedHours')}
          />
        </div>

        {serverError && <p className="text-xs text-red-400 font-semibold">{serverError}</p>}

        <div className="flex justify-between items-center pt-4 border-t border-zinc-900">
          <Button
            variant="danger"
            type="button"
            loading={deleteMutation.isPending}
            onClick={handleDelete}
            className="bg-red-650 hover:bg-red-500 text-white font-bold border-none transition-all shadow-md rounded-xl"
          >
            Delete Task
          </Button>

          <div className="flex gap-3">
            <Button variant="ghost" type="button" onClick={onClose} className="text-zinc-400 hover:text-white hover:bg-zinc-900/60">
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-white hover:bg-zinc-200 text-black font-bold border-none shadow-md hover:shadow-lg transition-all"
              loading={isSubmitting || mutation.isPending}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
