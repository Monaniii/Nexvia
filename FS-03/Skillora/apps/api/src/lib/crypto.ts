import crypto from 'node:crypto';
import { env } from '../config/env';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison for tokens (webhooks, verification ids). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Deterministic HMAC used for certificate verification ids so that the same
 * certificate number always maps to the same verification id.
 */
export function hmacId(input: string): string {
  return crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(input).digest('hex').slice(0, 32);
}

export function randomCertificateNumber(): string {
  // SK-YYYY-XXXXXX-XXXXXX (readable, printable, unique via index)
  const year = new Date().getUTCFullYear();
  const body = crypto.randomBytes(6).toString('hex').toUpperCase();
  const check = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SK-${year}-${body}-${check}`.toUpperCase();
}

export async function hashPassword(password: string): Promise<string> {
  // bcrypt with a cost factor of 12 (see README "Password storage")
  const bcrypt = await import('bcrypt');
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const bcrypt = await import('bcrypt');
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}