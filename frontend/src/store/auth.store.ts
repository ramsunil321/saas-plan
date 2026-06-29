// =============================================================================
// AUTH STORE — Zustand global state for authentication
// =============================================================================
//
// WHY ZUSTAND INSTEAD OF CONTEXT + USESTATE?
//   Context re-renders every consumer on every state change — bad for deeply
//   nested trees. Zustand uses a pub/sub model: only components that subscribe
//   to a specific slice re-render when that slice changes.
//   Zustand is also much simpler than Redux — no reducers, no actions, no
//   dispatchers. Just a store with state and mutator functions.
//
// TOKEN STORAGE STRATEGY:
//   Access token: Zustand memory (cleared on page refresh → auto-restored from localStorage)
//   Refresh token: localStorage (persists across refreshes)
//
//   PRODUCTION NOTE:
//     Use httpOnly cookies for the refresh token. The access token can stay
//     in memory (short TTL makes it less risky if stolen). Alternatively,
//     use NextAuth.js which handles all of this securely out of the box.
//
// INTERVIEW QUESTION: "Where should you store JWT tokens in a browser?"
//   Answer: Access token → memory (fastest, safest from XSS, lost on refresh).
//   Refresh token → httpOnly cookie (server sets it, JS can't read it, XSS safe).
//   Never store sensitive tokens in localStorage — it's accessible via XSS.
//   The tradeoff: httpOnly cookies are vulnerable to CSRF — mitigate with
//   SameSite=Strict and CSRF tokens.
// =============================================================================

import { create } from 'zustand';
import type { User } from '../lib/types';
import { storage } from '../lib/utils';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '../lib/api/client';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  setUser: (user: User) => void;
  setLoading: (loading: boolean) => void;
  // Restore token from localStorage on app mount (handles page refresh)
  initFromStorage: () => string | null;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: true,  // true initially — we need to check localStorage before rendering

  setAuth: (user, accessToken, refreshToken) => {
    // Persist tokens so they survive page refresh
    storage.set(TOKEN_KEY, accessToken);
    storage.set(REFRESH_TOKEN_KEY, refreshToken);
    set({ user, accessToken, refreshToken, isAuthenticated: true, isLoading: false });
  },

  clearAuth: () => {
    storage.remove(TOKEN_KEY);
    storage.remove(REFRESH_TOKEN_KEY);
    set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false, isLoading: false });
  },

  setUser: (user) => set({ user }),

  setLoading: (isLoading) => set({ isLoading }),

  // Called on app mount to restore state from localStorage
  // Returns the access token if found (so the caller can fetch /me to get the User object)
  initFromStorage: () => {
    const accessToken = storage.get(TOKEN_KEY);
    const refreshToken = storage.get(REFRESH_TOKEN_KEY);
    if (accessToken && refreshToken) {
      set({ accessToken, refreshToken, isAuthenticated: true });
      return accessToken;
    }
    set({ isLoading: false });
    return null;
  },
}));
