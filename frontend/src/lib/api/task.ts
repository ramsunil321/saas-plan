// Task service API functions
import { taskClient } from './client';
import type { Task, Comment, TaskPriority } from '../types';

export interface CreateTaskPayload {
  title: string;
  boardId: string;
  priority?: TaskPriority;
  description?: string;
  dueDate?: string;
  estimatedHours?: number;
  assigneeIds?: string[];
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  estimatedHours?: number | null;
}

export interface MoveTaskPayload {
  targetBoardId: string;
  position?: number;
}

export interface ListTasksParams {
  boardId?: string;
  status?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const taskApi = {
  // --- Tasks ---
  // Backend wraps responses: { tasks: [...] }, { task: {...} }, { comment: {...} }
  // Extract data.data.<key> to get the actual value

  listTasks: async (
    orgId: string,
    projectId: string,
    params?: ListTasksParams,
  ): Promise<{ data: Task[]; meta: { total: number; page: number; limit: number; totalPages: number } }> => {
    const { data } = await taskClient.get(`/organizations/${orgId}/projects/${projectId}/tasks`, {
      params,
    });
    return { data: data.data.tasks, meta: data.meta };
  },

  createTask: async (
    orgId: string,
    projectId: string,
    payload: CreateTaskPayload,
  ): Promise<Task> => {
    const { data } = await taskClient.post(
      `/organizations/${orgId}/projects/${projectId}/tasks`,
      payload,
    );
    return data.data.task;
  },

  getTask: async (orgId: string, projectId: string, taskId: string): Promise<Task> => {
    const { data } = await taskClient.get(
      `/organizations/${orgId}/projects/${projectId}/tasks/${taskId}`,
    );
    return data.data.task;
  },

  updateTask: async (
    orgId: string,
    projectId: string,
    taskId: string,
    payload: UpdateTaskPayload,
  ): Promise<Task> => {
    const { data } = await taskClient.patch(
      `/organizations/${orgId}/projects/${projectId}/tasks/${taskId}`,
      payload,
    );
    return data.data.task;
  },

  moveTask: async (
    orgId: string,
    projectId: string,
    taskId: string,
    payload: MoveTaskPayload,
  ): Promise<Task> => {
    const { data } = await taskClient.post(
      `/organizations/${orgId}/projects/${projectId}/tasks/${taskId}/move`,
      payload,
    );
    return data.data.task;
  },

  deleteTask: async (orgId: string, projectId: string, taskId: string): Promise<void> => {
    await taskClient.delete(`/organizations/${orgId}/projects/${projectId}/tasks/${taskId}`);
  },

  // --- Comments ---
  listComments: async (orgId: string, projectId: string, taskId: string): Promise<Comment[]> => {
    const { data } = await taskClient.get(
      `/organizations/${orgId}/projects/${projectId}/tasks/${taskId}/comments`,
    );
    return data.data.comments;
  },

  createComment: async (
    orgId: string,
    projectId: string,
    taskId: string,
    content: string,
    parentId?: string,
  ): Promise<Comment> => {
    const { data } = await taskClient.post(
      `/organizations/${orgId}/projects/${projectId}/tasks/${taskId}/comments`,
      { content, parentId },
    );
    return data.data.comment;
  },
};
