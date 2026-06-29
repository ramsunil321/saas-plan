// Auth service API functions
import { authClient } from './client';
import type { User, AuthTokens } from '../types';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export const authApi = {
  login: async (payload: LoginPayload): Promise<{ user: User; tokens: AuthTokens }> => {
    const { data } = await authClient.post('/auth/login', payload);
    return data.data;
  },

  // Backend returns { message, userId } — registration requires email verification
  // before a session can be created. Caller should redirect to login with a
  // "check your email" banner rather than trying to setAuth immediately.
  register: async (payload: RegisterPayload): Promise<{ message: string; userId: string }> => {
    const { data } = await authClient.post('/auth/register', payload);
    return data.data;
  },

  logout: async (refreshToken: string): Promise<void> => {
    await authClient.post('/auth/logout', { refreshToken });
  },

  refresh: async (refreshToken: string): Promise<AuthTokens> => {
    const { data } = await authClient.post('/auth/refresh', { refreshToken });
    return data.data;
  },

  me: async (): Promise<User> => {
    const { data } = await authClient.get('/auth/me');
    // Backend wraps: sendSuccess(res, { user }) → response is { success, data: { user } }
    // Must extract data.data.user, NOT just data.data (which is { user: {...} })
    return data.data.user;
  },

  verifyEmail: async (token: string): Promise<void> => {
    await authClient.get('/auth/verify-email', { params: { token } });
  },

  forgotPassword: async (email: string): Promise<void> => {
    await authClient.post('/auth/forgot-password', { email });
  },

  resetPassword: async (token: string, newPassword: string): Promise<void> => {
    await authClient.post('/auth/reset-password', { token, newPassword, confirmPassword: newPassword });
  },
};
