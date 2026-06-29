// Notification service API functions
import { notificationClient } from './client';
import type { Notification } from '../types';

export interface ListNotificationsParams {
  orgId: string;
  page?: number;
  limit?: number;
  isRead?: boolean;
}

export const notificationApi = {
  list: async (
    params: ListNotificationsParams,
  ): Promise<{ data: Notification[]; meta: { total: number; page: number; limit: number; totalPages: number } }> => {
    const { data } = await notificationClient.get('/notifications', { params });
    return { data: data.data, meta: data.meta };
  },

  getUnreadCount: async (orgId: string): Promise<number> => {
    const { data } = await notificationClient.get('/notifications/unread-count', {
      params: { orgId },
    });
    return data.data.count;
  },

  markAsRead: async (id: string, orgId: string): Promise<Notification> => {
    const { data } = await notificationClient.put(
      `/notifications/${id}/read`,
      {},
      { params: { orgId } },
    );
    return data.data;
  },

  markAllAsRead: async (orgId: string): Promise<number> => {
    const { data } = await notificationClient.put(
      '/notifications/read-all',
      {},
      { params: { orgId } },
    );
    return data.data.count;
  },

  delete: async (id: string): Promise<void> => {
    await notificationClient.delete(`/notifications/${id}`);
  },

  deleteAll: async (orgId: string): Promise<void> => {
    await notificationClient.delete('/notifications', { params: { orgId } });
  },
};
