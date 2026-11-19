import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { errors } from '../lib/errors';
import type { ApiErrorBody } from '@skillora/shared';

function handler(_req: Request, res: Response): void {
  const body: ApiErrorBody = {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again shortly' },
  };
  res.status(429).json(body);
}

/** Applies to the whole API surface. */
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

/** Stricter bucket for login, register, password reset. */
export const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  message: errors.rateLimited('Too many authentication attempts, please wait a moment').message,
});

/** Applied to checkout and webhook-adjacent endpoints. */
export const checkoutLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_CHECKOUT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});