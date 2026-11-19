import { Router } from 'express';
import { z } from 'zod';
import {
  categoryCreateSchema,
  courseCreateSchema,
  courseSearchSchema,
  courseUpdateSchema,
  lessonCreateSchema,
  lessonUpdateSchema,
  paginationSchema,
  publishSchema,
  reviewCreateSchema,
  sectionCreateSchema,
  sectionUpdateSchema,
} from '@skillora/shared';
import { validate, getValidatedQuery } from '../middleware/validate';
import { asyncHandler } from '../lib/asyncHandler';
import { created, ok, paginate } from '../lib/http';
import { authenticate, authorize, maybeAuthenticate } from '../middleware/auth';
import { errors } from '../lib/errors';
import * as courseService from '../services/course.service';
import { Category, Course } from '../models/course';
import { ensureUniqueSlug } from '../lib/slug';

const router = Router();

/* ------------------------------------------------------------------ *
 * Public catalog
 * ------------------------------------------------------------------ */

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const rows = await Category.find({ isActive: true }).sort({ order: 1, name: 1 }).lean();
    const counts = await Course.aggregate([
      { $match: { status: 'published' } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.count]));
    ok(
      res,
      rows.map((c) => ({
        id: String(c._id),
        name: c.name,
        slug: c.slug,
        icon: c.icon ?? null,
        courseCount: byId.get(String(c._id)) ?? 0,
        isActive: c.isActive,
      })),
    );
  }),
);

router.get(
  '/courses',
  maybeAuthenticate,
  validate(courseSearchSchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof courseSearchSchema>>(req);
    const { items, total } = await courseService.searchCourses(query, req.auth?.id);
    ok(res, paginate(items, total, query.page, query.limit));
  }),
);

router.get(
  '/courses/:idOrSlug',
  maybeAuthenticate,
  asyncHandler(async (req, res) => {
    const detail = await courseService.getCourseDetail(
      String(req.params.idOrSlug),
      req.auth ?? null,
    );
    ok(res, detail);
  }),
);

router.post(
  '/courses/:id/reviews',
  authenticate,
  validate(reviewCreateSchema),
  asyncHandler(async (req, res) => {
    await courseService.upsertReview(req.auth!.id, String(req.params.id), req.body);
    ok(res, { message: 'Review saved' });
  }),
);

router.get(
  '/courses/:id/reviews',
  validate(paginationSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const filter = { course: req.params.id, isHidden: false };
    const { CourseReview } = await import('../models/course');
    const [rows, total] = await Promise.all([
      CourseReview.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name avatarUrl')
        .lean(),
      CourseReview.countDocuments(filter),
    ]);
    ok(
      res,
      paginate(
        rows.map((r: any) => ({
          id: String(r._id),
          rating: r.rating,
          comment: r.comment ?? '',
          studentName: r.user?.name ?? 'Learner',
          avatarUrl: r.user?.avatarUrl ?? null,
          createdAt: new Date(r.createdAt).toISOString(),
          verified: r.verifiedEnrollment,
        })),
        total,
        page,
        limit,
      ),
    );
  }),
);

/* ------------------------------------------------------------------ *
 * Instructor course authoring
 * ------------------------------------------------------------------ */

router.post(
  '/instructor/courses',
  authenticate,
  authorize('instructor', 'admin'),
  validate(courseCreateSchema),
  asyncHandler(async (req, res) => {
    const course = await courseService.createCourse(req.auth!.id, req.body);
    created(res, course);
  }),
);

router.get(
  '/instructor/courses',
  authenticate,
  authorize('instructor', 'admin'),
  validate(paginationSchema.extend({ status: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit, status } = req.query as unknown as {
      page: number;
      limit: number;
      status?: string;
    };
    const { items, total } = await courseService.listInstructorCourses(req.auth!.id, {
      status,
      page,
      limit,
    });
    ok(res, paginate(items, total, page, limit));
  }),
);

router.get(
  '/instructor/courses/:id',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    await courseService.assertCourseOwner(String(req.params.id), req.auth!);
    const detail = await courseService.getCourseDetail(String(req.params.id), req.auth!);
    ok(res, detail);
  }),
);

router.patch(
  '/instructor/courses/:id',
  authenticate,
  authorize('instructor', 'admin'),
  validate(courseUpdateSchema),
  asyncHandler(async (req, res) => {
    await courseService.assertCourseOwner(String(req.params.id), req.auth!);
    const course = await courseService.updateCourse(String(req.params.id), req.body);
    ok(res, course);
  }),
);

router.delete(
  '/instructor/courses/:id',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const course = await courseService.assertCourseOwner(String(req.params.id), req.auth!);
    if (course.status === 'published') {
      throw errors.precondition('Unpublish or archive the course before deleting it');
    }
    const { Enrollment, Lesson, LessonProgress, CourseSection, CourseReview } = await import(
      '../models/course'
    );
    await LessonProgress.deleteMany({ course: course._id });
    await Enrollment.deleteMany({ course: course._id });
    await Lesson.deleteMany({ course: course._id });
    await CourseSection.deleteMany({ course: course._id });
    await CourseReview.deleteMany({ course: course._id });
    await Course.deleteOne({ _id: course._id });
    ok(res, { deleted: true });
  }),
);

router.post(
  '/instructor/courses/:id/publish',
  authenticate,
  authorize('instructor', 'admin'),
  validate(publishSchema),
  asyncHandler(async (req, res) => {
    await courseService.assertCourseOwner(String(req.params.id), req.auth!);
    await courseService.changeCourseStatus(String(req.params.id), req.body.action, {
      actorId: req.auth!.id,
      actorRole: req.auth!.role,
      reason: req.body.reason,
    });
    const course = await Course.findById(req.params.id).select('status rejectionReason').lean();
    ok(res, { status: course?.status, rejectionReason: course?.rejectionReason ?? null });
  }),
);

/* Sections ---------------------------------------------------------- */

router.post(
  '/instructor/courses/:id/sections',
  authenticate,
  authorize('instructor', 'admin'),
  validate(sectionCreateSchema),
  asyncHandler(async (req, res) => {
    await courseService.assertCourseOwner(String(req.params.id), req.auth!);
    const section = await courseService.addSection(String(req.params.id), req.body.title, req.body.order);
    created(res, section);
  }),
);

router.patch(
  '/instructor/sections/:sectionId',
  authenticate,
  authorize('instructor', 'admin'),
  validate(sectionUpdateSchema),
  asyncHandler(async (req, res) => {
    const { CourseSection } = await import('../models/course');
    const existing = await CourseSection.findById(req.params.sectionId).lean();
    if (!existing) throw errors.notFound('Section not found');
    await courseService.assertCourseOwner(String(existing.course), req.auth!);
    const section = await courseService.updateSection(String(req.params.sectionId), req.body);
    ok(res, section);
  }),
);

router.delete(
  '/instructor/sections/:sectionId',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { CourseSection } = await import('../models/course');
    const existing = await CourseSection.findById(req.params.sectionId).lean();
    if (!existing) throw errors.notFound('Section not found');
    await courseService.assertCourseOwner(String(existing.course), req.auth!);
    await courseService.deleteSection(String(req.params.sectionId));
    ok(res, { deleted: true });
  }),
);

/* Lessons ----------------------------------------------------------- */

router.post(
  '/instructor/sections/:sectionId/lessons',
  authenticate,
  authorize('instructor', 'admin'),
  validate(lessonCreateSchema),
  asyncHandler(async (req, res) => {
    const { CourseSection } = await import('../models/course');
    const section = await CourseSection.findById(req.params.sectionId).lean();
    if (!section) throw errors.notFound('Section not found');
    await courseService.assertCourseOwner(String(section.course), req.auth!);
    const lesson = await courseService.addLesson(
      String(section.course),
      String(section._id),
      req.body,
    );
    created(res, lesson);
  }),
);

router.patch(
  '/instructor/lessons/:lessonId',
  authenticate,
  authorize('instructor', 'admin'),
  validate(lessonUpdateSchema),
  asyncHandler(async (req, res) => {
    const { Lesson } = await import('../models/course');
    const lesson = await Lesson.findById(req.params.lessonId).lean();
    if (!lesson) throw errors.notFound('Lesson not found');
    await courseService.assertCourseOwner(String(lesson.course), req.auth!);
    const updated = await courseService.updateLesson(String(req.params.lessonId), req.body);
    ok(res, updated);
  }),
);

router.delete(
  '/instructor/lessons/:lessonId',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { Lesson } = await import('../models/course');
    const lesson = await Lesson.findById(req.params.lessonId).lean();
    if (!lesson) throw errors.notFound('Lesson not found');
    await courseService.assertCourseOwner(String(lesson.course), req.auth!);
    await courseService.deleteLesson(String(req.params.lessonId));
    ok(res, { deleted: true });
  }),
);

router.get(
  '/instructor/courses/:id/learners',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    await courseService.assertCourseOwner(String(req.params.id), req.auth!);
    ok(res, await courseService.getCourseLearnerStats(String(req.params.id)));
  }),
);

/* Categories (admin) ------------------------------------------------ */

router.post(
  '/admin/categories',
  authenticate,
  authorize('admin'),
  validate(categoryCreateSchema),
  asyncHandler(async (req, res) => {
    const exists = await Category.exists({ slug: req.body.slug });
    if (exists) throw errors.conflict('A category with this slug already exists');
    const category = await Category.create({
      name: req.body.name,
      slug: req.body.slug,
      icon: req.body.icon ?? null,
    });
    created(res, category);
  }),
);

router.patch(
  '/admin/categories/:id',
  authenticate,
  authorize('admin'),
  validate(categoryCreateSchema.partial()),
  asyncHandler(async (req, res) => {
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { $set: { ...req.body, ...(req.body.slug ? { slug: await ensureUniqueSlug(req.body.slug, async (s) => Boolean(await Category.exists({ slug: s, _id: { $ne: req.params.id } }))) } : {}) } },
      { new: true },
    ).lean();
    if (!category) throw errors.notFound('Category not found');
    ok(res, category);
  }),
);

router.delete(
  '/admin/categories/:id',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const inUse = await Course.exists({ category: req.params.id });
    if (inUse) throw errors.precondition('Category is in use by one or more courses');
    await Category.deleteOne({ _id: req.params.id });
    ok(res, { deleted: true });
  }),
);

export default router;