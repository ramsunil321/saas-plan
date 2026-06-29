// =============================================================================
// PROVIDERS — Wraps the app with all required context providers
// =============================================================================
//
// Next.js 15 App Router uses React Server Components by default.
// Context providers must be Client Components (they use hooks/browser APIs).
// This file is a Client Component that wraps the entire app tree.
//
// Provider order matters:
//   QueryClientProvider must be outermost for TanStack Query
//   AuthInitializer reads localStorage → must be inside QueryClientProvider
//   (so it can trigger queries after restoring auth state)
//
// REACT QUERY CONFIGURATION:
//   staleTime: 30s — data is considered fresh for 30 seconds after fetching.
//   After 30s, the next mount or focus triggers a background refetch.
//   retry: 1 — retry failed queries once before showing error state.
//   refetchOnWindowFocus: false — avoids unexpected refetches when switching
//   browser tabs (common annoyance in development).
//
// INTERVIEW QUESTION: "What is staleTime in React Query?"
//   Answer: How long fetched data is considered "fresh". While fresh, React Query
//   serves the cached value immediately without a network request. After staleTime
//   passes, the data is still shown from cache but a background refetch is triggered
//   on next component mount or window focus. This gives instant perceived performance
//   while keeping data reasonably up-to-date.
// =============================================================================

'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api/auth';

function AuthInitializer() {
  const { initFromStorage, setUser, clearAuth, setLoading } = useAuthStore();

  useEffect(() => {
    // Restore tokens from localStorage on mount (handles page refresh)
    const token = initFromStorage();
    if (!token) return;

    // Fetch the current user profile to repopulate the user object
    // (Zustand memory is cleared on page refresh — localStorage has tokens but not the User)
    setLoading(true);
    authApi.me()
      .then((user) => setUser(user))
      .catch(() => clearAuth())      // token is expired/invalid → log out
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null; // This is a side-effect-only component — renders nothing
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Create QueryClient once per render tree (not on every render)
  // useState ensures it's stable across re-renders
  const [queryClient] = useState(() =>
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,           // 30 seconds
          retry: 1,
          refetchOnWindowFocus: false,
        },
      },
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer />
      {children}
      {/* DevTools panel — only visible in development */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
