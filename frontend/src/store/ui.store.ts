// UI state store — sidebar state, active org/project, modals
import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  activeOrgId: string | null;
  activeOrgSlug: string | null;
  activeProjectId: string | null;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setActiveOrg: (orgId: string, orgSlug: string) => void;
  setActiveProject: (projectId: string | null) => void;
}

export const useUIStore = create<UIState>((set: any) => ({
  sidebarOpen: true,
  activeOrgId: null,
  activeOrgSlug: null,
  activeProjectId: null,

  setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state: any) => ({ sidebarOpen: !state.sidebarOpen })),
  setActiveOrg: (orgId: string, orgSlug: string) => set({ activeOrgId: orgId, activeOrgSlug: orgSlug }),
  setActiveProject: (projectId: string | null) => set({ activeProjectId: projectId }),
}));
