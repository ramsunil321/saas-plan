'use client';

// Org overview — redirect to projects for now (acts as a landing page)
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function OrgPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/orgs/${orgSlug}/projects`);
  }, [orgSlug, router]);

  return null;
}
