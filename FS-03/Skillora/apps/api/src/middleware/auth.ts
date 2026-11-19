import type { RequestHandler } from 'express';
import type { Role } from '@skillora/shared';
import { User } from '../models/identity';
import { errors } from '../lib/errors';
import { verifyAccessToken } from '../lib/tokens';
import { env } from '../config/env';

export interface AuthContext {
  id: string;
  role: Role;
  email: string;
  name: string;
  isVerified: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      userDoc?: import('mongoose').Document & { _id: unknown };
    }
  }
}

function extractToken(req: { headers: Record<string, unknown>; cookies?: Record<string, string> }): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const cookie = req.cookies?.accessToken;
  if (cookie) return cookie;
  return null;
}

/**
 * Resolves the caller from a short-lived access token and re-reads the account
 * from the database, so revoked/disabled accounts and role changes take effect
 * immediately instead of relying on token contents.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractToken(req as never);
    if (!token) throw errors.unauthorized('Authentication required');

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub)
      .select('name email role isVerified isActive')
      .lean();
    if (!user) throw errors.unauthorized('Account no longer exists');
    if (!user.isActive) throw errors.forbidden('This account has been deactivated');

    req.auth = {
      id: String(user._id),
      role: user.role,
      email: user.email,
      name: user.name,
      isVerified: user.isVerified,
    };
    next();
  } catch (err) {
    next(err);
  }
};

/** Optional auth: attaches the caller when a valid token is present, never fails. */
export const maybeAuthenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractToken(req as never);
    if (token) {
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub)
        .select('name email role isVerified isActive')
        .lean();
      if (user?.isActive) {
        req.auth = {
          id: String(user._id),
          role: user.role,
          email: user.email,
          name: user.name,
          isVerified: user.isVerified,
        };
      }
    }
  } catch {
    /* invalid token on an optional route is simply anonymous */
  }
  next();
};

export function authorize(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(errors.unauthorized('Authentication required'));
    if (roles.length > 0 && !roles.includes(req.auth.role)) {
      return next(errors.forbidden(`Requires one of roles: ${roles.join(', ')}`));
    }
    next();
  };
}

/** Blocks unverified accounts from sensitive flows (checkout, publishing). */
export const requireVerified: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(errors.unauthorized());
  if (!req.auth.isVerified) return next(errors.forbidden('Please verify your email address first'));
  next();
};

export function assertNotMaintenance(enabled: boolean): RequestHandler {
  return (_req, _res, next) => {
    if (enabled && env.NODE_ENV === 'production') {
      return next(errors.unavailable('The platform is in maintenance mode'));
    }
    next();
  };
}