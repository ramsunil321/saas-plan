'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/api/auth';
import { getApiErrorMessage } from '@/lib/api/client';

const registerSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  email: z.string().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type RegisterForm = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  // After successful registration, the backend requires email verification before login.
  // We store the registered email so we can show it in the success message.
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (values: RegisterForm) => {
    setServerError(null);
    try {
      // Backend returns { message, userId } — NOT { user, tokens }.
      // Email verification is required before a session can be created.
      await authApi.register({
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password,
      });
      setRegisteredEmail(values.email);
    } catch (err) {
      setServerError(getApiErrorMessage(err));
    }
  };

  // Show success state once registration completes
  if (registeredEmail) {
    return (
      <>
        <div className="rounded-xl bg-green-950/20 border border-green-900/50 px-4 py-4 text-sm text-green-400 mb-4 leading-relaxed">
          <p className="font-semibold mb-1 text-white">Check your email</p>
          <p className="text-zinc-300">
            We sent a verification link to <strong className="text-white">{registeredEmail}</strong>.
            Click the link to activate your account, then sign in.
          </p>
        </div>
        <Button
          className="w-full bg-white hover:bg-zinc-200 text-black font-bold py-2.5 px-4 shadow-[0_4px_20px_rgba(255,255,255,0.08)] transition-all duration-200 border-none rounded-xl"
          onClick={() => router.replace('/login')}
        >
          Go to sign in
        </Button>
        <p className="mt-4 text-center text-sm text-zinc-400">
          Didn&apos;t receive the email? Check your spam folder or{' '}
          <button
            className="font-semibold text-white hover:underline"
            onClick={() => setRegisteredEmail(null)}
          >
            try again
          </button>
          .
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="text-xl font-bold text-white mb-6 tracking-tight">Create your account</h2>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First name"
            autoComplete="given-name"
            placeholder="Jane"
            error={errors.firstName?.message}
            className="bg-zinc-950/40 border-zinc-800/80 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all duration-150"
            {...register('firstName')}
          />
          <Input
            label="Last name"
            autoComplete="family-name"
            placeholder="Smith"
            error={errors.lastName?.message}
            className="bg-zinc-950/40 border-zinc-800/80 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all duration-150"
            {...register('lastName')}
          />
        </div>

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
          autoComplete="new-password"
          placeholder="Min. 8 chars, uppercase, number"
          error={errors.password?.message}
          className="bg-zinc-950/40 border-zinc-800/80 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all duration-150"
          {...register('password')}
        />

        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          error={errors.confirmPassword?.message}
          className="bg-zinc-950/40 border-zinc-800/80 text-white placeholder-zinc-500 focus:border-white focus:ring-white transition-all duration-150"
          {...register('confirmPassword')}
        />

        {serverError && (
          <div className="rounded-xl bg-red-950/30 border border-red-900/50 px-3.5 py-2.5 text-xs text-red-400 font-semibold leading-relaxed">
            {serverError}
          </div>
        )}

        <Button type="submit" className="w-full bg-white hover:bg-zinc-200 text-black font-bold py-2.5 px-4 shadow-[0_4px_20px_rgba(255,255,255,0.08)] hover:shadow-[0_4px_30px_rgba(255,255,255,0.2)] transition-all duration-200 border-none rounded-xl" loading={isSubmitting}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-400">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-white hover:underline transition-colors">
          Sign in
        </Link>
      </p>
    </>
  );
}
