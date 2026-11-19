import { Router } from 'express';
import { z } from 'zod';
import { paginationSchema } from '@skillora/shared';
import { validate, getValidatedQuery } from '../middleware/validate';
import { asyncHandler } from '../lib/asyncHandler';
import { created, ok, paginate } from '../lib/http';
import { authenticate, authorize } from '../middleware/auth';
import { errors } from '../lib/errors';
import * as enrollmentService from '../services/enrollment.service';
import { Lesson, LessonProgress } from '../models/course';

const router = Router();

/** Enroll in a free course (idempotent). */
router.post(
  '/enrollments',
  authenticate,
  validate(z.object({ courseId: z.string().regex(/^[0-9a-fA-F]{24}$/) })),
  asyncHandler(async (req, res) => {
    const enrollment = await enrollmentService.enrollFree(
      req.auth!.id,
      req.body.courseId,
      'free',
    );
    created(res, { id: String(enrollment._id), courseId: req.body.courseId });
  }),
);

router.get(
  '/enrollments',
  authenticate,
  validate(paginationSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit } = getValidatedQuery<{ page: number; limit: number }>(req);
    const { items, total } = await enrollmentService.listMyEnrollments(req.auth!.id, page, limit);
    ok(res, paginate(items, total, page, limit));
  }),
);

router.get(
  '/enrollments/:courseId',
  authenticate,
  asyncHandler(async (req, res) => {
    const summary = await enrollmentService.getCourseProgressSummary(
      req.auth!.id,
      String(req.params.courseId),
    );
    if (!summary.enrolled && req.auth!.role !== 'admin') {
      throw errors.forbidden('You are not enrolled in this course');
    }
    ok(res, summary);
  }),
);

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */
const progressSchema = z
  .object({
    lessonId: z.string().regex(/^[0-9a-fA-F]{24}$/),
    watchedSeconds: z.number().min(0).max(86_400),
    positionSeconds: z.number().min(0).max(86_400),
    durationSeconds: z.number().min(0).max(86_400).optional(),
  })
  .strict();

router.post(
  '/progress',
  authenticate,
  validate(progressSchema),
  asyncHandler(async (req, res) => {
    const result = await enrollmentService.saveLessonProgress(req.auth!.id, req.body, req.auth!.role);
    ok(res, result);
  }),
);

router.post(
  '/progress/:lessonId/complete',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await enrollmentService.markLessonComplete(
      req.auth!.id,
      String(req.params.lessonId),
      req.auth!.role,
    );
    ok(res, result);
  }),
);

router.get(
  '/progress/:courseId',
  authenticate,
  asyncHandler(async (req, res) => {
    const rows = await enrollmentService.getLessonProgress(req.auth!.id, String(req.params.courseId));
    ok(res, rows);
  }),
);

/**
 * Lesson content for the player (requires access). Returns the signed media
 * URLs needed for playback — never a raw, unauthenticated media link.
 */
router.get(
  '/lessons/:lessonId/player',
  authenticate,
  asyncHandler(async (req, res) => {
    const lesson = await Lesson.findById(req.params.lessonId)
      .populate('videoAsset', 'status durationSeconds masterPlaylistKey posterKey renditions error width height')
      .lean();
    if (!lesson) throw errors.notFound('Lesson not found');

    const access = await enrollmentService.resolveCourseAccess(
      req.auth!.id,
      String(lesson.course),
      req.auth!.role,
    );
    const previewAllowed = lesson.isPreview || access.course.priceMinor === 0;
    if (!access.canWatch && !previewAllowed) {
      throw errors.forbidden('Purchase or enroll to watch this lesson');
    }

    const { signMediaUrl } = await import('../lib/media');
    const asset = lesson.videoAsset as any;

    let playlistUrl: string | null = null;
    if (asset?.masterPlaylistKey && (access.canWatch || lesson.isPreview)) {
      playlistUrl = signMediaUrl(asset.masterPlaylistKey, req.auth!.id, 3600);
    }

    const progress = await LessonProgress.findOne({
      user: req.auth!.id,
      lesson: lesson._id,
    }).lean();
    const quiz = lesson.type === 'quiz'
      ? await (await import('../models/learning')).Quiz.findOne({
          lesson: lesson._id,
          course: lesson.course,
          isActive: true,
        })
          .select('title description passScorePercent timeLimitSeconds maxAttempts totalPoints questions')
          .lean()
      : null;

    ok(res, {
      lesson: {
        id: String(lesson._id),
        title: lesson.title,
        type: lesson.type,
        content: lesson.content ?? null,
        durationSeconds: lesson.durationSeconds ?? 0,
        order: lesson.order,
        sectionId: String(lesson.section),
        resources: (lesson.resources ?? []).map((r: any) => ({
          id: String(r._id),
          title: r.title,
          fileName: r.fileName,
          sizeBytes: r.sizeBytes ?? 0,
          url: r.url,
        })),
      },
      quiz: quiz
        ? {
            id: String(quiz._id),
            title: quiz.title,
            description: quiz.description ?? null,
            passScorePercent: quiz.passScorePercent,
            timeLimitSeconds: quiz.timeLimitSeconds ?? null,
            maxAttempts: quiz.maxAttempts,
            totalPoints: quiz.totalPoints,
            questionCount: quiz.questions.length,
          }
        : null,
      video: asset
        ? {
            assetId: String(asset._id),
            status: asset.status,
            error: asset.error ?? null,
            durationSeconds: asset.durationSeconds ?? 0,
            width: asset.width ?? 0,
            height: asset.height ?? 0,
            posterUrl: asset.posterKey ? signMediaUrl(asset.posterKey, req.auth!.id, 3600) : null,
            playlistUrl,
            renditions: asset.renditions ?? [],
          }
        : null,
      progress: progress
        ? {
            completed: progress.completed,
            lastPositionSeconds: progress.lastPositionSeconds,
            watchedSeconds: progress.watchedSeconds,
            durationSeconds: progress.durationSeconds,
          }
        : { completed: false, lastPositionSeconds: 0, watchedSeconds: 0, durationSeconds: 0 },
      canWatch: access.canWatch,
    });
  }),
);

export default router;