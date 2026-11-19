import type { Request, Response } from 'express';
import type { LoginInput, RegisterInput, Role } from '@skillora/shared';
import { env } from '../config/env';
import {
  AuthToken,
  InstructorProfile,
  RefreshToken,
  User,
  createNotification,
} from '../models/identity';
import { errors } from '../lib/errors';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/tokens';
import type { PublicUser } from '@skillora/shared';

const REFRESH_COOKIE = 'skillora_refresh';

export function toPublicUser(doc: {
  _id?: unknown;
  id?: unknown;
  name: string;
  email: string;
  role: Role;
  avatarUrl?: string | null;
  headline?: string | null;
  isVerified: boolean;
  isActive: boolean;
  createdAt: Date;
}): PublicUser {
  const rawId = doc._id ?? doc.id;
  if (rawId === undefined || rawId === null) {
    // Never emit a literal "undefined" id — this is a programming error upstream.
    throw errors.internal('toPublicUser: document is missing an id');
  }
  return {
    id: String(rawId),
    name: doc.name,
    email: doc.email,
    role: doc.role,
    avatarUrl: doc.avatarUrl ?? null,
    headline: doc.headline ?? null,
    isVerified: doc.isVerified,
    isActive: doc.isActive,
    createdAt: new Date(doc.createdAt).toISOString(),
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: env.API_BASE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: env.API_BASE_PATH,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

export function issueSession(
  user: { _id: unknown; name: string; email: string; role: Role },
  res: Response,
  meta?: { userAgent?: string; ip?: string },
): { accessToken: string; expiresInSeconds: number } {
  const accessToken = signAccessToken({
    sub: String(user._id),
    role: user.role,
    email: user.email,
    name: user.name,
  });

  const { token: refreshToken, jti } = signRefreshToken({ sub: String(user._id) });
  setRefreshCookie(res, refreshToken);

  // Persist the session record so refresh can be revoked/rotated server-side.
  void RefreshToken.create({
    user: user._id,
    jti,
    tokenHash: sha256(refreshToken),
    userAgent: meta?.userAgent?.slice(0, 300) ?? null,
    ip: meta?.ip ?? null,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  }).catch(() => undefined);

  return { accessToken, expiresInSeconds: env.ACCESS_TOKEN_TTL_SECONDS };
}

/* ------------------------------------------------------------------ */

export async function register(input: RegisterInput, res: Response) {
  const existing = await User.exists({ email: input.email });
  if (existing) throw errors.conflict('An account with this email already exists');

  const passwordHash = await hashPassword(input.password);
  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    role: input.role,
    headline: input.headline ?? null,
    isVerified: false,
  });

  if (input.role === 'instructor') {
    await InstructorProfile.create({
      user: user._id,
      displayName: input.name,
      headline: input.headline ?? null,
      approved: false,
    });
  }

  // Email verification token (delivery depends on EMAIL_PROVIDER; 'log' prints it)
  const raw = randomToken(32);
  await AuthToken.create({
    user: user._id,
    kind: 'verify_email',
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  });
  await createNotification({
    user: String(user._id),
    type: 'announcement',
    title: 'Welcome to Skillora',
    body: `Hi ${input.name}, your ${input.role} account is ready. Explore the catalog to find your next course.`,
    link: '/courses',
  });

  const session = issueSession(user, res);
  return { user: toPublicUser(user), ...session, verifyToken: raw };
}

export async function login(
  input: LoginInput,
  res: Response,
  meta: { userAgent?: string; ip?: string },
) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  if (!user) throw errors.unauthorized('Invalid email or password');
  if (!user.isActive) throw errors.forbidden('This account has been deactivated');

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) throw errors.unauthorized('Invalid email or password');

  user.lastLoginAt = new Date();
  await user.save();

  const session = issueSession(user, res, meta);
  return { user: toPublicUser(user), ...session };
}

/** Refresh with rotation: the presented token's jti is revoked and replaced. */
export async function refresh(rawToken: string | undefined, res: Response) {
  if (!rawToken) throw errors.unauthorized('Missing refresh token');
  const payload = verifyRefreshToken(rawToken);

  const record = await RefreshToken.findOne({ jti: payload.jti }).select('+tokenHash');
  if (!record || record.revokedAt) throw errors.unauthorized('Refresh token has been revoked');
  if (record.tokenHash !== sha256(rawToken)) throw errors.unauthorized('Refresh token mismatch');
  if (record.expiresAt.getTime() < Date.now()) throw errors.unauthorized('Refresh token expired');

  const user = await User.findById(payload.sub);
  if (!user) throw errors.unauthorized('Account no longer exists');
  if (!user.isActive) throw errors.forbidden('This account has been deactivated');

  record.revokedAt = new Date();
  await record.save();

  const session = issueSession(user, res);
  return { user: toPublicUser(user), ...session };
}

export async function logout(rawToken: string | undefined, res: Response): Promise<void> {
  if (rawToken) {
    try {
      const payload = verifyRefreshToken(rawToken);
      await RefreshToken.updateOne(
        { jti: payload.jti, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
    } catch {
      /* already invalid — nothing to revoke */
    }
  }
  clearRefreshCookie(res);
}

export async function logoutAll(userId: string, res: Response): Promise<number> {
  const result = await RefreshToken.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  clearRefreshCookie(res);
  return result.modifiedCount ?? 0;
}

export async function requestPasswordReset(email: string): Promise<string | null> {
  const user = await User.findOne({ email });
  if (!user) return null; // do not reveal whether the account exists
  const raw = randomToken(32);
  await AuthToken.deleteMany({ user: user._id, kind: 'reset_password', usedAt: null });
  await AuthToken.create({
    user: user._id,
    kind: 'reset_password',
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + 3600_000), // 1 hour, single use
  });
  return raw;
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const record = await AuthToken.findOne({
    tokenHash: sha256(token),
    kind: 'reset_password',
    usedAt: null,
  });
  if (!record) throw errors.validation('This reset link is invalid or has already been used');
  if (record.expiresAt.getTime() < Date.now()) throw errors.validation('This reset link has expired');

  const user = await User.findById(record.user);
  if (!user) throw errors.validation('This reset link is invalid');

  user.passwordHash = await hashPassword(password);
  await user.save();

  record.usedAt = new Date();
  await record.save();

  // A password change invalidates every existing session.
  await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function verifyEmailToken(token: string): Promise<void> {
  const record = await AuthToken.findOne({
    tokenHash: sha256(token),
    kind: 'verify_email',
    usedAt: null,
  });
  if (!record) throw errors.validation('This verification link is invalid or has already been used');
  if (record.expiresAt.getTime() < Date.now()) throw errors.validation('This verification link has expired');

  await User.updateOne({ _id: record.user }, { $set: { isVerified: true } });
  record.usedAt = new Date();
  await record.save();
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw errors.notFound('Account not found');
  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw errors.validation('Current password is incorrect');
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export function readRefreshCookie(req: Request): string | undefined {
  return req.cookies?.[REFRESH_COOKIE] as string | undefined;
}

export { REFRESH_COOKIE };
