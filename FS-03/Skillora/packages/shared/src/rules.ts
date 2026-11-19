import {
  BPS_DENOMINATOR,
  COURSE_STATUSES,
  CourseStatus,
  LessonType,
  VIDEO_COMPLETION_THRESHOLD,
} from './constants';

/* ------------------------------------------------------------------ *
 * Course lifecycle
 * ------------------------------------------------------------------ */

export interface CourseLifecycleInput {
  status: CourseStatus;
  /** Sections that contain at least one published, ready lesson. */
  publishedSectionCount: number;
  hasThumbnail: boolean;
  hasDescription: boolean;
  hasPrice: boolean;
  hasCategory: boolean;
  hasObjectives: boolean;
}

export interface RuleResult {
  ok: boolean;
  reasons: string[];
}

/** A course may move to `pending_review` only when it is structurally complete. */
export function canSubmitForReview(input: CourseLifecycleInput): RuleResult {
  const reasons: string[] = [];
  if (!['draft', 'rejected'].includes(input.status)) {
    reasons.push('Only draft or rejected courses can be submitted for review');
  }
  if (input.publishedSectionCount < 1) reasons.push('At least one section with a published lesson is required');
  if (!input.hasThumbnail) reasons.push('A thumbnail is required');
  if (!input.hasDescription) reasons.push('A description is required');
  if (!input.hasPrice) reasons.push('A price must be set (use 0 for free courses)');
  if (!input.hasCategory) reasons.push('A category is required');
  if (!input.hasObjectives) reasons.push('At least one learning objective is required');
  return { ok: reasons.length === 0, reasons };
}

/** Only the owning instructor (or an admin) may mutate a course. */
export function canManageCourse(input: {
  callerId: string;
  callerRole: string;
  ownerInstructorId: string;
}): boolean {
  return input.callerRole === 'admin' || input.callerId === String(input.ownerInstructorId);
}

/** Published courses are visible in the public catalog and purchasable. */
export function isCatalogVisible(status: CourseStatus): boolean {
  return status === 'published';
}

export function assertKnownStatus(status: string): asserts status is CourseStatus {
  if (!COURSE_STATUSES.includes(status as CourseStatus)) {
    throw new Error(`Unknown course status: ${status}`);
  }
}

/* ------------------------------------------------------------------ *
 * Enrollment / access
 * ------------------------------------------------------------------ */

export interface AccessInput {
  courseStatus: CourseStatus;
  priceMinor: number;
  hasEnrollment: boolean;
  /** Verified payment or a free enrollment. */
  hasPaidOrder: boolean;
  isOwner: boolean;
  isAdmin: boolean;
}

/** Central access rule: who may watch the paid content of a course. */
export function hasCourseAccess(input: AccessInput): boolean {
  if (input.isAdmin || input.isOwner) return true;
  if (!isCatalogVisible(input.courseStatus)) return false;
  if (input.hasEnrollment) return true;
  if (input.priceMinor === 0) return false; // free courses still require enrollment
  return input.hasPaidOrder;
}

export function requiresPayment(priceMinor: number): boolean {
  return priceMinor > 0;
}

/* ------------------------------------------------------------------ *
 * Progress & completion
 * ------------------------------------------------------------------ */

export interface LessonCompletionInput {
  lessonType: LessonType;
  /** 0..1 watched fraction for video lessons. */
  watchedRatio?: number;
  /** Explicit learner action for text/attachment lessons. */
  manuallyCompleted?: boolean;
  /** Quiz lesson type is complete when a passing attempt exists. */
  quizPassed?: boolean;
}

/**
 * Completion rule (documented in README):
 *  - video: at least 90% of the duration has been watched (server-side accumulated)
 *  - text / attachment: learner explicitly marks it complete
 *  - quiz: a passing attempt exists
 * Opening a lesson never marks it complete.
 */
export function isLessonComplete(input: LessonCompletionInput): boolean {
  switch (input.lessonType) {
    case 'video':
      return (input.watchedRatio ?? 0) >= VIDEO_COMPLETION_THRESHOLD;
    case 'quiz':
      return input.quizPassed === true;
    case 'text':
    case 'attachment':
      return input.manuallyCompleted === true;
    default:
      return false;
  }
}

export function computeProgressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

/* ------------------------------------------------------------------ *
 * Certificate eligibility
 * ------------------------------------------------------------------ */

export interface CertificateEligibilityInput {
  totalLessons: number;
  completedLessons: number;
  requiredLessonCount: number;
  requiredQuizCount: number;
  passedRequiredQuizzes: number;
  /** 0..100 average across required quizzes, when quizzes exist. */
  averageScorePercent?: number;
  minOverallScorePercent?: number;
  requireAllLessons: boolean;
  requireAllQuizzes: boolean;
}

export function isEligibleForCertificate(input: CertificateEligibilityInput): RuleResult {
  const reasons: string[] = [];
  if (input.totalLessons === 0) {
    reasons.push('Course has no lessons yet');
  }
  if (input.requireAllLessons && input.completedLessons < input.totalLessons) {
    reasons.push(
      `Complete all lessons (${input.completedLessons}/${input.totalLessons})`,
    );
  }
  if (!input.requireAllLessons && input.completedLessons < input.requiredLessonCount) {
    reasons.push(
      `Complete ${input.requiredLessonCount} lessons (${input.completedLessons}/${input.requiredLessonCount})`,
    );
  }
  if (input.requireAllQuizzes && input.passedRequiredQuizzes < input.requiredQuizCount) {
    reasons.push(
      `Pass all required quizzes (${input.passedRequiredQuizzes}/${input.requiredQuizCount})`,
    );
  }
  if (
    input.minOverallScorePercent !== undefined &&
    input.minOverallScorePercent > 0 &&
    (input.averageScorePercent ?? 0) < input.minOverallScorePercent
  ) {
    reasons.push(
      `Reach an average score of ${input.minOverallScorePercent}% (${input.averageScorePercent ?? 0}%)`,
    );
  }
  return { ok: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------ *
 * Payments
 * ------------------------------------------------------------------ */

export type PaymentEvent =
  | 'checkout_created'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'refund_succeeded';

const PAYMENT_TRANSITIONS: Record<string, PaymentEvent[]> = {
  pending: ['checkout_created', 'payment_succeeded', 'payment_failed'],
  paid: ['refund_succeeded'],
  failed: ['checkout_created'],
  refunded: [],
  partially_refunded: ['refund_succeeded'],
};

export function canTransitionOrder(from: string, event: PaymentEvent): boolean {
  const allowed = PAYMENT_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(event);
}

/** Commission is always taken from the pre-tax, post-discount amount. */
export function commissionBaseMinor(grossMinor: number, discountMinor: number): number {
  return grossMinor - discountMinor;
}

export function commissionShareOf(baseMinor: number, commissionBps: number): number {
  if (commissionBps < 0 || commissionBps > BPS_DENOMINATOR) {
    throw new Error('commissionBps must be between 0 and 10000');
  }
  return Math.round((baseMinor * commissionBps) / BPS_DENOMINATOR);
}