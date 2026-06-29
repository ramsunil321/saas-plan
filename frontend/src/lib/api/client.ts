// =============================================================================
// AXIOS API CLIENT — with automatic JWT refresh
// =============================================================================
//
// WHY AXIOS INSTEAD OF FETCH?
//   Axios has built-in interceptors — middleware for requests and responses.
//   The response interceptor here handles 401 (token expired) automatically:
//   it refreshes the access token and retries the original request.
//   Doing this with plain fetch requires substantially more boilerplate.
//
// TOKEN REFRESH FLOW (interceptor):
//   1. Request goes out with the access token in Authorization header
//   2. Server returns 401 (token expired)
//   3. Interceptor calls refresh endpoint with the stored refresh token
//   4. On success: store new tokens, retry the original request
//   5. On failure: clear tokens, redirect to /login
//
// CONCURRENT REFRESH PROBLEM:
//   If 3 requests all get 401 simultaneously, we must only call /refresh ONCE.
//   We use an `isRefreshing` flag + a queue of waiting resolvers.
//   When refresh completes, all queued requests are retried.
//   This is the standard pattern for concurrent token refresh.
//
// INTERVIEW QUESTION: "How do you handle expired JWTs in an SPA?"
//   Answer: Store the access token in memory (or localStorage). Add an axios
//   interceptor that catches 401 responses, calls the refresh endpoint, stores
//   the new access token, then retries the failed request. The user never sees
//   the failure — it's transparent.
// =============================================================================

import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { storage } from '../utils';

// These env vars are set in .env.local (prefixed with NEXT_PUBLIC_ = safe for browser)
export const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL ?? 'http://localhost:3001/api/v1';
export const WORKSPACE_API_URL = process.env.NEXT_PUBLIC_WORKSPACE_API_URL ?? 'http://localhost:3002/api/v1';
export const TASK_API_URL = process.env.NEXT_PUBLIC_TASK_API_URL ?? 'http://localhost:3003/api/v1';
export const NOTIFICATION_API_URL = process.env.NEXT_PUBLIC_NOTIFICATION_API_URL ?? 'http://localhost:3004/api/v1';

// Local storage keys
export const TOKEN_KEY = 'ff_access_token';
export const REFRESH_TOKEN_KEY = 'ff_refresh_token';

// =============================================================================
// FACTORY — Creates an axios instance for each backend service
// =============================================================================
// Each service gets its own instance with the correct baseURL.
// They all share the same interceptors (token injection + refresh logic).
// =============================================================================
function createApiClient(baseURL: string) {
  const client = axios.create({
    baseURL,
    timeout: 15_000,
    headers: { 'Content-Type': 'application/json' },
  });

  // ---- REQUEST INTERCEPTOR ----
  // Attach the access token to every request
  client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = storage.get(TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // ---- RESPONSE INTERCEPTOR ----
  // Automatically refresh the access token on 401 responses
  let isRefreshing = false;
  let failedQueue: Array<{
    resolve: (token: string) => void;
    reject: (error: unknown) => void;
  }> = [];

  // Drain the queue — either retry with the new token or reject all
  const processQueue = (error: unknown, token: string | null = null): void => {
    failedQueue.forEach((p) => {
      if (token) p.resolve(token);
      else p.reject(error);
    });
    failedQueue = [];
  };

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

      // Only attempt refresh on 401 and only once per request
      // Skip for login/register endpoints which return 401 for business validation failures
      const isAuthPath = originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/register');
      if (error.response?.status === 401 && !originalRequest._retry && !isAuthPath) {
        originalRequest._retry = true;

        if (isRefreshing) {
          // Another request is already refreshing — queue this one
          return new Promise((resolve, reject) => {
            failedQueue.push({
              resolve: (token) => {
                if (originalRequest.headers) {
                  originalRequest.headers.Authorization = `Bearer ${token}`;
                }
                resolve(client(originalRequest));
              },
              reject,
            });
          });
        }

        isRefreshing = true;

        try {
          const refreshToken = storage.get(REFRESH_TOKEN_KEY);
          if (!refreshToken) throw new Error('No refresh token');

          // Call auth-service refresh endpoint
          const { data } = await axios.post(`${AUTH_API_URL}/auth/refresh`, {
            refreshToken,
          });

          const newAccessToken: string = data.data.accessToken;
          const newRefreshToken: string = data.data.refreshToken;

          // Store the new tokens
          storage.set(TOKEN_KEY, newAccessToken);
          storage.set(REFRESH_TOKEN_KEY, newRefreshToken);

          // Update the Authorization header for the retried request
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          }

          processQueue(null, newAccessToken);
          return client(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError, null);

          // Refresh failed — clear tokens and redirect to login
          storage.remove(TOKEN_KEY);
          storage.remove(REFRESH_TOKEN_KEY);
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }

      return Promise.reject(error);
    },
  );

  return client;
}

// One client per backend service
export const authClient = createApiClient(AUTH_API_URL);
export const workspaceClient = createApiClient(WORKSPACE_API_URL);
export const taskClient = createApiClient(TASK_API_URL);
export const notificationClient = createApiClient(NOTIFICATION_API_URL);

// Helper to extract the error message from an Axios error response
export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error?.message ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
}
