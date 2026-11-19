import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { COURSE_STATUSES, DIFFICULTY_LEVELS, LESSON_TYPES, ASSET_STATUSES } from '@skillora/shared';
import { toJSONOptions } from './identity';

/* ------------------------------------------------------------------ *
 * Category
 * ------------------------------------------------------------------ */
const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    icon: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

export const Category = model('Category', categorySchema);

/* ------------------------------------------------------------------ *
 * Course
 * ------------------------------------------------------------------ */
const courseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    headline: { type: String, default: null, maxlength: 160 },
    description: { type: String, default: '', maxlength: 20000 },
    instructor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    instructorProfile: { type: Schema.Types.ObjectId, ref: 'InstructorProfile', default: null },
    category: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    level: { type: String, enum: DIFFICULTY_LEVELS, default: 'beginner' },
    language: { type: String, default: 'English', maxlength: 40 },
    thumbnailUrl: { type: String, default: null },
    objectives: { type: [String], default: [] },
    prerequisites: { type: [String], default: [] },
    priceMinor: { type: Number, default: 0, min: 0, index: true },
    currency: { type: String, default: 'USD', uppercase: true, minlength: 3, maxlength: 3 },
    status: { type: String, enum: COURSE_STATUSES, default: 'draft', index: true },
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    enrollmentCount: { type: Number, default: 0, min: 0 },
    totalDurationSeconds: { type: Number, default: 0, min: 0 },
    lessonCount: { type: Number, default: 0, min: 0 },
    sectionCount: { type: Number, default: 0, min: 0 },
    rejectionReason: { type: String, default: null },
    submittedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    welcomeMessage: { type: String, default: null, maxlength: 1000 },
    congratulationsMessage: { type: String, default: null, maxlength: 1000 },
    certificateRule: {
      type: {
        requireAllLessons: { type: Boolean, default: true },
        requireAllQuizzes: { type: Boolean, default: true },
        minOverallScorePercent: { type: Number, default: null, min: 0, max: 100 },
      },
      default: () => ({}),
    },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
courseSchema.index({ title: 'text', headline: 'text' });
courseSchema.index({ status: 1, createdAt: -1 });
courseSchema.index({ instructor: 1, status: 1 });

export type CourseDoc = HydratedDocument<InferSchemaType<typeof courseSchema>>;
export const Course = model('Course', courseSchema);

/* ------------------------------------------------------------------ *
 * Sections & lessons
 * ------------------------------------------------------------------ */
const sectionSchema = new Schema(
  {
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    order: { type: Number, required: true, min: 0 },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
sectionSchema.index({ course: 1, order: 1 });

export const CourseSection = model('CourseSection', sectionSchema);

const lessonResourceSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    fileName: { type: String, required: true, maxlength: 200 },
    url: { type: String, required: true, maxlength: 600 },
    sizeBytes: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const lessonSchema = new Schema(
  {
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    section: { type: Schema.Types.ObjectId, ref: 'CourseSection', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    type: { type: String, enum: LESSON_TYPES, default: 'video' },
    order: { type: Number, required: true, min: 0 },
    durationSeconds: { type: Number, default: 0, min: 0 },
    isPublished: { type: Boolean, default: false, index: true },
    isPreview: { type: Boolean, default: false },
    content: { type: String, default: null, maxlength: 50000 },
    videoAsset: { type: Schema.Types.ObjectId, ref: 'VideoAsset', default: null },
    resources: { type: [lessonResourceSchema], default: [] },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
lessonSchema.index({ section: 1, order: 1 });
lessonSchema.index({ course: 1, isPublished: 1 });

export type LessonDoc = HydratedDocument<InferSchemaType<typeof lessonSchema>>;
export const Lesson = model('Lesson', lessonSchema);

/* ------------------------------------------------------------------ *
 * Video asset (upload -> queue -> transcode -> ready)
 * ------------------------------------------------------------------ */
const renditionSchema = new Schema(
  {
    name: { type: String, required: true },
    height: { type: Number, required: true },
    bandwidth: { type: Number, required: true },
    playlistKey: { type: String, required: true },
  },
  { _id: false },
);

const videoAssetSchema = new Schema(
  {
    lesson: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    originalName: { type: String, required: true, maxlength: 255 },
    mimeType: { type: String, required: true, maxlength: 120 },
    sizeBytes: { type: Number, required: true, min: 0 },
    storageKey: { type: String, required: true },
    status: { type: String, enum: ASSET_STATUSES, default: 'UPLOADING', index: true },
    error: { type: String, default: null },
    durationSeconds: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    fps: { type: Number, default: 0 },
    renditions: { type: [renditionSchema], default: [] },
    masterPlaylistKey: { type: String, default: null },
    thumbnailKey: { type: String, default: null },
    posterKey: { type: String, default: null },
    jobId: { type: String, default: null },
    attempts: { type: Number, default: 0, min: 0 },
    queuedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
videoAssetSchema.index({ status: 1, createdAt: -1 });

export type VideoAssetDoc = HydratedDocument<InferSchemaType<typeof videoAssetSchema>>;
export const VideoAsset = model('VideoAsset', videoAssetSchema);

/* ------------------------------------------------------------------ *
 * Enrollment (unique per user+course => duplicate enrollments impossible)
 * ------------------------------------------------------------------ */
const enrollmentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
    completedLessons: { type: Number, default: 0, min: 0 },
    totalLessons: { type: Number, default: 0, min: 0 },
    lastAccessedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    source: { type: String, enum: ['free', 'purchase', 'admin', 'seed'], default: 'free' },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
enrollmentSchema.index({ user: 1, course: 1 }, { unique: true });
enrollmentSchema.index({ user: 1, lastAccessedAt: -1 });

export type EnrollmentDoc = HydratedDocument<InferSchemaType<typeof enrollmentSchema>>;
export const Enrollment = model('Enrollment', enrollmentSchema);

/* ------------------------------------------------------------------ *
 * Lesson progress
 * ------------------------------------------------------------------ */
const lessonProgressSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lesson: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    completed: { type: Boolean, default: false, index: true },
    watchedSeconds: { type: Number, default: 0, min: 0 },
    lastPositionSeconds: { type: Number, default: 0, min: 0 },
    durationSeconds: { type: Number, default: 0, min: 0 },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
lessonProgressSchema.index({ user: 1, lesson: 1 }, { unique: true });
lessonProgressSchema.index({ user: 1, course: 1 });

export const LessonProgress = model('LessonProgress', lessonProgressSchema);

/* ------------------------------------------------------------------ *
 * Reviews (one per enrolled student per course)
 * ------------------------------------------------------------------ */
const courseReviewSchema = new Schema(
  {
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: null, maxlength: 2000 },
    verifiedEnrollment: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
courseReviewSchema.index({ course: 1, user: 1 }, { unique: true });

export const CourseReview = model('CourseReview', courseReviewSchema);