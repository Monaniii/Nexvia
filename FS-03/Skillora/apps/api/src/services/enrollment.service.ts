import { Types } from 'mongoose';
import type { Role } from '@skillora/shared';
import { computeProgressPercent, hasCourseAccess, isLessonComplete } from '@skillora/shared';
import { Course, Enrollment, Lesson, LessonProgress } from '../models/course';
import { createNotification, writeAudit } from '../models/identity';
import { errors } from '../lib/errors';

function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

export interface CourseAccess {
  course: any;
  enrollment: any | null;
  canWatch: boolean;
  isOwner: boolean;
  isAdmin: boolean;
}

/**
 * Single source of truth for "may this user watch this course".
 * Enforced server-side for every media/progress/quiz request.
 */
export async function resolveCourseAccess(
  userId: string,
  courseId: string,
  role: Role,
): Promise<CourseAccess> {
  const course = await Course.findById(courseId).lean();
  if (!course) throw errors.notFound('Course not found');

  const isOwner = String(course.instructor) === userId;
  const isAdmin = role === 'admin';

  const enrollment = await Enrollment.findOne({ user: oid(userId), course: course._id }).lean();

  let hasPaidOrder = false;
  if (!enrollment && !isOwner && !isAdmin && course.priceMinor > 0) {
    const { Order } = await import('../models/financial');
    hasPaidOrder = Boolean(
      await Order.findOne({
        buyer: oid(userId),
        course: course._id,
        status: { $in: ['paid', 'partially_refunded'] },
      })
        .select('_id')
        .lean(),
    );
  }

  const visibleStatus = course.status === 'published';
  void visibleStatus;
  const canWatch = hasCourseAccess({
    courseStatus: course.status,
    priceMinor: course.priceMinor ?? 0,
    hasEnrollment: Boolean(enrollment),
    hasPaidOrder,
    isOwner,
    isAdmin,
  });

  return { course, enrollment, canWatch, isOwner, isAdmin };
}

/** Free enrollment (also used for admin-granted access). */
export async function enrollFree(
  userId: string,
  courseId: string,
  source: 'free' | 'admin' | 'seed' | 'purchase' = 'free',
): Promise<any> {
  const course = await Course.findById(courseId).lean();
  if (!course) throw errors.notFound('Course not found');
  if (course.status !== 'published') throw errors.forbidden('This course is not open for enrollment');
  if (course.priceMinor > 0 && source !== 'admin' && source !== 'purchase') {
    throw errors.forbidden('This course requires purchase');
  }

  const totalLessons = await Lesson.countDocuments({ course: course._id, isPublished: true });

  try {
    const enrollment = await Enrollment.create({
      user: oid(userId),
      course: course._id,
      totalLessons,
      source,
      lastAccessedAt: new Date(),
    });
    await Course.updateOne({ _id: course._id }, { $inc: { enrollmentCount: 1 } });
    await createNotification({
      user: String(course.instructor),
      type: 'new_enrollment',
      title: 'New enrollment',
      body: `A learner just enrolled in "${course.title}".`,
      link: `/instructor/courses/${course._id}/learners`,
    });
    await writeAudit({
      actor: userId,
      action: 'enrollment.created',
      entityType: 'enrollment',
      entityId: String(enrollment._id),
      metadata: { courseId: String(course._id), source },
    });
    return enrollment;
  } catch (err: any) {
    if (err?.code === 11000) {
      // Already enrolled — return the existing record (idempotent).
      const existing = await Enrollment.findOne({ user: oid(userId), course: course._id }).lean();
      if (existing) return existing;
    }
    throw err;
  }
}

export async function listMyEnrollments(userId: string, page: number, limit: number) {
  const filter = { user: oid(userId) };
  const [rows, total] = await Promise.all([
    Enrollment.find(filter)
      .sort({ lastAccessedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('course', 'title slug thumbnailUrl priceMinor currency level status instructor')
      .lean(),
    Enrollment.countDocuments(filter),
  ]);

  return {
    items: rows.map((e: any) => {
      const course = e.course ?? {};
      return {
        id: String(e._id),
        courseId: String(course._id ?? ''),
        courseTitle: course.title ?? 'Course',
        courseSlug: course.slug ?? '',
        thumbnailUrl: course.thumbnailUrl ?? null,
        progressPercent: e.progressPercent ?? 0,
        completedLessons: e.completedLessons ?? 0,
        totalLessons: e.totalLessons ?? 0,
        lastAccessedAt: new Date(e.lastAccessedAt).toISOString(),
        enrolledAt: new Date(e.createdAt).toISOString(),
        priceMinor: course.priceMinor ?? 0,
        currency: course.currency ?? 'USD',
        level: course.level ?? 'beginner',
        instructorName: (course.instructor as any)?.name ?? null,
      };
    }),
    total,
  };
}

/* ------------------------------------------------------------------ *
 * Progress tracking
 * ------------------------------------------------------------------ */
export interface SaveProgressInput {
  lessonId: string;
  watchedSeconds: number;
  positionSeconds: number;
  durationSeconds?: number;
}

/**
 * Progress save. Completion rules (see shared/rules):
 *  - video  -> 90% of duration watched (server accumulates, client cannot fake easily)
 *  - text/attachment -> explicit complete flag
 *  - quiz -> passing attempt
 * Opening a lesson never completes it.
 */
export async function saveLessonProgress(userId: string, input: SaveProgressInput, role: Role) {
  const lesson = await Lesson.findById(input.lessonId).lean();
  if (!lesson) throw errors.notFound('Lesson not found');

  const access = await resolveCourseAccess(userId, String(lesson.course), role);
  if (!access.canWatch) throw errors.forbidden('You do not have access to this course');

  const duration = input.durationSeconds ?? lesson.durationSeconds ?? 0;
  const watched = Math.max(0, Math.min(input.watchedSeconds, duration || input.watchedSeconds));
  const position = Math.max(0, input.positionSeconds);

  const progress = await LessonProgress.findOneAndUpdate(
    { user: oid(userId), lesson: lesson._id },
    {
      $set: { lastPositionSeconds: position, durationSeconds: duration },
      $max: { watchedSeconds: watched },
      $setOnInsert: { course: lesson.course, completed: false },
    },
    { upsert: true, new: true },
  );

  const ratio = duration > 0 ? watched / duration : 0;
  const complete = isLessonComplete({ lessonType: lesson.type as never, watchedRatio: ratio });
  if (complete && !progress.completed) {
    progress.completed = true;
    progress.completedAt = new Date();
    await progress.save();
    await recomputeEnrollmentProgress(userId, String(lesson.course));
  } else if (!progress.completed) {
    await progress.save();
  }

  return {
    lessonId: String(lesson._id),
    completed: progress.completed,
    watchedSeconds: progress.watchedSeconds,
    lastPositionSeconds: progress.lastPositionSeconds,
    durationSeconds: progress.durationSeconds,
    updatedAt: new Date(progress.updatedAt).toISOString(),
  };
}

/** Explicit completion for text/attachment lessons. */
export async function markLessonComplete(userId: string, lessonId: string, role: Role) {
  const lesson = await Lesson.findById(lessonId).lean();
  if (!lesson) throw errors.notFound('Lesson not found');
  if (lesson.type !== 'text' && lesson.type !== 'attachment') {
    throw errors.precondition('Only text and attachment lessons can be marked complete directly');
  }
  const access = await resolveCourseAccess(userId, String(lesson.course), role);
  if (!access.canWatch) throw errors.forbidden('You do not have access to this course');

  const progress = await LessonProgress.findOneAndUpdate(
    { user: oid(userId), lesson: lesson._id },
    {
      $set: {
        completed: true,
        completedAt: new Date(),
        course: lesson.course,
        durationSeconds: lesson.durationSeconds ?? 0,
      },
    },
    { upsert: true, new: true },
  );
  await recomputeEnrollmentProgress(userId, String(lesson.course));
  return { lessonId: String(lesson._id), completed: progress.completed };
}

export async function getLessonProgress(userId: string, courseId: string) {
  const rows = await LessonProgress.find({ user: oid(userId), course: oid(courseId) }).lean();
  return rows.map((p) => ({
    lessonId: String(p.lesson),
    completed: p.completed,
    watchedSeconds: p.watchedSeconds,
    durationSeconds: p.durationSeconds,
    lastPositionSeconds: p.lastPositionSeconds,
    completedAt: p.completedAt ? new Date(p.completedAt).toISOString() : null,
    updatedAt: new Date(p.updatedAt).toISOString(),
  }));
}

/** Recomputes enrollment counters after any progress change. */
export async function recomputeEnrollmentProgress(userId: string, courseId: string): Promise<void> {
  const enrollment = await Enrollment.findOne({ user: oid(userId), course: oid(courseId) });
  if (!enrollment) return;

  const totalLessons = await Lesson.countDocuments({ course: oid(courseId), isPublished: true });
  const lessons = await Lesson.find({ course: oid(courseId) })
    .select('_id')
    .lean();
  const completed = await LessonProgress.countDocuments({
    user: oid(userId),
    lesson: { $in: lessons.map((l) => l._id) },
    completed: true,
  });

  enrollment.totalLessons = totalLessons;
  enrollment.completedLessons = completed;
  enrollment.progressPercent = computeProgressPercent(completed, totalLessons);
  enrollment.lastAccessedAt = new Date();

  const wasComplete = enrollment.status === 'completed';
  if (totalLessons > 0 && completed >= totalLessons) {
    enrollment.status = 'completed';
    if (!enrollment.completedAt) enrollment.completedAt = new Date();
  } else if (wasComplete && completed < totalLessons) {
    enrollment.status = 'active';
    enrollment.completedAt = null;
  }

  await enrollment.save();

  // When the course becomes complete, attempt certificate issuance (idempotent).
  if (enrollment.status === 'completed' && !wasComplete) {
    try {
      const { maybeIssueCertificate } = await import('./certificate.service');
      await maybeIssueCertificate(userId, courseId);
    } catch (err) {
      // Certificate failure must never break progress saves.
      const { logger } = await import('../lib/logger');
      logger.warn({ err, userId, courseId }, 'Certificate issuance skipped');
    }
  }
}

export async function getCourseProgressSummary(userId: string, courseId: string) {
  const enrollment = await Enrollment.findOne({ user: oid(userId), course: oid(courseId) }).lean();
  const lessons = await Lesson.find({ course: oid(courseId), isPublished: true })
    .select('_id type order section durationSeconds title')
    .sort({ order: 1 })
    .lean();
  const progress = await LessonProgress.find({ user: oid(userId), course: oid(courseId) }).lean();
  const byLesson = new Map(progress.map((p) => [String(p.lesson), p]));

  return {
    enrolled: Boolean(enrollment),
    progressPercent: enrollment?.progressPercent ?? 0,
    completedLessons: enrollment?.completedLessons ?? 0,
    totalLessons: enrollment?.totalLessons ?? lessons.length,
    status: enrollment?.status ?? 'not_enrolled',
    nextLessonId: lessons.find((l) => !byLesson.get(String(l._id))?.completed)?._id
      ? String(lessons.find((l) => !byLesson.get(String(l._id))?.completed)!._id)
      : null,
    lessons: lessons.map((l) => {
      const p = byLesson.get(String(l._id));
      return {
        lessonId: String(l._id),
        title: l.title,
        type: l.type,
        completed: Boolean(p?.completed),
        lastPositionSeconds: p?.lastPositionSeconds ?? 0,
        durationSeconds: l.durationSeconds ?? 0,
      };
    }),
  };
}
