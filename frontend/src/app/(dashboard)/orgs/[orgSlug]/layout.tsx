'use client';

// Sets the active org in the UI store so the sidebar and header know which org is active
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { workspaceApi } from '@/lib/api/workspace';
import { useUIStore } from '@/store/ui.store';
import { Spinner } from '@/components/ui/spinner';

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const setActiveOrg = useUIStore((s) => s.setActiveOrg);

  const { data: org, isLoading } = useQuery({
    queryKey: ['organizations', 'by-slug', orgSlug],
    queryFn: () => workspaceApi.listOrgs().then((orgs) => orgs.find((o) => o.slug === orgSlug)),
    enabled: !!orgSlug,
  });

  useEffect(() => {
    if (org) setActiveOrg(org.id, org.slug);
  }, [org, setActiveOrg]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Spinner size="lg" />
      </div>
    );
  }

  return <>{children}</>;
}
