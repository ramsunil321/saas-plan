'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api/auth';
import { getApiErrorMessage } from '@/lib/api/client';

// Zod schema mirrors backend validation
const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (values: LoginForm) => {
    setServerError(null);
    try {
      const { user, tokens } = await authApi.login(values);
      setAuth(user, tokens.accessToken, tokens.refreshToken);
      router.replace('/dashboard');
    } catch (err) {
      setServerError(getApiErrorMessage(err));
    }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-white mb-6 tracking-tight">Sign in to your account</h2>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          error={errors.email?.message}
          className="bg-zinc-950/40 border-zinc-800/80 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all duration-150"
          {...register('email')}
        />

        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          error={errors.password?.message}
          className="bg-zinc-950/40 border-zinc-800/80 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all duration-150"
          {...register('password')}
        />

        {serverError && (
          <div className="rounded-xl bg-red-950/30 border border-red-900/50 px-3.5 py-2.5 text-xs text-red-400 font-semibold leading-relaxed">
            {serverError}
          </div>
        )}

        <Button type="submit" className="w-full bg-white hover:bg-zinc-200 text-black font-bold py-2.5 px-4 shadow-[0_4px_20px_rgba(255,255,255,0.08)] hover:shadow-[0_4px_30px_rgba(255,255,255,0.2)] transition-all duration-200 border-none rounded-xl" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-400">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="font-semibold text-white hover:underline transition-colors">
          Create one
        </Link>
      </p>
    </>
  );
}
