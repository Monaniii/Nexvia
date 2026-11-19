import { Router } from 'express';
import { quizSubmissionSchema, quizUpsertSchema, quizUpdateSchema } from '@skillora/shared';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../lib/asyncHandler';
import { created, ok } from '../lib/http';
import { authenticate, authorize, maybeAuthenticate } from '../middleware/auth';
import { errors } from '../lib/errors';
import * as quizService from '../services/quiz.service';
import { assertCourseOwner } from '../services/course.service';
import { Course, Lesson } from '../models/course';

const router = Router();

/* ------------------------------------------------------------------ *
 * Instructor: authoring
 * ------------------------------------------------------------------ */

router.get(
  '/instructor/courses/:courseId/quizzes',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    await assertCourseOwner(String(req.params.courseId), req.auth!);
    const rows = await quizService.listCourseQuizzes(String(req.params.courseId));
    ok(
      res,
      rows.map((q: any) => ({
        id: String(q._id),
        title: q.title,
        description: q.description ?? null,
        lessonId: q.lesson ? String(q.lesson) : null,
        questionCount: q.questions?.length ?? 0,
        totalPoints: q.totalPoints,
        passScorePercent: q.passScorePercent,
        maxAttempts: q.maxAttempts,
        timeLimitSeconds: q.timeLimitSeconds ?? null,
        isActive: q.isActive,
      })),
    );
  }),
);

router.post(
  '/instructor/courses/:courseId/quizzes',
  authenticate,
  authorize('instructor', 'admin'),
  validate(quizUpsertSchema),
  asyncHandler(async (req, res) => {
    await assertCourseOwner(String(req.params.courseId), req.auth!);
    const quiz = await quizService.upsertQuiz(String(req.params.courseId), req.body);
    created(res, { id: String(quiz._id) });
  }),
);

/** Full quiz incl. correct answers — instructor/admin only. */
router.get(
  '/instructor/quizzes/:quizId',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const quiz = await quizService.getQuizForManagement(String(req.params.quizId));
    const course = await Course.findById(quiz.course).select('instructor').lean();
    if (req.auth!.role !== 'admin' && String(course?.instructor) !== req.auth!.id) {
      throw errors.forbidden('You can only manage your own quizzes');
    }
    ok(res, quiz);
  }),
);

router.patch(
  '/instructor/quizzes/:quizId',
  authenticate,
  authorize('instructor', 'admin'),
  validate(quizUpdateSchema),
  asyncHandler(async (req, res) => {
    const quiz = await quizService.getQuizForManagement(String(req.params.quizId));
    const course = await Course.findById(quiz.course).select('instructor').lean();
    if (req.auth!.role !== 'admin' && String(course?.instructor) !== req.auth!.id) {
      throw errors.forbidden('You can only manage your own quizzes');
    }
    const updated = await quizService.updateQuiz(String(req.params.quizId), req.body);
    ok(res, { id: String(updated._id), totalPoints: updated.totalPoints });
  }),
);

router.delete(
  '/instructor/quizzes/:quizId',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const quiz = await quizService.getQuizForManagement(String(req.params.quizId));
    const course = await Course.findById(quiz.course).select('instructor').lean();
    if (req.auth!.role !== 'admin' && String(course?.instructor) !== req.auth!.id) {
      throw errors.forbidden('You can only manage your own quizzes');
    }
    await quizService.deleteQuiz(String(req.params.quizId));
    ok(res, { deleted: true });
  }),
);

router.get(
  '/instructor/quizzes/:quizId/analytics',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const quiz = await quizService.getQuizForManagement(String(req.params.quizId));
    const course = await Course.findById(quiz.course).select('instructor').lean();
    if (req.auth!.role !== 'admin' && String(course?.instructor) !== req.auth!.id) {
      throw errors.forbidden('You can only view your own quizzes');
    }
    ok(res, await quizService.getQuizAnalytics(String(req.params.quizId)));
  }),
);

/* ------------------------------------------------------------------ *
 * Student: taking quizzes
 *
 * The session payload never contains correctOptionIds; the answers live only
 * on the server until the attempt is graded.
 * ------------------------------------------------------------------ */

router.post(
  '/quizzes/:quizId/start',
  authenticate,
  asyncHandler(async (req, res) => {
    const session = await quizService.startAttempt(req.auth!.id, String(req.params.quizId), req.auth!.role);
    ok(res, session);
  }),
);

router.post(
  '/quizzes/:quizId/submit',
  authenticate,
  validate(quizSubmissionSchema),
  asyncHandler(async (req, res) => {
    const result = await quizService.submitAttempt(
      req.auth!.id,
      String(req.params.quizId),
      req.body,
    );
    ok(res, result);
  }),
);

router.get(
  '/quizzes/:quizId/attempts',
  authenticate,
  asyncHandler(async (req, res) => {
    ok(res, await quizService.getAttemptHistory(req.auth!.id, String(req.params.quizId)));
  }),
);

/** Lightweight student-facing quiz meta (no questions, no answers). */
router.get(
  '/quizzes/:quizId',
  maybeAuthenticate,
  asyncHandler(async (req, res) => {
    const quiz = await (await import('../models/learning')).Quiz.findById(req.params.quizId)
      .select('title description passScorePercent timeLimitSeconds maxAttempts totalPoints questions course')
      .lean();
    if (!quiz) throw errors.notFound('Quiz not found');
    ok(res, {
      id: String(quiz._id),
      title: quiz.title,
      description: quiz.description ?? null,
      passScorePercent: quiz.passScorePercent,
      timeLimitSeconds: quiz.timeLimitSeconds ?? null,
      maxAttempts: quiz.maxAttempts,
      totalPoints: quiz.totalPoints,
      questionCount: (quiz.questions ?? []).length,
      courseId: String(quiz.course),
    });
  }),
);

export default router;