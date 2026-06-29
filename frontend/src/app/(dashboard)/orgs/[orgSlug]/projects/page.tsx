'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, FolderKanban } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { workspaceApi } from '@/lib/api/workspace';
import { useUIStore } from '@/store/ui.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { getApiErrorMessage } from '@/lib/api/client';
import { formatRelativeTime } from '@/lib/utils';

const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  key: z
    .string()
    .min(2, 'Key must be 2-10 characters')
    .max(10)
    .regex(/^[A-Z0-9]+$/, 'Key must be uppercase letters and numbers only'),
  description: z.string().max(500).optional(),
});

type CreateProjectForm = z.infer<typeof createProjectSchema>;

export default function ProjectsPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeOrgId = useUIStore((s) => s.activeOrgId);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', activeOrgId],
    queryFn: () => workspaceApi.listProjects(activeOrgId!),
    enabled: !!activeOrgId,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectForm>({ resolver: zodResolver(createProjectSchema) });

  // Auto-generate key from name (first 3-6 uppercase chars)
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
    setValue('key', key);
  };

  const createMutation = useMutation({
    mutationFn: (values: CreateProjectForm) =>
      workspaceApi.createProject(activeOrgId!, values),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['projects', activeOrgId] });
      reset();
      setModalOpen(false);
      router.push(`/orgs/${orgSlug}/projects/${project.id}`);
    },
    onError: (err) => setServerError(getApiErrorMessage(err)),
  });

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Projects</h1>
        <Button onClick={() => setModalOpen(true)} className="bg-white hover:bg-zinc-200 text-black font-bold shadow-[0_4px_20px_rgba(255,255,255,0.08)] border-none rounded-xl px-4 py-2 flex items-center gap-1.5 transition-all">
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : projects?.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/20">
          <FolderKanban className="h-12 w-12 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 font-bold text-lg">No projects yet</p>
          <p className="text-sm text-zinc-500 mt-1">Create your first project to start tracking work</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects?.map((project) => (
            <button
              key={project.id}
              onClick={() => router.push(`/orgs/${orgSlug}/projects/${project.id}`)}
              className="text-left p-6 bg-zinc-900/40 backdrop-blur-xl border border-zinc-800/80 hover:border-zinc-750 hover:bg-zinc-900/60 shadow-xl hover:-translate-y-0.5 transition-all duration-300 group relative overflow-hidden rounded-2xl"
            >
              {/* Decorative corner hover gradient */}
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-white/5 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

              <div className="flex items-start justify-between mb-4 w-full">
                <div>
                  <p className="font-bold text-zinc-100 text-lg group-hover:text-white transition-colors duration-200">{project.name}</p>
                  <code className="inline-block text-[10px] font-bold tracking-wider text-zinc-300 bg-zinc-900 border border-zinc-800 px-2 py-0.5 mt-1 rounded font-mono uppercase">{project.key}</code>
                </div>
                <Badge variant={project.status === 'active' ? 'success' : 'default'} className="shadow-sm">
                  {project.status}
                </Badge>
              </div>
              {project.description ? (
                <p className="text-sm text-zinc-400 line-clamp-2 mb-5 leading-relaxed h-10">{project.description}</p>
              ) : (
                <p className="text-sm text-zinc-500 italic line-clamp-2 mb-5 leading-relaxed h-10">No description provided.</p>
              )}
              <div className="flex items-center justify-between text-xs text-zinc-500 border-t border-zinc-800/60 pt-4 mt-1 w-full">
                <span className="flex items-center gap-1.5 font-medium text-zinc-400">
                  <FolderKanban className="h-3.5 w-3.5 text-zinc-500" />
                  {project.taskCount ?? 0} tasks
                </span>
                <span>Created {formatRelativeTime(project.createdAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); reset(); setServerError(null); }}
        title="Create project"
        size="sm"
      >
        <form onSubmit={handleSubmit((v) => { setServerError(null); createMutation.mutate(v); })} className="space-y-5">
          <Input label="Project name" placeholder="Backend API" error={errors.name?.message}
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
            {...register('name', { onChange: handleNameChange })} />
          <Input label="Project key" placeholder="BAPI" error={errors.key?.message}
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
            {...register('key')} />
          <Input label="Description (optional)" placeholder="What are you building?"
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
            {...register('description')} />
          {serverError && <p className="text-xs text-red-400 font-semibold">{serverError}</p>}
          <div className="flex justify-end gap-3 pt-3">
            <Button variant="ghost" type="button" onClick={() => setModalOpen(false)} className="text-zinc-400 hover:text-white hover:bg-zinc-900/60">Cancel</Button>
            <Button type="submit" loading={isSubmitting || createMutation.isPending} className="bg-white hover:bg-zinc-200 text-black font-bold shadow-md hover:shadow-lg transition-all border-none">Create</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
