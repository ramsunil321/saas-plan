// =============================================================================
// EMAIL VERIFICATION PAGE — /auth/verify-email?token=xxx
// =============================================================================
//
// WHY THIS IS IN app/auth/ NOT app/(auth)/:
//   The `(auth)` folder is a Next.js ROUTE GROUP — the parentheses mean it
//   does NOT add to the URL. So (auth)/login → /login, not /auth/login.
//   The auth service emails link to /auth/verify-email (a real path), so this
//   page must live in a real `auth/` directory, not the route group.
//
// INTERVIEW QUESTION: "What is a Next.js route group?"
//   Answer: A folder with parentheses (e.g. (auth)) that groups routes for
//   shared layouts without affecting the URL structure. (auth)/login → /login.
//   Use route groups to share layouts (e.g. a sidebar) across a subset of pages
//   without that layout appearing in the URL path.
//
// VERIFICATION FLOW:
//   1. User registers → auth service sends email to FRONTEND_URL/auth/verify-email?token=xxx
//   2. User clicks link → lands here
//   3. useEffect fires → calls GET /auth/verify-email?token=xxx on the backend
//   4. Backend marks emailVerified=true, returns 200
//   5. We show success + auto-redirect to /login after 5 seconds
// =============================================================================

'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api/auth';
import { getApiErrorMessage } from '@/lib/api/client';

type VerifyState = 'loading' | 'success' | 'error' | 'missing-token';

// Inner component uses useSearchParams — must be inside <Suspense>
function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [state, setState] = useState<VerifyState>(token ? 'loading' : 'missing-token');
  const [errorMessage, setErrorMessage] = useState('');
  const [countdown, setCountdown] = useState(5);

  const verifyEmail = useCallback(async () => {
    if (!token) return;
    try {
      await authApi.verifyEmail(token);
      setState('success');
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err));
      setState('error');
    }
  }, [token]);

  useEffect(() => {
    verifyEmail();
  }, [verifyEmail]);

  // Auto-redirect countdown after success
  useEffect(() => {
    if (state !== 'success') return;
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          router.push('/login');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [state, router]);

  if (state === 'loading') {
    return (
      <div className="text-center py-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-50 rounded-full mb-4">
          <svg className="w-8 h-8 text-brand-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Verifying your email...</h2>
        <p className="text-sm text-gray-500">This only takes a moment.</p>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="text-center py-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Email verified!</h2>
        <p className="text-sm text-gray-500 mb-6">
          Your account is now active. Redirecting to sign in in{' '}
          <span className="font-semibold text-brand-600">{countdown}</span> seconds...
        </p>
        <Link
          href="/login"
          className="inline-flex justify-center w-full px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-colors"
        >
          Sign in now
        </Link>
      </div>
    );
  }

  if (state === 'missing-token') {
    return (
      <div className="text-center py-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-100 rounded-full mb-4">
          <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid verification link</h2>
        <p className="text-sm text-gray-500 mb-6">
          This link is missing a token. Please use the link from your verification email.
        </p>
        <Link href="/login" className="inline-flex justify-center w-full px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-colors">
          Back to sign in
        </Link>
      </div>
    );
  }

  // Error state
  return (
    <div className="text-center py-4">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
        <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Verification failed</h2>
      <p className="text-sm text-gray-500 mb-2">
        {errorMessage || 'The verification link is invalid or has expired.'}
      </p>
      <p className="text-xs text-gray-400 mb-6">
        Verification links expire after 24 hours. Register again to get a new link.
      </p>
      <div className="space-y-3">
        <Link href="/login" className="inline-flex justify-center w-full px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-colors">
          Back to sign in
        </Link>
        <Link href="/register" className="inline-flex justify-center w-full px-4 py-2.5 text-sm font-semibold text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">
          Create a new account
        </Link>
      </div>
    </div>
  );
}

// Outer page wraps with Suspense — required by Next.js 15 for useSearchParams
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="text-center py-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-50 rounded-full mb-4">
          <svg className="w-8 h-8 text-brand-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
