'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, Building2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { workspaceApi } from '@/lib/api/workspace';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { getApiErrorMessage } from '@/lib/api/client';

const createOrgSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
  description: z.string().max(500).optional(),
});

type CreateOrgForm = z.infer<typeof createOrgSchema>;

export default function DashboardPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const { data: orgs, isLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: workspaceApi.listOrgs,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrgForm>({ resolver: zodResolver(createOrgSchema) });

  const nameValue = watch('name');

  // Auto-generate slug from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const slug = e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    setValue('slug', slug);
  };

  const createOrgMutation = useMutation({
    mutationFn: workspaceApi.createOrg,
    onSuccess: (org) => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      reset();
      setModalOpen(false);
      router.push(`/orgs/${org.slug}`);
    },
    onError: (err) => setServerError(getApiErrorMessage(err)),
  });

  const onSubmit = (values: CreateOrgForm) => {
    setServerError(null);
    createOrgMutation.mutate(values);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-fade-in-up">
      {/* Welcome header */}
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">
          Welcome back, {user?.firstName}!
        </h1>
        <p className="text-zinc-400 mt-1.5 font-medium">Select an organization to get started</p>
      </div>

      {/* Organizations grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {orgs?.map((org) => (
            <button
              key={org.id}
              onClick={() => router.push(`/orgs/${org.slug}`)}
              className="text-left p-6 bg-zinc-900/40 backdrop-blur-xl border border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/60 shadow-xl rounded-2xl transition-all duration-200 group flex flex-col justify-between min-h-[140px] hover:-translate-y-0.5"
            >
              <div className="flex items-center gap-3.5 mb-3 w-full">
                <div className="w-10 h-10 bg-white text-black rounded-xl flex items-center justify-center font-extrabold text-lg flex-shrink-0 shadow-lg ring-1 ring-white/10 group-hover:scale-105 transition-transform duration-200">
                  {org.name[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-zinc-100 group-hover:text-white truncate transition-colors">{org.name}</p>
                  <p className="text-xs text-zinc-500 font-mono mt-0.5">{org.slug}</p>
                </div>
              </div>
              <div className="flex gap-4 text-xs text-zinc-400 font-medium border-t border-zinc-900/60 pt-3 mt-4 w-full">
                <span>{org.memberCount ?? 0} members</span>
                <span>{org.projectCount ?? 0} projects</span>
                <span className="capitalize">{org.plan} plan</span>
              </div>
            </button>
          ))}

          {/* Create new org card */}
          <button
            onClick={() => setModalOpen(true)}
            className="p-6 bg-zinc-950/20 backdrop-blur-md rounded-2xl border border-dashed border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/20 transition-all flex flex-col items-center justify-center gap-2.5 min-h-[140px] group"
          >
            <div className="w-10 h-10 bg-zinc-900 group-hover:bg-zinc-800 rounded-xl flex items-center justify-center transition-colors border border-zinc-850/60 shadow-md">
              <Plus className="h-5 w-5 text-zinc-400 group-hover:text-white transition-colors" />
            </div>
            <span className="text-sm font-semibold text-zinc-500 group-hover:text-zinc-200 transition-colors">New organization</span>
          </button>
        </div>
      )}

      {/* Create org modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); reset(); setServerError(null); }}
        title="Create organization"
        size="sm"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <Input
            label="Organization name"
            placeholder="Acme Corp"
            error={errors.name?.message}
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
            {...register('name', { onChange: handleNameChange })}
          />
          <Input
            label="URL slug"
            placeholder="acme-corp"
            error={errors.slug?.message}
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
            {...register('slug')}
          />
          <Input
            label="Description (optional)"
            placeholder="What does your org do?"
            error={errors.description?.message}
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
            {...register('description')}
          />

          {serverError && (
            <p className="text-xs text-red-400 font-semibold">{serverError}</p>
          )}

          <div className="flex justify-end gap-3 pt-3">
            <Button variant="ghost" type="button" onClick={() => setModalOpen(false)} className="text-zinc-400 hover:text-white hover:bg-zinc-900/60">
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting || createOrgMutation.isPending} className="bg-white hover:bg-zinc-200 text-black font-bold shadow-md hover:shadow-lg transition-all border-none">
              Create organization
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
