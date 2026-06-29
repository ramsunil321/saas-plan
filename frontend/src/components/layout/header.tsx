'use client';

import { Menu, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api/auth';
import { storage } from '@/lib/utils';
import { REFRESH_TOKEN_KEY } from '@/lib/api/client';
import { NotificationBell } from '../notifications/notification-bell';
import { Button } from '../ui/button';

interface HeaderProps {
  title?: string;
}

export function Header({ title }: HeaderProps) {
  const router = useRouter();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const { user, clearAuth, refreshToken } = useAuthStore();
  const activeOrgId = useUIStore((s) => s.activeOrgId);

  const handleLogout = async () => {
    try {
      const rt = refreshToken ?? storage.get(REFRESH_TOKEN_KEY);
      if (rt) await authApi.logout(rt);
    } catch { /* ignore logout errors */ }
    clearAuth();
    router.replace('/login');
  };

  return (
    <header className="h-14 border-b border-zinc-900 bg-zinc-950/40 backdrop-blur-md flex items-center justify-between px-6 flex-shrink-0">
      {/* Left: hamburger + page title */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900/60 transition-colors lg:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        {title && <h1 className="text-sm font-semibold text-zinc-200 tracking-tight">{title}</h1>}
      </div>

      {/* Right: notification bell + logout */}
      <div className="flex items-center gap-2">
        {activeOrgId && <NotificationBell orgId={activeOrgId} />}

        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-zinc-400 hover:text-white hover:bg-zinc-900/60 gap-1.5 rounded-lg px-3"
          title={`Sign out ${user?.email ?? ''}`}
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
