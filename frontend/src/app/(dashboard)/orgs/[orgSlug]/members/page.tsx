'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { workspaceApi } from '@/lib/api/workspace';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Users, UserMinus, Plus, Shield } from 'lucide-react';
import { getInitials } from '@/lib/utils';

export default function MembersPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  // 1. Fetch organization details to get organizationId
  const { data: org, isLoading: orgLoading } = useQuery({
    queryKey: ['organizations', 'by-slug', orgSlug],
    queryFn: () => workspaceApi.listOrgs().then((orgs) => orgs.find((o) => o.slug === orgSlug)),
    enabled: !!orgSlug,
  });

  const orgId = org?.id;

  // 2. Fetch current members
  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => workspaceApi.listMembers(orgId!),
    enabled: !!orgId,
  });

  // State for Add Member modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'admin' | 'manager' | 'developer' | 'viewer'>('developer');
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  // Determine current user's role in the org
  const myMemberRecord = members?.find((m) => m.userId === currentUser?.id);
  const myRole = myMemberRecord?.role || 'viewer';
  const canManage = myRole === 'owner' || myRole === 'admin';

  // Add member mutation (calls inviteMember on backend, which now adds them directly)
  const addMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('Organization not loaded');
      await workspaceApi.inviteMember(orgId, { email: memberEmail, role: memberRole });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', orgId] });
      setAddSuccess(`Successfully added ${memberEmail}!`);
      setMemberEmail('');
      setAddError(null);
      setTimeout(() => {
        setAddSuccess(null);
        setAddModalOpen(false);
      }, 2000);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Failed to add member';
      setAddError(msg);
    },
  });

  // Remove member mutation
  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!orgId) throw new Error('Organization not loaded');
      await workspaceApi.removeMember(orgId, userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', orgId] });
    },
    onError: (err: any) => {
      alert(err.response?.data?.error?.message || 'Failed to remove member');
    },
  });

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberEmail) return;
    addMutation.mutate();
  };

  const handleRemoveMember = (userId: string, name: string) => {
    if (window.confirm(`Are you sure you want to remove ${name} from this organization?`)) {
      removeMutation.mutate(userId);
    }
  };

  if (orgLoading || membersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="p-6 text-center text-zinc-500">
        Organization not found.
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-fade-in-up">
      {/* Title section */}
      <div className="flex items-center justify-between pb-5 border-b border-zinc-900">
        <div>
          <h1 className="text-3xl font-extrabold text-white flex items-center gap-2.5 tracking-tight">
            <Users className="h-7 w-7 text-white" />
            Members
          </h1>
          <p className="text-sm text-zinc-400 mt-1.5 font-medium">
            Manage who has access to the {org.name} organization and control their permissions.
          </p>
        </div>

        {canManage && (
          <Button onClick={() => setAddModalOpen(true)} className="bg-white hover:bg-zinc-200 text-black font-bold shadow-[0_4px_20px_rgba(255,255,255,0.08)] border-none rounded-xl px-4 py-2 flex items-center gap-1.5 transition-all">
            <Plus className="h-4 w-4" />
            Add Member
          </Button>
        )}
      </div>

      {/* Members List */}
      <div className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800/80 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-zinc-900 bg-zinc-950/40">
          <h2 className="text-sm font-semibold text-zinc-350">Active Members ({members?.length || 0})</h2>
        </div>

        <ul className="divide-y divide-zinc-900/60">
          {members?.map((member) => {
            const isMe = member.userId === currentUser?.id;
            const isOwner = member.role === 'owner';
            const showRemoveButton = canManage && !isMe && !isOwner;

            return (
              <li key={member.id} className="px-6 py-4 flex items-center justify-between hover:bg-zinc-900/20 transition-colors">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 bg-zinc-950 text-zinc-350 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 shadow-lg border border-zinc-850">
                    {getInitials(member.user.firstName, member.user.lastName)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-100 truncate flex items-center">
                      {member.user.firstName} {member.user.lastName}
                      {isMe && <span className="ml-2.5 text-[10px] font-bold bg-zinc-900 text-zinc-400 border border-zinc-800 px-2.5 py-0.5 rounded-full">You</span>}
                    </p>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">{member.user.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  {/* Role badge */}
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-zinc-950 text-zinc-300 border border-zinc-850 capitalize rounded-lg">
                    <Shield className="h-3 w-3 text-zinc-500" />
                    {member.role}
                  </span>

                  {/* Remove Button */}
                  {showRemoveButton ? (
                    <button
                      onClick={() => handleRemoveMember(member.userId, `${member.user.firstName} ${member.user.lastName}`)}
                      className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-950/20 rounded-lg transition-all"
                      title="Remove Member"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  ) : (
                    <div className="w-8 h-8" /> // placeholder
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Add Member Modal */}
      <Modal
        open={addModalOpen}
        onClose={() => {
          setAddModalOpen(false);
          setAddError(null);
          setAddSuccess(null);
        }}
        title="Add New Member"
        size="sm"
      >
        <form onSubmit={handleAddSubmit} className="space-y-5">
          <Input
            label="Email Address"
            type="email"
            placeholder="e.g. employee@company.com"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
            required
            className="bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all"
            disabled={addMutation.isPending || !!addSuccess}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-zinc-300">Role</label>
            <select
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value as any)}
              className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-sm bg-zinc-900 text-zinc-150 focus:border-white focus:ring-1 focus:ring-white focus:outline-none transition-all"
              disabled={addMutation.isPending || !!addSuccess}
            >
              <option value="admin">Admin (Full access except Org Deletion)</option>
              <option value="manager">Manager (Project and board management)</option>
              <option value="developer">Developer (Task execution and assignment)</option>
              <option value="viewer">Viewer (Read-only access)</option>
            </select>
          </div>

          {addError && <p className="text-xs text-red-400 font-semibold">{addError}</p>}
          {addSuccess && (
            <p className="text-xs text-emerald-450 font-semibold flex items-center gap-1">
              Successfully added member!
            </p>
          )}

          <div className="flex justify-end gap-3 pt-3 border-t border-zinc-900">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setAddModalOpen(false)}
              className="text-zinc-400 hover:text-white hover:bg-zinc-900/60"
              disabled={addMutation.isPending || !!addSuccess}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-white hover:bg-zinc-200 text-black font-bold shadow-md hover:shadow-lg transition-all border-none"
              loading={addMutation.isPending}
              disabled={!!addSuccess}
            >
              Add Member
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
