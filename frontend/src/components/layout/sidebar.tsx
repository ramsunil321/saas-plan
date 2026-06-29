'use client';

// =============================================================================
// SIDEBAR — Navigation for the dashboard layout
// =============================================================================
// Shows org-scoped navigation: dashboard, projects, members, settings.
// Collapsible on mobile via useUIStore.sidebarOpen.
// =============================================================================

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, FolderKanban, Users, Settings,
  ChevronRight, Plus, X,
} from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { useUIStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { workspaceApi } from '@/lib/api/workspace';
import { Spinner } from '../ui/spinner';

export function Sidebar() {
  const pathname = usePathname();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const activeOrgSlug = useUIStore((s) => s.activeOrgSlug);
  const user = useAuthStore((s) => s.user);

  // Fetch all orgs for the org switcher at the top
  const { data: orgs, isLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: workspaceApi.listOrgs,
  });

  const navItems = activeOrgSlug
    ? [
        { href: `/orgs/${activeOrgSlug}`, label: 'Dashboard', icon: LayoutDashboard },
        { href: `/orgs/${activeOrgSlug}/projects`, label: 'Projects', icon: FolderKanban },
        { href: `/orgs/${activeOrgSlug}/members`, label: 'Members', icon: Users },
        { href: `/orgs/${activeOrgSlug}/settings`, label: 'Settings', icon: Settings },
      ]
    : [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }];

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed top-0 left-0 z-30 h-full w-64 bg-slate-950 text-slate-100 flex flex-col border-r border-slate-900/80 transition-transform duration-200',
          'lg:relative lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-900">
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 bg-gradient-to-tr from-indigo-500 to-blue-500 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-all">
              <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
                <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm14 2a4 4 0 110 8 4 4 0 010-8z" />
              </svg>
            </div>
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent group-hover:to-white transition-all">FlowForge</span>
          </Link>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Org selector */}
        <div className="px-3 py-3.5 border-b border-slate-900">
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-2">
              <Spinner size="sm" className="text-slate-500" />
              <span className="text-xs text-slate-500">Loading workspaces…</span>
            </div>
          ) : orgs && orgs.length > 0 ? (
            <div className="space-y-1">
              {orgs.map((org) => (
                <Link
                  key={org.id}
                  href={`/orgs/${org.slug}`}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all border border-transparent',
                    activeOrgSlug === org.slug
                      ? 'bg-slate-900/60 border-slate-800 text-white shadow-inner font-medium'
                      : 'text-slate-400 hover:bg-slate-900/40 hover:text-slate-100',
                  )}
                >
                  <div className="w-6 h-6 bg-gradient-to-br from-indigo-600 to-blue-600 rounded-md text-[11px] font-bold text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                    {org.name[0].toUpperCase()}
                  </div>
                  <span className="truncate">{org.name}</span>
                  {activeOrgSlug === org.slug && <ChevronRight className="h-3.5 w-3.5 ml-auto flex-shrink-0 text-slate-500" />}
                </Link>
              ))}
            </div>
          ) : null}

          <Link
            href="/dashboard"
            className="mt-2.5 flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-900/30 transition-all font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            New organization
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border',
                  isActive
                    ? 'bg-indigo-600/10 border-indigo-500/20 text-indigo-400 shadow-sm'
                    : 'bg-transparent border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-100',
                )}
              >
                <Icon className={cn("h-4.5 w-4.5 flex-shrink-0", isActive ? "text-indigo-400" : "text-slate-400")} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        {user && (
          <div className="px-3 py-3 border-t border-slate-900 bg-slate-950/60">
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-900/40 border border-transparent hover:border-slate-900/50 transition-all">
              <div className="w-8 h-8 bg-gradient-to-tr from-indigo-500 to-blue-500 rounded-full flex items-center justify-center text-xs font-extrabold flex-shrink-0 text-white shadow-sm">
                {getInitials(user.firstName, user.lastName)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate leading-tight">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-[10px] text-slate-500 truncate mt-0.5">{user.email}</p>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
