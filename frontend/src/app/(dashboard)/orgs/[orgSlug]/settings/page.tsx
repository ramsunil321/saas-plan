'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workspaceApi } from '@/lib/api/workspace';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Settings, Trash2, ShieldAlert } from 'lucide-react';

export default function SettingsPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  // 1. Fetch organization details
  const { data: org, isLoading: orgLoading } = useQuery({
    queryKey: ['organizations', 'by-slug', orgSlug],
    queryFn: () => workspaceApi.listOrgs().then((orgs) => orgs.find((o) => o.slug === orgSlug)),
    enabled: !!orgSlug,
  });

  const orgId = org?.id;

  // 2. Fetch full org details (which contains the user's role)
  const { data: orgDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['organization-detail', orgId],
    queryFn: () => workspaceApi.getOrg(orgId!),
    enabled: !!orgId,
  });

  // Local form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Sync form inputs when orgDetail is loaded
  useEffect(() => {
    if (orgDetail) {
      setName(orgDetail.name);
      setDescription(orgDetail.description || '');
    }
  }, [orgDetail]);

  const userRole = orgDetail?.role || 'viewer';
  const canUpdate = userRole === 'owner' || userRole === 'admin';
  const canDelete = userRole === 'owner';

  // Update org mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('Organization not loaded');
      return workspaceApi.updateOrg(orgId, { name, description });
    },
    onSuccess: (updatedOrg) => {
      // Invalidate query caches
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      queryClient.invalidateQueries({ queryKey: ['organizations', 'by-slug', orgSlug] });
      setSuccess('Organization details updated successfully!');
      setError(null);
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: (err: any) => {
      setError(err.response?.data?.error?.message || 'Failed to update organization');
    },
  });

  // Delete org mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('Organization not loaded');
      await workspaceApi.deleteOrg(orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      router.push('/dashboard');
    },
    onError: (err: any) => {
      alert(err.response?.data?.error?.message || 'Failed to delete organization');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    updateMutation.mutate();
  };

  const handleDeleteOrg = () => {
    if (
      window.confirm(
        `DANGER: Are you absolutely sure you want to delete the organization "${orgDetail?.name}"?\nThis will permanently delete all projects, boards, and tasks. This action CANNOT be undone.`
      )
    ) {
      deleteMutation.mutate();
    }
  };

  if (orgLoading || detailLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!orgDetail) {
    return (
      <div className="p-6 text-center text-zinc-500">
        Organization settings could not be loaded.
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8 animate-fade-in-up">
      {/* Title */}
      <div className="pb-5 border-b border-zinc-900">
        <h1 className="text-3xl font-extrabold text-white flex items-center gap-2.5 tracking-tight">
          <Settings className="h-7 w-7 text-white" />
          Organization Settings
        </h1>
        <p className="text-sm text-zinc-400 mt-1.5 font-medium">
          Modify details and configure permissions for the {orgDetail.name} organization.
        </p>
      </div>

      {/* General Settings form */}
      <div className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800/80 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-zinc-900 bg-zinc-950/40">
          <h2 className="text-sm font-semibold text-zinc-350">General Information</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <Input
            label="Organization Name"
            placeholder="e.g. Acme Corporation"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canUpdate || updateMutation.isPending}
            required
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all animate-none"
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-zinc-350">Description</label>
            <textarea
              className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-sm resize-none bg-zinc-900 text-white placeholder-zinc-500 focus:border-white focus:ring-1 focus:ring-white focus:outline-none disabled:bg-zinc-950 disabled:text-zinc-500 transition-all"
              rows={4}
              placeholder="Tell us about your organization..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canUpdate || updateMutation.isPending}
            />
          </div>

          {error && <p className="text-xs text-red-400 font-semibold">{error}</p>}
          {success && <p className="text-xs text-emerald-450 font-semibold">{success}</p>}

          {canUpdate && (
            <div className="flex justify-end pt-4 border-t border-zinc-900">
              <Button type="submit" loading={updateMutation.isPending} className="bg-white hover:bg-zinc-200 text-black font-bold shadow-md hover:shadow-lg transition-all border-none">
                Save Settings
              </Button>
            </div>
          )}
        </form>
      </div>

      {/* Danger Zone */}
      {canDelete && (
        <div className="bg-red-950/10 rounded-2xl border border-red-900/40 overflow-hidden shadow-xl">
          <div className="px-6 py-4 border-b border-red-900/40 bg-red-950/25 flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-400" />
            <h2 className="text-sm font-bold text-red-200">Danger Zone</h2>
          </div>

          <div className="p-6 space-y-4">
            <p className="text-sm text-red-350 leading-relaxed">
              Once you delete an organization, all associated data, including projects, boards, and tasks will be permanently removed.
              This action is irreversible.
            </p>

            <div className="flex justify-start">
              <Button
                variant="danger"
                type="button"
                onClick={handleDeleteOrg}
                loading={deleteMutation.isPending}
                className="flex items-center gap-2 bg-red-650 hover:bg-red-500 text-white font-bold border-none transition-all rounded-xl shadow-md"
              >
                <Trash2 className="h-4 w-4" />
                Delete Organization
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
