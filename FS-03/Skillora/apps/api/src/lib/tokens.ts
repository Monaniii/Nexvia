import jwt from 'jsonwebtoken';
import type { Role } from '@skillora/shared';
import { env } from '../config/env';
import { errors } from './errors';
import { randomToken } from './crypto';

export interface AccessPayload {
  sub: string;
  role: Role;
  email: string;
  name: string;
}

export interface RefreshPayload {
  sub: string;
  jti: string;
}

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'skillora',
    audience: 'skillora-api',
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'skillora',
      audience: 'skillora-api',
    }) as AccessPayload;
  } catch {
    throw errors.unauthorized('Invalid or expired access token');
  }
}

export function signRefreshToken(payload: Omit<RefreshPayload, 'jti'>): { token: string; jti: string } {
  const jti = randomToken(16);
  const token = jwt.sign({ ...payload, jti }, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
    issuer: 'skillora',
    audience: 'skillora-refresh',
  });
  return { token, jti };
}

export function verifyRefreshToken(token: string): RefreshPayload {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: 'skillora',
      audience: 'skillora-refresh',
    }) as RefreshPayload;
  } catch {
    throw errors.unauthorized('Invalid or expired refresh token');
  }
}