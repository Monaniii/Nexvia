import { Router } from 'express';
import { z } from 'zod';
import { paginationSchema } from '@skillora/shared';
import { validate, getValidatedQuery } from '../middleware/validate';
import { asyncHandler } from '../lib/asyncHandler';
import { ok, paginate } from '../lib/http';
import { authenticate, authorize, maybeAuthenticate } from '../middleware/auth';
import { Notification, User, writeAudit } from '../models/identity';
import { integrationStatus, env } from '../config/env';
import { pingRedis } from '../config/redis';
import mongoose from 'mongoose';

const router = Router();

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */
router.get(
  '/notifications',
  authenticate,
  validate(paginationSchema.extend({ unreadOnly: z.coerce.boolean().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit, unreadOnly } = getValidatedQuery<{
      page: number;
      limit: number;
      unreadOnly?: boolean;
    }>(req);
    const filter: Record<string, unknown> = { user: req.auth!.id };
    if (unreadOnly) filter.readAt = null;

    const [rows, total, unread] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.auth!.id, readAt: null }),
    ]);

    ok(
      res,
      paginate(
        rows.map((n) => ({
          id: String(n._id),
          type: n.type,
          title: n.title,
          body: n.body,
          link: n.link ?? null,
          readAt: n.readAt ? new Date(n.readAt).toISOString() : null,
          createdAt: new Date(n.createdAt as never).toISOString(),
        })),
        total,
        page,
        limit,
      ),
      { unread },
    );
  }),
);

router.post(
  '/notifications/read',
  authenticate,
  validate(z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { user: req.auth!.id, readAt: null };
    if (req.body.all) {
      const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
      ok(res, { marked: result.modifiedCount });
      return;
    }
    if (req.body.ids?.length) filter._id = { $in: req.body.ids };
    const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
    ok(res, { marked: result.modifiedCount });
  }),
);

/* ------------------------------------------------------------------ *
 * Health & readiness
 * ------------------------------------------------------------------ */
router.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'skillora-api', uptime: process.uptime() });
});

router.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    checks.mongodb = {
      ok: mongoose.connection.readyState === 1,
      detail: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState],
    };

    const redisOk = await pingRedis();
    checks.redis = { ok: redisOk, detail: redisOk ? 'PONG' : 'unreachable' };

    checks.storage = { ok: true, detail: env.STORAGE_DRIVER };
    checks.payments = {
      ok: env.PAYMENT_PROVIDER !== 'stripe' || integrationStatus.stripe,
      detail: integrationStatus.stripe ? 'stripe' : 'local_test_gateway (simulated)',
    };
    checks.liveClasses = {
      ok: true,
      detail: integrationStatus.livekit ? 'livekit' : 'not configured',
    };

    const okAll = Object.values(checks).every((c) => c.ok);
    res.status(okAll ? 200 : 503).json({
      status: okAll ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  }),
);

router.get(
  '/meta',
  maybeAuthenticate,
  asyncHandler(async (_req, res) => {
    const [instructorCount, courseCount] = await Promise.all([
      User.countDocuments({ role: 'instructor' }),
      (async () => (await import('../models/course')).Course.countDocuments({ status: 'published' }))(),
    ]);
    ok(res, {
      platformName: env.PLATFORM_NAME,
      supportEmail: env.SUPPORT_EMAIL,
      testMode: true,
      integrations: {
        payments: { provider: env.PAYMENT_PROVIDER, stripe: integrationStatus.stripe },
        storage: { driver: env.STORAGE_DRIVER, aws: integrationStatus.aws, cdn: Boolean(env.CDN_BASE_URL) },
        livekit: integrationStatus.livekit,
      },
      counts: { instructors: instructorCount, publishedCourses: courseCount },
    });
  }),
);

router.get(
  '/admin/health/details',
  authenticate,
  authorize('admin'),
  asyncHandler(async (_req, res) => {
    const stats = await mongoose.connection.db?.stats().catch(() => null);
    const redisOk = await pingRedis();
    ok(res, {
      node: process.version,
      memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
      mongo: {
        ready: mongoose.connection.readyState === 1,
        database: mongoose.connection.name,
        collections: stats?.collections ?? null,
        objects: stats?.objects ?? null,
      },
      redis: { ready: redisOk },
      queues: { configured: Boolean(env.REDIS_URL) },
    });
  }),
);

export default router;