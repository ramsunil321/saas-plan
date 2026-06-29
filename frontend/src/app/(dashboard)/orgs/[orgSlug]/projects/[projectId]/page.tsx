'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '@/store/ui.store';
import { workspaceApi } from '@/lib/api/workspace';
import { KanbanBoard } from '@/components/board/kanban-board';
import { Spinner } from '@/components/ui/spinner';

export default function ProjectBoardPage() {
  const { orgSlug, projectId } = useParams<{ orgSlug: string; projectId: string }>();
  const activeOrgId = useUIStore((s) => s.activeOrgId);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', activeOrgId, projectId],
    queryFn: () => workspaceApi.getProject(activeOrgId!, projectId),
    enabled: !!activeOrgId && !!projectId,
  });

  if (isLoading || !activeOrgId) {
    return (
      <div className="flex items-center justify-center h-48">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Board header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/40 backdrop-blur-md flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">{project?.name}</h1>
          {project && (
            <code className="inline-block text-[10px] font-bold tracking-wider text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-0.5 mt-1.5 rounded font-mono uppercase">{project.key}</code>
          )}
        </div>
      </div>

      {/* Kanban board fills remaining height */}
      <div className="flex-1 overflow-hidden">
        <KanbanBoard orgId={activeOrgId} projectId={projectId} />
      </div>
    </div>
  );
}
