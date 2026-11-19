import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { QUESTION_TYPES, CERTIFICATE_STATUSES } from '@skillora/shared';
import { toJSONOptions } from './identity';

/* ------------------------------------------------------------------ *
 * Quiz
 * ------------------------------------------------------------------ */
const quizOptionSchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true, maxlength: 600 },
  },
  { _id: false },
);

const quizQuestionSchema = new Schema(
  {
    id: { type: String, required: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    prompt: { type: String, required: true, maxlength: 2000 },
    points: { type: Number, default: 1, min: 1, max: 1000 },
    options: { type: [quizOptionSchema], required: true },
    correctOptionIds: { type: [String], required: true },
    explanation: { type: String, default: null, maxlength: 1000 },
  },
  { _id: false },
);

const quizSchema = new Schema(
  {
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    lesson: { type: Schema.Types.ObjectId, ref: 'Lesson', default: null, index: true },
    title: { type: String, required: true, maxlength: 140 },
    description: { type: String, default: null, maxlength: 2000 },
    passScorePercent: { type: Number, default: 60, min: 0, max: 100 },
    timeLimitSeconds: { type: Number, default: null, min: 30, max: 7200 },
    maxAttempts: { type: Number, default: 1, min: 1, max: 10 },
    randomizeQuestions: { type: Boolean, default: false },
    randomizeOptions: { type: Boolean, default: false },
    questions: { type: [quizQuestionSchema], required: true },
    totalPoints: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

export type QuizDoc = HydratedDocument<InferSchemaType<typeof quizSchema>>;
export const Quiz = model('Quiz', quizSchema);

/* ------------------------------------------------------------------ *
 * Quiz attempt — one per attemptNumber, server-graded, immutable after grading
 * ------------------------------------------------------------------ */
const attemptAnswerSchema = new Schema(
  {
    questionId: { type: String, required: true },
    selectedOptionIds: { type: [String], default: [] },
    correct: { type: Boolean, default: false },
    pointsAwarded: { type: Number, default: 0 },
  },
  { _id: false },
);

const quizAttemptSchema = new Schema(
  {
    quiz: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    attemptNumber: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['in_progress', 'graded'], default: 'in_progress', index: true },
    answers: { type: [attemptAnswerSchema], default: [] },
    pointsEarned: { type: Number, default: 0 },
    pointsTotal: { type: Number, default: 0 },
    scorePercent: { type: Number, default: 0, min: 0, max: 100 },
    passed: { type: Boolean, default: false, index: true },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
    /** Snapshot of the question ids + correct answers used, so later edits cannot
     *  retroactively change a grade. */
    questionSnapshot: { type: [quizQuestionSchema], default: [] },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
// Duplicate attempts (double submit / retry races) are impossible.
quizAttemptSchema.index({ quiz: 1, user: 1, attemptNumber: 1 }, { unique: true });

export type QuizAttemptDoc = HydratedDocument<InferSchemaType<typeof quizAttemptSchema>>;
export const QuizAttempt = model('QuizAttempt', quizAttemptSchema);

/* ------------------------------------------------------------------ *
 * Certificate
 * ------------------------------------------------------------------ */
const certificateSchema = new Schema(
  {
    certificateNumber: { type: String, required: true, unique: true, index: true },
    verificationId: { type: String, required: true, unique: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    studentName: { type: String, required: true, maxlength: 120 },
    courseTitle: { type: String, required: true, maxlength: 200 },
    instructorName: { type: String, required: true, maxlength: 120 },
    scorePercent: { type: Number, default: null, min: 0, max: 100 },
    issuedAt: { type: Date, default: Date.now },
    status: { type: String, enum: CERTIFICATE_STATUSES, default: 'issued', index: true },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    revokeReason: { type: String, default: null },
    pdfKey: { type: String, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
// One issued certificate per user per course (idempotent issuance).
certificateSchema.index({ user: 1, course: 1 }, { unique: true, partialFilterExpression: { status: 'issued' } });

export type CertificateDoc = HydratedDocument<InferSchemaType<typeof certificateSchema>>;
export const Certificate = model('Certificate', certificateSchema);
