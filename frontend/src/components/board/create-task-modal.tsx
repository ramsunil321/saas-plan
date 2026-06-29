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
import { useState, useEffect } from 'react';
import type { Board } from '@/lib/types';

const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  boardId: z.string().uuid(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  description: z.string().max(5000).optional(),
  dueDate: z.string().optional(),
  estimatedHours: z.string().optional().transform((v) => (v ? parseFloat(v) : undefined)),
});

type CreateTaskForm = z.infer<typeof createTaskSchema>;

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  projectId: string;
  boards: Board[];
  defaultBoardId: string;
}

export function CreateTaskModal({
  open, onClose, orgId, projectId, boards, defaultBoardId,
}: CreateTaskModalProps) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateTaskForm>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: { boardId: defaultBoardId, priority: 'medium' },
  });

  useEffect(() => {
    if (open) {
      reset({
        title: '',
        boardId: defaultBoardId,
        priority: 'medium',
        description: '',
        dueDate: '',
        estimatedHours: undefined,
      });
    }
  }, [open, defaultBoardId, reset]);

  const mutation = useMutation({
    mutationFn: (values: CreateTaskForm) =>
      taskApi.createTask(orgId, projectId, {
        title: values.title,
        boardId: values.boardId,
        priority: values.priority,
        description: values.description,
        dueDate: values.dueDate || undefined,
        estimatedHours: values.estimatedHours,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', orgId, projectId] });
      reset();
      onClose();
    },
    onError: (err) => setServerError(getApiErrorMessage(err)),
  });

  const handleClose = () => { reset(); setServerError(null); onClose(); };

  return (
    <Modal open={open} onClose={handleClose} title="Create task" size="md">
      <form onSubmit={handleSubmit((v) => { setServerError(null); mutation.mutate(v); })} className="space-y-5">
        <Input
          label="Title"
          placeholder="What needs to be done?"
          error={errors.title?.message}
          autoFocus
          className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
          {...register('title')}
        />

        <div className="grid grid-cols-2 gap-4">
          {/* Column selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-zinc-300">Column</label>
            <select
              className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-sm bg-zinc-900 text-white focus:border-white focus:ring-1 focus:ring-white focus:outline-none transition-all"
              {...register('boardId')}
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id} className="bg-zinc-900 text-white">{b.name}</option>
              ))}
            </select>
          </div>

          {/* Priority selector */}
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
          <label className="text-sm font-semibold text-zinc-300">Description (optional)</label>
          <textarea
            className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-sm resize-none bg-zinc-900 text-white placeholder-zinc-500 focus:border-white focus:ring-1 focus:ring-white focus:outline-none transition-all"
            rows={4}
            placeholder="Add more context..."
            {...register('description')}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Due date (optional)"
            type="date"
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
            {...register('dueDate')}
          />
          <Input
            label="Estimated hours (optional)"
            type="number"
            step="0.5"
            min="0"
            placeholder="e.g. 4.5"
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
            {...register('estimatedHours')}
          />
        </div>

        {serverError && <p className="text-xs text-red-400 font-semibold">{serverError}</p>}

        <div className="flex justify-end gap-3 pt-4 border-t border-zinc-900">
          <Button variant="ghost" type="button" onClick={handleClose} className="text-zinc-400 hover:text-white hover:bg-zinc-900/60">Cancel</Button>
          <Button type="submit" className="bg-white hover:bg-zinc-200 text-black font-bold border-none shadow-md hover:shadow-lg transition-all" loading={isSubmitting || mutation.isPending}>Create task</Button>
        </div>
      </form>
    </Modal>
  );
}
