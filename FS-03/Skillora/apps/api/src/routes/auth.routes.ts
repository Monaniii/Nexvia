import { Router } from 'express';
import { z } from 'zod';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@skillora/shared';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../lib/asyncHandler';
import { ok, created } from '../lib/http';
import { authLimiter } from '../middleware/rateLimit';
import { authenticate, requireVerified } from '../middleware/auth';
import { errors } from '../lib/errors';
import * as authService from '../services/auth.service';
import { User } from '../models/identity';
import { writeAudit } from '../models/identity';

const router = Router();

/**
 * @openapi
 * /api/v1/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a student or instructor account
 */
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body, res);
    created(res, {
      user: result.user,
      accessToken: result.accessToken,
      expiresInSeconds: result.expiresInSeconds,
    });
  }),
);

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body, res, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    await writeAudit({
      actor: result.user.id,
      actorName: result.user.name,
      actorRole: result.user.role,
      action: 'auth.login',
      entityType: 'user',
      entityId: result.user.id,
      ip: req.ip ?? null,
    });
    ok(res, result);
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const raw = authService.readRefreshCookie(req);
    const result = await authService.refresh(raw, res);
    ok(res, result);
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await authService.logout(authService.readRefreshCookie(req), res);
    ok(res, { loggedOut: true });
  }),
);

router.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    const revoked = await authService.logoutAll(req.auth!.id, res);
    ok(res, { revoked });
  }),
);

router.post(
  '/forgot-password',
  authLimiter,
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const token = await authService.requestPasswordReset(req.body.email);
    if (token && process.env.EMAIL_PROVIDER !== 'none') {
      const resetUrl = `${process.env.WEB_ORIGIN}/reset-password?token=${token}`;
      // eslint-disable-next-line no-console
      console.log(`[password-reset] ${req.body.email} -> ${resetUrl}`);
    }
    // Always the same response so the endpoint cannot enumerate accounts.
    ok(res, { message: 'If that email is registered, a reset link has been sent' });
  }),
);

router.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body.token, req.body.password);
    ok(res, { message: 'Password updated. Please sign in again.' });
  }),
);

router.post(
  '/verify-email',
  authLimiter,
  validate(z.object({ token: z.string().trim().min(10).max(200) })),
  asyncHandler(async (req, res) => {
    await authService.verifyEmailToken(req.body.token);
    ok(res, { verified: true });
  }),
);

/** GET variant used by the "verify email" link from the inbox. */
router.get(
  '/verify-email/:token',
  asyncHandler(async (req, res) => {
    await authService.verifyEmailToken(String(req.params.token));
    ok(res, { verified: true });
  }),
);

router.post(
  '/change-password',
  authenticate,
  authLimiter,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    await authService.changePassword(req.auth!.id, req.body.currentPassword, req.body.newPassword);
    ok(res, { message: 'Password changed. Other sessions were signed out.' });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.auth!.id).lean();
    if (!user) throw errors.notFound('Account not found');
    ok(res, authService.toPublicUser(user as never));
  }),
);

router.patch(
  '/me',
  authenticate,
  validate(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const allowed = [
      'name',
      'avatarUrl',
      'headline',
      'bio',
      'website',
      'expertise',
      'socialLinks',
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) patch[key] = req.body[key];
    }
    const user = await User.findByIdAndUpdate(req.auth!.id, { $set: patch }, { new: true }).lean();
    if (!user) throw errors.notFound('Account not found');
    ok(res, authService.toPublicUser(user as never));
  }),
);

export default router;
