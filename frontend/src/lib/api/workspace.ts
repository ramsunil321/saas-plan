// Workspace service API functions
import { workspaceClient } from './client';
import type { Organization, Project, Board, OrganizationMember } from '../types';

export const workspaceApi = {
  // --- Organizations ---
  // Backend wraps all responses in named keys: { organizations: [...] }, { organization: {...} }
  // so we extract data.data.<key> instead of just data.data

  listOrgs: async (): Promise<Organization[]> => {
    const { data } = await workspaceClient.get('/organizations');
    return data.data.organizations;
  },

  createOrg: async (payload: { name: string; slug: string; description?: string }): Promise<Organization> => {
    const { data } = await workspaceClient.post('/organizations', payload);
    return data.data.organization;
  },

  getOrg: async (orgId: string): Promise<Organization> => {
    const { data } = await workspaceClient.get(`/organizations/${orgId}`);
    return data.data.organization;
  },

  // --- Members ---
  listMembers: async (orgId: string): Promise<OrganizationMember[]> => {
    const { data } = await workspaceClient.get(`/organizations/${orgId}/members`);
    return data.data.members;
  },

  inviteMember: async (orgId: string, payload: { email: string; role: string }): Promise<void> => {
    await workspaceClient.post(`/organizations/${orgId}/invite`, payload);
  },

  removeMember: async (orgId: string, userId: string): Promise<void> => {
    await workspaceClient.delete(`/organizations/${orgId}/members/${userId}`);
  },

  listInvitations: async (orgId: string): Promise<any[]> => {
    const { data } = await workspaceClient.get(`/organizations/${orgId}/invitations`);
    return data.data.invitations;
  },

  updateOrg: async (orgId: string, payload: { name: string; description?: string }): Promise<Organization> => {
    const { data } = await workspaceClient.put(`/organizations/${orgId}`, payload);
    return data.data.organization;
  },

  deleteOrg: async (orgId: string): Promise<void> => {
    await workspaceClient.delete(`/organizations/${orgId}`);
  },

  // --- Projects ---
  listProjects: async (orgId: string): Promise<Project[]> => {
    const { data } = await workspaceClient.get(`/organizations/${orgId}/projects`);
    return data.data.projects;
  },

  createProject: async (
    orgId: string,
    payload: { name: string; key: string; description?: string },
  ): Promise<Project> => {
    const { data } = await workspaceClient.post(`/organizations/${orgId}/projects`, payload);
    return data.data.project;
  },

  getProject: async (orgId: string, projectId: string): Promise<Project> => {
    const { data } = await workspaceClient.get(`/organizations/${orgId}/projects/${projectId}`);
    return data.data.project;
  },

  // --- Boards ---
  listBoards: async (orgId: string, projectId: string): Promise<Board[]> => {
    const { data } = await workspaceClient.get(
      `/organizations/${orgId}/projects/${projectId}/boards`,
    );
    return data.data.boards;
  },
};
