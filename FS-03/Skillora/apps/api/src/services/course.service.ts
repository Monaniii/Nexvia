import { Types } from 'mongoose';
import type {
  CourseCreateInput,
  CourseSearchInput,
  LessonCreateInput,
  Role,
} from '@skillora/shared';
import {
  canManageCourse,
  canSubmitForReview,
  hasCourseAccess,
} from '@skillora/shared';
import {
  Course,
  CourseReview,
  CourseSection,
  Enrollment,
  Lesson,
  LessonProgress,
  VideoAsset,
} from '../models/course';
import { Quiz } from '../models/learning';
import { InstructorProfile, User, writeAudit } from '../models/identity';
import { errors } from '../lib/errors';
import { ensureUniqueSlug, slugify } from '../lib/slug';

const PUBLIC_PROJECTION =
  'title slug headline thumbnailUrl priceMinor currency level status ratingAverage ratingCount enrollmentCount totalDurationSeconds lessonCount sectionCount createdAt updatedAt instructor category description objectives prerequisites language publishedAt';

function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

/* ------------------------------------------------------------------ *
 * Catalog search
 * ------------------------------------------------------------------ */
export async function searchCourses(query: CourseSearchInput, viewerId?: string) {
  const filter: Record<string, unknown> = { status: 'published' };

  if (query.q) {
    filter.$or = [
      { title: { $regex: escapeRegex(query.q), $options: 'i' } },
      { headline: { $regex: escapeRegex(query.q), $options: 'i' } },
      { description: { $regex: escapeRegex(query.q), $options: 'i' } },
    ];
  }
  if (query.category) filter.category = await resolveCategoryId(query.category);
  if (query.level) filter.level = query.level;
  if (query.price === 'free') filter.priceMinor = 0;
  if (query.price === 'paid') filter.priceMinor = { $gt: 0 };
  if (query.minRating) filter.ratingAverage = { $gte: query.minRating };
  if (query.duration === 'short') filter.totalDurationSeconds = { $lte: 3600 };
  if (query.duration === 'medium') filter.totalDurationSeconds = { $gt: 3600, $lte: 10800 };
  if (query.duration === 'long') filter.totalDurationSeconds = { $gt: 10800 };
  if (query.instructor) {
    const users = await User.find({
      name: { $regex: escapeRegex(query.instructor), $options: 'i' },
    })
      .select('_id')
      .limit(50)
      .lean();
    filter.instructor = { $in: users.map((u) => u._id) };
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    popular: { enrollmentCount: -1, ratingAverage: -1 },
    newest: { publishedAt: -1, createdAt: -1 },
    oldest: { createdAt: 1 },
    rating: { ratingAverage: -1, ratingCount: -1 },
    price_asc: { priceMinor: 1 },
    price_desc: { priceMinor: -1 },
    title: { title: 1 },
  };

  const sort = sortMap[query.sort] ?? sortMap.popular;
  const page = query.page;
  const limit = query.limit;

  const [rows, total] = await Promise.all([
    Course.find(filter)
      .select(PUBLIC_PROJECTION)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('instructor', 'name avatarUrl')
      .populate('category', 'name slug')
      .lean(),
    Course.countDocuments(filter),
  ]);

  let enrolledIds = new Set<string>();
  if (viewerId) {
    const enrollments = await Enrollment.find({
      user: oid(viewerId),
      course: { $in: rows.map((r) => r._id) },
    })
      .select('course')
      .lean();
    enrolledIds = new Set(enrollments.map((e) => String(e.course)));
  }

  const items = rows.map((row) => ({
    ...mapSummary(row),
    isEnrolled: enrolledIds.has(String(row._id)),
  }));

  return { items, total };
}

async function resolveCategoryId(slug: string): Promise<Types.ObjectId | null> {
  const { Category } = await import('../models/course');
  const cat = await Category.findOne({ slug }).select('_id').lean();
  return (cat?._id as Types.ObjectId) ?? null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mapSummary(row: Record<string, any>) {
  return {
    id: String(row._id),
    title: row.title,
    slug: row.slug,
    headline: row.headline ?? null,
    thumbnailUrl: row.thumbnailUrl ?? null,
    priceMinor: row.priceMinor ?? 0,
    currency: row.currency ?? 'USD',
    level: row.level,
    status: row.status,
    ratingAverage: row.ratingAverage ?? 0,
    ratingCount: row.ratingCount ?? 0,
    enrollmentCount: row.enrollmentCount ?? 0,
    totalDurationSeconds: row.totalDurationSeconds ?? 0,
    lessonCount: row.lessonCount ?? 0,
    category: row.category
      ? {
          id: String(row.category._id ?? row.category),
          name: row.category.name,
          slug: row.category.slug,
        }
      : null,
    instructor: {
      id: String(row.instructor?._id ?? row.instructor),
      name: row.instructor?.name ?? 'Unknown instructor',
      avatarUrl: row.instructor?.avatarUrl ?? null,
    },
    updatedAt: new Date(row.updatedAt ?? Date.now()).toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Course detail (with lesson visibility + access evaluation)
 * ------------------------------------------------------------------ */
export async function getCourseDetail(
  idOrSlug: string,
  viewer: { id: string; role: Role } | null,
): Promise<Record<string, unknown>> {
  const bySlug = slugify(idOrSlug) === idOrSlug;
  const course = await Course.findOne(bySlug ? { slug: idOrSlug } : { _id: safeOid(idOrSlug) })
    .populate('instructor', 'name avatarUrl headline')
    .populate('category', 'name slug')
    .lean();
  if (!course) throw errors.notFound('Course not found');

  const isOwner = Boolean(viewer && String(course.instructor._id ?? course.instructor) === viewer.id);
  const isAdmin = viewer?.role === 'admin';
  const status = course.status as never;

  if (!isOwner && !isAdmin && status !== 'published') {
    // Drafts are never exposed to strangers; instructors/admins see them above.
    throw errors.notFound('Course not found');
  }

  const sections = await CourseSection.find({ course: course._id }).sort({ order: 1 }).lean();
  const lessons = await Lesson.find({ course: course._id })
    .sort({ order: 1 })
    .populate('videoAsset', 'status durationSeconds masterPlaylistKey posterKey')
    .lean();

  const enrollment = viewer
    ? await Enrollment.findOne({ user: oid(viewer.id), course: course._id }).lean()
    : null;

  const hasPaidOrder = viewer
    ? await hasVerifiedPayment(viewer.id, String(course._id))
    : false;

  const priceMinor = course.priceMinor ?? 0;
  const access = hasCourseAccess({
    courseStatus: status,
    priceMinor,
    hasEnrollment: Boolean(enrollment),
    hasPaidOrder,
    isOwner,
    isAdmin,
  });

  const visibleLessons = lessons.filter((l) => {
    if (isOwner || isAdmin) return true;
    if (!l.isPublished) return false;
    if (l.isPreview || priceMinor === 0) return true;
    return access;
  });

  const sectionDtos = sections.map((section) => ({
    id: String(section._id),
    title: section.title,
    order: section.order,
    lessons: visibleLessons
      .filter((l) => String(l.section) === String(section._id))
      .map((lesson) => mapLesson(lesson, { canWatch: access || lesson.isPreview || priceMinor === 0 })),
  }));

  const reviews = await CourseReview.find({ course: course._id, isHidden: false })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('user', 'name avatarUrl')
    .lean();

  const instructorProfile = await InstructorProfile.findOne({
    user: course.instructor._id ?? course.instructor,
  }).lean();

  return {
    ...mapSummary(course),
    description: course.description ?? '',
    objectives: course.objectives ?? [],
    prerequisites: course.prerequisites ?? [],
    language: course.language ?? 'English',
    welcomeMessage: course.welcomeMessage ?? null,
    congratulationsMessage: course.congratulationsMessage ?? null,
    sections: sectionDtos,
    instructorProfile: instructorProfile
      ? {
          id: String(instructorProfile._id),
          userId: String(instructorProfile.user),
          displayName: instructorProfile.displayName,
          headline: instructorProfile.headline ?? null,
          bio: instructorProfile.bio ?? null,
          expertise: instructorProfile.expertise ?? [],
          website: instructorProfile.website ?? null,
          socialLinks: instructorProfile.socialLinks ?? [],
          approved: instructorProfile.approved,
          ratingAverage: instructorProfile.ratingAverage ?? 0,
          ratingCount: instructorProfile.ratingCount ?? 0,
          courseCount: instructorProfile.courseCount ?? 0,
          studentCount: instructorProfile.studentCount ?? 0,
        }
      : null,
    review: reviews.map((r) => ({
      rating: r.rating,
      comment: r.comment ?? '',
      createdAt: new Date(r.createdAt as never).toISOString(),
      studentName: (r.user as any)?.name ?? 'Learner',
    })),
    enrolled: Boolean(enrollment),
    access: {
      canWatch: access || isOwner || isAdmin,
      reason: access
        ? 'enrolled'
        : isOwner || isAdmin
          ? 'owner'
          : priceMinor === 0
            ? 'enroll_free'
            : 'purchase_required',
    },
    certificateRules: course.certificateRule ?? null,
    updatedAtIso: new Date(course.updatedAt as never).toISOString(),
  };
}

function safeOid(id: string): Types.ObjectId | undefined {
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined;
}

async function hasVerifiedPayment(userId: string, courseId: string): Promise<boolean> {
  const { Order } = await import('../models/financial');
  const order = await Order.findOne({
    buyer: oid(userId),
    course: oid(courseId),
    status: { $in: ['paid', 'partially_refunded'] },
  })
    .select('_id')
    .lean();
  return Boolean(order);
}

function mapLesson(lesson: any, opts: { canWatch: boolean }) {
  const asset = lesson.videoAsset;
  return {
    id: String(lesson._id),
    sectionId: String(lesson.section),
    title: lesson.title,
    type: lesson.type,
    order: lesson.order,
    durationSeconds: lesson.durationSeconds ?? 0,
    isPublished: Boolean(lesson.isPublished),
    isPreview: Boolean(lesson.isPreview),
    videoAssetId: asset ? String(asset._id) : null,
    videoStatus: asset?.status ?? null,
    content: opts.canWatch || lesson.type !== 'text' ? (lesson.content ?? null) : null,
    resources: opts.canWatch
      ? (lesson.resources ?? []).map((r: any) => ({
          id: String(r._id),
          title: r.title,
          fileName: r.fileName,
          sizeBytes: r.sizeBytes ?? 0,
          url: r.url,
        }))
      : [],
  };
}

/* ------------------------------------------------------------------ *
 * Instructor course management
 * ------------------------------------------------------------------ */
export async function createCourse(instructorId: string, input: CourseCreateInput) {
  const slug = await ensureUniqueSlug(input.title, async (candidate) =>
    Boolean(await Course.exists({ slug: candidate })),
  );
  const profile = await InstructorProfile.findOne({ user: oid(instructorId) });

  const course = await Course.create({
    title: input.title,
    slug,
    headline: input.headline ?? null,
    description: input.description ?? '',
    instructor: oid(instructorId),
    instructorProfile: profile?._id ?? null,
    category: input.categoryId ? oid(input.categoryId) : null,
    level: input.level,
    language: input.language,
    priceMinor: input.priceMinor,
    currency: input.currency,
    objectives: input.objectives ?? [],
    prerequisites: input.prerequisites ?? [],
    thumbnailUrl: input.thumbnailUrl ?? null,
    welcomeMessage: input.welcomeMessage ?? null,
    congratulationsMessage: input.congratulationsMessage ?? null,
    status: 'draft',
  });
  return course;
}

export async function assertCourseOwner(courseId: string, caller: { id: string; role: Role }) {
  const course = await Course.findById(courseId).lean();
  if (!course) throw errors.notFound('Course not found');
  const ownerId = String(course.instructor);
  if (!canManageCourse({ callerId: caller.id, callerRole: caller.role, ownerInstructorId: ownerId })) {
    throw errors.forbidden('You can only manage your own courses');
  }
  return course;
}

export async function listInstructorCourses(instructorId: string, opts: { status?: string; page: number; limit: number }) {
  const filter: Record<string, unknown> = { instructor: oid(instructorId) };
  if (opts.status) filter.status = opts.status;
  const [rows, total] = await Promise.all([
    Course.find(filter)
      .select(PUBLIC_PROJECTION)
      .sort({ updatedAt: -1 })
      .skip((opts.page - 1) * opts.limit)
      .limit(opts.limit)
      .populate('category', 'name slug')
      .lean(),
    Course.countDocuments(filter),
  ]);
  return { items: rows.map(mapSummary), total };
}

export async function updateCourse(courseId: string, patch: Partial<CourseCreateInput>) {
  const update: Record<string, unknown> = {};
  const mapping: Record<string, string> = {
    title: 'title',
    headline: 'headline',
    description: 'description',
    categoryId: 'category',
    level: 'level',
    language: 'language',
    priceMinor: 'priceMinor',
    currency: 'currency',
    objectives: 'objectives',
    prerequisites: 'prerequisites',
    thumbnailUrl: 'thumbnailUrl',
    welcomeMessage: 'welcomeMessage',
    congratulationsMessage: 'congratulationsMessage',
  };
  for (const [key, field] of Object.entries(mapping)) {
    if (key in patch) update[field] = key === 'categoryId' ? oid(patch[key as keyof CourseCreateInput] as string) : patch[key as keyof CourseCreateInput];
  }
  const course = await Course.findByIdAndUpdate(courseId, { $set: update }, { new: true });
  if (!course) throw errors.notFound('Course not found');
  return course;
}

/* ------------------------------------------------------------------ *
 * Sections & lessons
 * ------------------------------------------------------------------ */
export async function addSection(courseId: string, title: string, order?: number) {
  const nextOrder =
    order ??
    ((await CourseSection.countDocuments({ course: oid(courseId) })) );
  const section = await CourseSection.create({ course: oid(courseId), title, order: nextOrder });
  await Course.updateOne({ _id: courseId }, { $inc: { sectionCount: 1 } });
  return section;
}

export async function updateSection(sectionId: string, patch: { title?: string; order?: number }) {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.order !== undefined) update.order = patch.order;
  const section = await CourseSection.findByIdAndUpdate(sectionId, { $set: update }, { new: true });
  if (!section) throw errors.notFound('Section not found');
  return section;
}

export async function deleteSection(sectionId: string): Promise<void> {
  const section = await CourseSection.findById(sectionId);
  if (!section) throw errors.notFound('Section not found');
  const lessons = await Lesson.find({ section: section._id }).select('_id videoAsset');
  const lessonIds = lessons.map((l) => l._id);
  if (lessonIds.length > 0) {
    await Lesson.deleteMany({ section: section._id });
    await LessonProgress.deleteMany({ lesson: { $in: lessonIds } });
    await Quiz.deleteMany({ lesson: { $in: lessonIds } });
  }
  await section.deleteOne();
  await Course.updateOne({ _id: section.course }, { $inc: { sectionCount: -1, lessonCount: -lessonIds.length } });
}

export async function addLesson(courseId: string, sectionId: string, input: LessonCreateInput) {
  const section = await CourseSection.findOne({ _id: sectionId, course: oid(courseId) });
  if (!section) throw errors.notFound('Section not found in this course');
  const order =
    input.order ?? (await Lesson.countDocuments({ section: section._id }));
  const lesson = await Lesson.create({
    course: oid(courseId),
    section: section._id,
    title: input.title,
    type: input.type,
    order,
    durationSeconds: input.durationSeconds,
    isPreview: input.isPreview,
    isPublished: input.isPublished,
    content: input.content ?? null,
    resources: input.resources ?? [],
  });
  await recomputeCourseCounters(courseId);
  return lesson;
}

export async function updateLesson(lessonId: string, patch: Partial<LessonCreateInput>) {
  const update: Record<string, unknown> = {};
  const keys: (keyof LessonCreateInput)[] = [
    'title',
    'type',
    'content',
    'durationSeconds',
    'isPreview',
    'isPublished',
    'order',
    'resources',
  ];
  for (const key of keys) if (key in patch) update[key] = patch[key];
  const lesson = await Lesson.findByIdAndUpdate(lessonId, { $set: update }, { new: true });
  if (!lesson) throw errors.notFound('Lesson not found');
  await recomputeCourseCounters(String(lesson.course));
  return lesson;
}

export async function deleteLesson(lessonId: string): Promise<void> {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw errors.notFound('Lesson not found');
  await LessonProgress.deleteMany({ lesson: lesson._id });
  await Quiz.deleteMany({ lesson: lesson._id });
  await VideoAsset.deleteMany({ lesson: lesson._id });
  await lesson.deleteOne();
  await recomputeCourseCounters(String(lesson.course));
}

/** Recomputes denormalized counters used by catalog and progress displays. */
export async function recomputeCourseCounters(courseId: string): Promise<void> {
  const course = await Course.findById(courseId).lean();
  if (!course) return;
  const lessons = await Lesson.find({ course: course._id }).lean();
  const published = lessons.filter((l) => l.isPublished);
  const totalDuration = published.reduce((sum, l) => sum + (l.durationSeconds ?? 0), 0);
  const sectionCount = await CourseSection.countDocuments({ course: course._id });
  await Course.updateOne(
    { _id: course._id },
    {
      $set: {
        lessonCount: lessons.length,
        sectionCount,
        totalDurationSeconds: totalDuration,
      },
    },
  );
}

/* ------------------------------------------------------------------ *
 * Publication workflow
 * ------------------------------------------------------------------ */
export async function changeCourseStatus(
  courseId: string,
  action: 'submit' | 'approve' | 'reject' | 'unpublish' | 'archive',
  opts: { actorId: string; actorRole: Role; reason?: string },
): Promise<void> {
  const course = await Course.findById(courseId);
  if (!course) throw errors.notFound('Course not found');

  const sectionCount = await CourseSection.countDocuments({ course: course._id });
  const publishedWithLessons = await Lesson.countDocuments({
    course: course._id,
    isPublished: true,
    section: { $in: (await CourseSection.find({ course: course._id }).select('_id')).map((s) => s._id) },
  });

  if (action === 'submit') {
    const result = canSubmitForReview({
      status: course.status,
      publishedSectionCount: publishedWithLessons > 0 ? sectionCount : 0,
      hasThumbnail: Boolean(course.thumbnailUrl),
      hasDescription: Boolean(course.description && course.description.length >= 40),
      hasPrice: Number.isInteger(course.priceMinor),
      hasCategory: Boolean(course.category),
      hasObjectives: (course.objectives ?? []).length > 0,
    });
    if (!result.ok) throw errors.precondition(`Cannot submit: ${result.reasons.join('; ')}`);
    course.status = 'pending_review';
    course.submittedAt = new Date();
    course.rejectionReason = null;
  } else if (action === 'approve') {
    if (opts.actorRole !== 'admin') throw errors.forbidden('Only administrators approve courses');
    course.status = 'published';
    course.publishedAt = course.publishedAt ?? new Date();
    course.rejectionReason = null;
  } else if (action === 'reject') {
    if (opts.actorRole !== 'admin') throw errors.forbidden('Only administrators reject courses');
    course.status = 'rejected';
    course.rejectionReason = opts.reason ?? null;
  } else if (action === 'unpublish') {
    if (opts.actorRole !== 'admin' && String(course.instructor) !== opts.actorId) {
      throw errors.forbidden('You can only unpublish your own courses');
    }
    course.status = 'archived';
  } else if (action === 'archive') {
    if (opts.actorRole !== 'admin' && String(course.instructor) !== opts.actorId) {
      throw errors.forbidden('You can only archive your own courses');
    }
    course.status = 'archived';
  }

  await course.save();
  await writeAudit({
    actor: opts.actorId,
    actorRole: opts.actorRole,
    action: `course.${action}`,
    entityType: 'course',
    entityId: String(course._id),
    metadata: { title: course.title, status: course.status, reason: opts.reason ?? null },
  });
}

/* ------------------------------------------------------------------ *
 * Reviews (verified enrollment required)
 * ------------------------------------------------------------------ */
export async function upsertReview(
  userId: string,
  courseId: string,
  input: { rating: number; comment?: string },
) {
  const enrollment = await Enrollment.findOne({ user: oid(userId), course: oid(courseId) }).lean();
  if (!enrollment) throw errors.forbidden('Only enrolled students can review this course');

  const existing = await CourseReview.findOne({ user: oid(userId), course: oid(courseId) });
  if (existing) {
    existing.rating = input.rating;
    existing.comment = input.comment ?? null;
    await existing.save();
  } else {
    await CourseReview.create({
      user: oid(userId),
      course: oid(courseId),
      rating: input.rating,
      comment: input.comment ?? null,
      verifiedEnrollment: true,
    });
  }
  await recomputeRating(courseId);
}

export async function recomputeRating(courseId: string): Promise<void> {
  const stats = await CourseReview.aggregate([
    { $match: { course: oid(courseId), isHidden: false } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const avg = stats[0]?.avg ?? 0;
  const count = stats[0]?.count ?? 0;
  await Course.updateOne(
    { _id: courseId },
    { $set: { ratingAverage: Math.round(avg * 10) / 10, ratingCount: count } },
  );
}

/** Instructor view of their students' progress. */
export async function getCourseLearnerStats(courseId: string) {
  const enrollments = await Enrollment.find({ course: oid(courseId) })
    .populate('user', 'name email avatarUrl')
    .sort({ lastAccessedAt: -1 })
    .limit(200)
    .lean();
  return enrollments.map((e: any) => ({
    studentId: String(e.user._id ?? e.user),
    name: e.user.name ?? 'Learner',
    email: e.user.email ?? null,
    avatarUrl: e.user.avatarUrl ?? null,
    progressPercent: e.progressPercent ?? 0,
    completedLessons: e.completedLessons ?? 0,
    totalLessons: e.totalLessons ?? 0,
    lastAccessedAt: new Date(e.lastAccessedAt).toISOString(),
    status: e.status,
  }));
}
