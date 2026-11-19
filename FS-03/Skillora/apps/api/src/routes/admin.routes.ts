import { Router } from 'express';
import { z } from 'zod';
import {
  moderationSchema,
  paginationSchema,
  settingsUpdateSchema,
  userAdminUpdateSchema,
} from '@skillora/shared';
import { validate, getValidatedQuery } from '../middleware/validate';
import { asyncHandler } from '../lib/asyncHandler';
import { created, ok, paginate } from '../lib/http';
import { authenticate, authorize } from '../middleware/auth';
import { errors } from '../lib/errors';
import { AuditLog, InstructorProfile, User, writeAudit } from '../models/identity';
import { Course, CourseReview, Enrollment, Lesson, VideoAsset } from '../models/course';
import { LiveClass } from '../models/live';
import { PlatformSettings, getPlatformSettings, Refund, Order } from '../models/financial';
import { changeCourseStatus } from '../services/course.service';

const router = Router();

router.use(authenticate, authorize('admin'));

/* ------------------------------------------------------------------ *
 * Platform overview
 * ------------------------------------------------------------------ */
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const since30 = new Date(Date.now() - 30 * 24 * 3600_000);

    const [
      roleCounts,
      courseStatusCounts,
      enrollmentsTotal,
      enrollmentsRecent,
      revenueAgg,
      mediaCounts,
      liveCounts,
      pendingReview,
    ] = await Promise.all([
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      Course.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Enrollment.countDocuments({}),
      Enrollment.countDocuments({ createdAt: { $gte: since30 } }),
      Order.aggregate([
        { $match: { status: { $in: ['paid', 'partially_refunded'] } } },
        {
          $group: {
            _id: null,
            gross: { $sum: '$grossMinor' },
            refunded: { $sum: '$refundedMinor' },
            currency: { $first: '$currency' },
          },
        },
      ]),
      VideoAsset.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      LiveClass.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Course.countDocuments({ status: 'pending_review' }),
    ]);

    const byRole = (role: string) => roleCounts.find((r) => r._id === role)?.count ?? 0;
    const byCourseStatus = (s: string) => courseStatusCounts.find((c) => c._id === s)?.count ?? 0;
    const byMedia = (s: string) => mediaCounts.find((m) => m._id === s)?.count ?? 0;
    const byLive = (s: string) => liveCounts.find((l) => l._id === s)?.count ?? 0;

    ok(res, {
      users: {
        total: roleCounts.reduce((s, r) => s + r.count, 0),
        students: byRole('student'),
        instructors: byRole('instructor'),
        admins: byRole('admin'),
      },
      courses: {
        total: courseStatusCounts.reduce((s, c) => s + c.count, 0),
        published: byCourseStatus('published'),
        pendingReview,
        rejected: byCourseStatus('rejected'),
        draft: byCourseStatus('draft'),
      },
      enrollments: { total: enrollmentsTotal, last30Days: enrollmentsRecent },
      revenue: {
        grossMinor: revenueAgg[0]?.gross ?? 0,
        refundedMinor: revenueAgg[0]?.refunded ?? 0,
        currency: revenueAgg[0]?.currency ?? 'USD',
      },
      mediaQueue: {
        queued: byMedia('QUEUED'),
        processing: byMedia('PROCESSING'),
        ready: byMedia('READY'),
        failed: byMedia('FAILED'),
      },
      liveClasses: { scheduled: byLive('scheduled'), live: byLive('live'), completed: byLive('completed') },
    });
  }),
);

/* ------------------------------------------------------------------ *
 * User management
 * ------------------------------------------------------------------ */
router.get(
  '/users',
  validate(paginationSchema.extend({ q: z.string().optional(), role: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit, q, role } = getValidatedQuery<{
      page: number;
      limit: number;
      q?: string;
      role?: string;
    }>(req);
    const filter: Record<string, unknown> = {};
    if (role) filter.role = role;
    if (q) {
      filter.$or = [
        { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      ];
    }
    const [rows, total] = await Promise.all([
      User.find(filter)
        .select('name email role isActive isVerified createdAt lastLoginAt headline')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);
    ok(
      res,
      paginate(
        rows.map((u) => ({
          id: String(u._id),
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          isVerified: u.isVerified,
          createdAt: new Date(u.createdAt).toISOString(),
          lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
        })),
        total,
        page,
        limit,
      ),
    );
  }),
);

router.patch(
  '/users/:id',
  validate(userAdminUpdateSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw errors.notFound('User not found');

    if (req.body.role && req.body.role !== user.role) {
      if (String(user._id) === req.auth!.id) throw errors.precondition('You cannot change your own role');
      user.role = req.body.role;
      if (req.body.role === 'instructor') {
        await InstructorProfile.updateOne(
          { user: user._id },
          { $setOnInsert: { displayName: user.name, approved: false } },
          { upsert: true },
        );
      }
    }
    if (req.body.isActive !== undefined) {
      if (String(user._id) === req.auth!.id && req.body.isActive === false) {
        throw errors.precondition('You cannot deactivate your own account');
      }
      user.isActive = req.body.isActive;
      user.deactivatedAt = req.body.isActive ? null : new Date();
    }
    if (req.body.isVerified !== undefined) user.isVerified = req.body.isVerified;
    await user.save();

    if (req.body.instructorApproved !== undefined) {
      await InstructorProfile.updateOne(
        { user: user._id },
        { $set: { approved: req.body.instructorApproved } },
      );
    }

    await writeAudit({
      actor: req.auth!.id,
      actorRole: 'admin',
      action: 'admin.user_updated',
      entityType: 'user',
      entityId: String(user._id),
      metadata: req.body,
      ip: req.ip ?? null,
    });

    ok(res, {
      id: String(user._id),
      role: user.role,
      isActive: user.isActive,
      isVerified: user.isVerified,
    });
  }),
);

/* ------------------------------------------------------------------ *
 * Course moderation
 * ------------------------------------------------------------------ */
router.get(
  '/courses',
  validate(paginationSchema.extend({ status: z.string().optional(), q: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit, status, q } = getValidatedQuery<{
      page: number;
      limit: number;
      status?: string;
      q?: string;
    }>(req);
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (q) filter.title = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

    const [rows, total] = await Promise.all([
      Course.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('instructor', 'name email')
        .populate('category', 'name')
        .lean(),
      Course.countDocuments(filter),
    ]);

    ok(
      res,
      paginate(
        rows.map((c: any) => ({
          id: String(c._id),
          title: c.title,
          slug: c.slug,
          status: c.status,
          priceMinor: c.priceMinor,
          currency: c.currency,
          instructorName: c.instructor?.name ?? '—',
          instructorEmail: c.instructor?.email ?? null,
          categoryName: c.category?.name ?? null,
          enrollmentCount: c.enrollmentCount ?? 0,
          rejectionReason: c.rejectionReason ?? null,
          submittedAt: c.submittedAt ? new Date(c.submittedAt).toISOString() : null,
          updatedAt: new Date(c.updatedAt).toISOString(),
        })),
        total,
        page,
        limit,
      ),
    );
  }),
);

router.post(
  '/courses/:id/moderate',
  validate(moderationSchema),
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id).select('instructor title').lean();
    if (!course) throw errors.notFound('Course not found');
    await changeCourseStatus(String(req.params.id), req.body.action, {
      actorId: req.auth!.id,
      actorRole: 'admin',
      reason: req.body.reason,
    });

    const { createNotification } = await import('../models/identity');
    await createNotification({
      user: String(course.instructor),
      type: req.body.action === 'approve' ? 'course_approved' : 'course_rejected',
      title:
        req.body.action === 'approve'
          ? 'Course approved'
          : req.body.action === 'reject'
            ? 'Course needs changes'
            : `Course ${req.body.action}`,
      body:
        req.body.action === 'approve'
          ? `"${course.title}" is live on the catalog.`
          : `"${course.title}" — ${req.body.reason ?? 'review the feedback in your dashboard'}`,
      link: `/instructor/courses/${String(req.params.id)}`,
    });

    const updated = await Course.findById(req.params.id).select('status rejectionReason').lean();
    ok(res, { status: updated?.status, rejectionReason: updated?.rejectionReason ?? null });
  }),
);

/* ------------------------------------------------------------------ *
 * Reviews moderation
 * ------------------------------------------------------------------ */
router.get(
  '/reviews',
  validate(paginationSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit } = getValidatedQuery<{ page: number; limit: number }>(req);
    const [rows, total] = await Promise.all([
      CourseReview.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name email')
        .populate('course', 'title')
        .lean(),
      CourseReview.countDocuments({}),
    ]);
    ok(
      res,
      paginate(
        rows.map((r: any) => ({
          id: String(r._id),
          rating: r.rating,
          comment: r.comment ?? '',
          studentName: r.user?.name ?? '—',
          courseTitle: r.course?.title ?? '—',
          isHidden: r.isHidden,
          createdAt: new Date(r.createdAt).toISOString(),
        })),
        total,
        page,
        limit,
      ),
    );
  }),
);

router.post(
  '/reviews/:id/hide',
  validate(z.object({ hidden: z.boolean() })),
  asyncHandler(async (req, res) => {
    const review = await CourseReview.findByIdAndUpdate(
      req.params.id,
      { $set: { isHidden: req.body.hidden } },
      { new: true },
    ).lean();
    if (!review) throw errors.notFound('Review not found');
    await writeAudit({
      actor: req.auth!.id,
      actorRole: 'admin',
      action: req.body.hidden ? 'review.hidden' : 'review.shown',
      entityType: 'review',
      entityId: String(req.params.id),
    });
    ok(res, { hidden: review.isHidden });
  }),
);

/* ------------------------------------------------------------------ *
 * Media processing queue
 * ------------------------------------------------------------------ */
router.get(
  '/media-queue',
  validate(paginationSchema.extend({ status: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit, status } = getValidatedQuery<{
      page: number;
      limit: number;
      status?: string;
    }>(req);
    const filter = status ? { status } : {};
    const [rows, total] = await Promise.all([
      VideoAsset.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('lesson', 'title')
        .populate('course', 'title')
        .populate('owner', 'name email')
        .lean(),
      VideoAsset.countDocuments(filter),
    ]);
    ok(
      res,
      paginate(
        rows.map((v: any) => ({
          id: String(v._id),
          status: v.status,
          originalName: v.originalName,
          lessonTitle: v.lesson?.title ?? '—',
          courseTitle: v.course?.title ?? '—',
          ownerName: v.owner?.name ?? '—',
          error: v.error ?? null,
          attempts: v.attempts,
          sizeBytes: v.sizeBytes,
          createdAt: new Date(v.createdAt).toISOString(),
          processedAt: v.processedAt ? new Date(v.processedAt).toISOString() : null,
        })),
        total,
        page,
        limit,
      ),
    );
  }),
);

/* ------------------------------------------------------------------ *
 * Platform settings & audit
 * ------------------------------------------------------------------ */
router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const settings = await getPlatformSettings();
    ok(res, {
      commissionBps: settings.commissionBps,
      platformName: settings.platformName,
      supportEmail: settings.supportEmail,
      payoutThresholdMinor: settings.payoutThresholdMinor,
      autoApproveCourses: settings.autoApproveCourses,
      maintenanceMode: settings.maintenanceMode,
    });
  }),
);

router.patch(
  '/settings',
  validate(settingsUpdateSchema),
  asyncHandler(async (req, res) => {
    const settings = await PlatformSettings.findByIdAndUpdate(
      'platform',
      { $set: req.body },
      { new: true, upsert: true },
    ).lean();
    await writeAudit({
      actor: req.auth!.id,
      actorRole: 'admin',
      action: 'settings.updated',
      entityType: 'settings',
      entityId: 'platform',
      metadata: req.body,
      ip: req.ip ?? null,
    });
    ok(res, settings);
  }),
);

router.get(
  '/audit-logs',
  validate(
    paginationSchema.extend({
      action: z.string().optional(),
      entityType: z.string().optional(),
      actor: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const { page, limit, action, entityType, actor, from, to } = getValidatedQuery<{
      page: number;
      limit: number;
      action?: string;
      entityType?: string;
      actor?: string;
      from?: string;
      to?: string;
    }>(req);

    const filter: Record<string, unknown> = {};
    if (action) filter.action = { $regex: action, $options: 'i' };
    if (entityType) filter.entityType = entityType;
    if (actor) filter.actor = actor;
    if (from || to) {
      filter.createdAt = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('actor', 'name email')
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    ok(
      res,
      paginate(
        rows.map((l: any) => ({
          id: String(l._id),
          actorName: l.actor?.name ?? l.actorName ?? 'system',
          actorRole: l.actorRole,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId ?? null,
          metadata: l.metadata ?? null,
          ip: l.ip ?? null,
          createdAt: new Date(l.createdAt).toISOString(),
        })),
        total,
        page,
        limit,
      ),
    );
  }),
);

router.get(
  '/refunds',
  validate(paginationSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit } = getValidatedQuery<{ page: number; limit: number }>(req);
    const [rows, total] = await Promise.all([
      Refund.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('order', 'reference courseTitleSnapshot')
        .lean(),
      Refund.countDocuments({}),
    ]);
    ok(
      res,
      paginate(
        rows.map((r: any) => ({
          id: String(r._id),
          orderReference: r.order?.reference ?? null,
          courseTitle: r.order?.courseTitleSnapshot ?? null,
          amountMinor: r.amountMinor,
          currency: r.currency,
          status: r.status,
          reason: r.reason ?? null,
          simulated: !r.providerRefundId?.startsWith('re_'),
          createdAt: new Date(r.createdAt).toISOString(),
        })),
        total,
        page,
        limit,
      ),
    );
  }),
);

export default router;