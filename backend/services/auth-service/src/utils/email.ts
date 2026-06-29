// =============================================================================
// EMAIL SERVICE — Nodemailer with SMTP transport
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Auth flows require sending emails:
//   1. Email verification (after registration)
//   2. Password reset (forgot password flow)
//   3. Welcome email (after verification)
//
// HOW IT WORKS:
//   Nodemailer connects to an SMTP server and sends emails.
//   In development: we use Ethereal (fake SMTP) — emails are captured online
//   In production: connect to real SMTP (Gmail, SendGrid, AWS SES, etc.)
//
// ARCHITECTURE NOTE:
//   In a full microservices setup, the Auth Service would publish an event to
//   RabbitMQ and the Notification Service would handle email sending.
//   We handle it directly in Auth Service here for simplicity, since these
//   emails are tightly coupled to auth flows and have no other consumers.
//
// INTERVIEW QUESTION:
//   "How would you scale email sending?"
//   Answer: Move to an async queue. Instead of sending emails synchronously
//   (which adds latency to the HTTP response and fails if the SMTP server is down),
//   publish a message to RabbitMQ/SQS and have a worker process send emails.
//   This decouples email sending from the HTTP request lifecycle and enables
//   retries, dead-letter queues, and rate limiting per provider.
// =============================================================================

import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

// Singleton transporter — reuse the SMTP connection
let transporter: Transporter | null = null;

const getTransporter = async (): Promise<Transporter> => {
  if (transporter) return transporter;

  if (env.NODE_ENV === 'test') {
    // In tests, use a silent transport that doesn't actually send emails
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  if (env.NODE_ENV === 'development' && !env.SMTP_USER) {
    // Create Ethereal test account — great for development without real SMTP
    // Visit https://ethereal.email to view sent emails
    const testAccount = await nodemailer.createTestAccount();
    logger.info(`[Email] Ethereal test account: ${testAccount.user}`);
    logger.info(`[Email] Preview emails at: https://ethereal.email`);

    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
  } else {
    // Production SMTP configuration
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Port 465 = SSL, port 587 = STARTTLS (preferred)
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  // Verify connection on startup
  try {
    await transporter.verify();
    logger.info('[Email] SMTP connection verified');
  } catch (error) {
    logger.warn('[Email] SMTP verification failed — emails may not send', { error });
  }

  return transporter;
};

// =============================================================================
// EMAIL TEMPLATES
// =============================================================================
// Simple HTML templates — in production, use a proper templating system
// like MJML, React Email, or Handlebars with pre-compiled templates.
// =============================================================================

const baseTemplate = (content: string): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FlowForge</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 40px 20px; }
    .container { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .logo { font-size: 24px; font-weight: 700; color: #4f46e5; margin-bottom: 24px; }
    .btn { display: inline-block; background: #4f46e5; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin: 24px 0; }
    .footer { margin-top: 24px; font-size: 13px; color: #6b7280; }
    p { color: #374151; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">⚡ FlowForge</div>
    ${content}
    <div class="footer">
      <p>© ${new Date().getFullYear()} FlowForge. If you didn't request this, you can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>
`;

// =============================================================================
// EMAIL SENDING FUNCTIONS
// =============================================================================

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

const sendEmail = async (options: EmailOptions): Promise<void> => {
  const transport = await getTransporter();

  try {
    const info = await transport.sendMail({
      from: `"FlowForge" <${env.EMAIL_FROM}>`,
      ...options,
    });

    logger.info('[Email] Sent successfully', {
      to: options.to,
      subject: options.subject,
      messageId: info.messageId,
    });

    // In development with Ethereal, log the preview URL
    if (env.NODE_ENV === 'development') {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        logger.info(`[Email] Preview URL: ${previewUrl}`);
      }
    }
  } catch (error) {
    // Log but don't throw — email failures shouldn't crash the auth flow
    // In production, this would trigger an alert/retry via the message queue
    logger.error('[Email] Failed to send', { to: options.to, error });
  }
};

// Send email verification link after registration
export const sendVerificationEmail = async (
  email: string,
  firstName: string,
  verificationToken: string,
): Promise<void> => {
  const verificationUrl = `${env.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`;

  await sendEmail({
    to: email,
    subject: 'Verify your FlowForge account',
    html: baseTemplate(`
      <p>Hi ${firstName},</p>
      <p>Welcome to FlowForge! Please verify your email address to get started.</p>
      <a href="${verificationUrl}" class="btn">Verify Email Address</a>
      <p>This link expires in <strong>24 hours</strong>.</p>
      <p>Or copy this URL: <br><small>${verificationUrl}</small></p>
    `),
  });
};

// Send password reset link
export const sendPasswordResetEmail = async (
  email: string,
  firstName: string,
  resetToken: string,
): Promise<void> => {
  const resetUrl = `${env.FRONTEND_URL}/auth/reset-password?token=${resetToken}`;

  await sendEmail({
    to: email,
    subject: 'Reset your FlowForge password',
    html: baseTemplate(`
      <p>Hi ${firstName},</p>
      <p>We received a request to reset your password. Click the button below to create a new one.</p>
      <a href="${resetUrl}" class="btn">Reset Password</a>
      <p>This link expires in <strong>1 hour</strong>. If you didn't request this, please ignore this email.</p>
      <p>Or copy this URL: <br><small>${resetUrl}</small></p>
    `),
  });
};

// Send welcome email after successful verification
export const sendWelcomeEmail = async (
  email: string,
  firstName: string,
): Promise<void> => {
  await sendEmail({
    to: email,
    subject: 'Welcome to FlowForge!',
    html: baseTemplate(`
      <p>Hi ${firstName},</p>
      <p>Your email has been verified! You're all set to start using FlowForge.</p>
      <a href="${env.FRONTEND_URL}/dashboard" class="btn">Go to Dashboard</a>
      <p>FlowForge helps your team stay organized, move faster, and build better products together.</p>
    `),
  });
};
