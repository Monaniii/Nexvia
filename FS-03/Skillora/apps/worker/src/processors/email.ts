import type { Job } from 'bullmq';
import { env, logger } from '../data';

export interface EmailJobData {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Outbound email. The platform ships with EMAIL_PROVIDER=log, which records the
 * message instead of sending it — that keeps local development and automated
 * tests credential-free while preserving the exact same enqueue → worker path a
 * real SMTP provider would use. Swap in SMTP_URL handling here to go live.
 *
 * This worker never handles credentials: the provider decision is made from
 * environment configuration on the server side only.
 */
export async function processEmail(job: Job<EmailJobData>): Promise<void> {
  const { to, subject, text } = job.data;

  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    logger.warn({ jobId: job.id, reason: 'invalid_recipient' }, 'Email dropped: invalid recipient');
    return;
  }

  if (env.EMAIL_PROVIDER === 'none') {
    logger.info({ jobId: job.id, to, subject }, 'Email suppressed (EMAIL_PROVIDER=none)');
    return;
  }

  // EMAIL_PROVIDER=log (default): structured log acts as the dev transport.
  logger.info(
    { jobId: job.id, to, subject, provider: env.EMAIL_PROVIDER, preview: text.slice(0, 200) },
    'Email dispatched (development transport — not actually delivered)',
  );
}
