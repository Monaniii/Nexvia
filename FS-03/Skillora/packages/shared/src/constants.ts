/**
 * Shared, framework-agnostic constants for Skillora.
 * Used by the API, the worker and the web client so that every layer agrees
 * on the same state machines.
 */

export const ROLES = ['student', 'instructor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const COURSE_STATUSES = [
  'draft',
  'pending_review',
  'published',
  'rejected',
  'archived',
] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/** Statuses whose content is visible to the general catalog. */
export const CATALOG_VISIBLE_STATUSES: CourseStatus[] = ['published'];

export const LESSON_TYPES = ['video', 'text', 'quiz', 'attachment'] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

export const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const ASSET_STATUSES = ['UPLOADING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_JOB_NAME = 'process-video-asset';
export const REMINDER_JOB_NAME = 'live-class-reminder';
export const EMAIL_JOB_NAME = 'send-email';

/** Minutes before a live class starts that participants receive a reminder. */
export const REMINDER_LEAD_MINUTES = 15;

export const LIVE_CLASS_STATUSES = ['scheduled', 'live', 'completed', 'cancelled'] as const;
export type LiveClassStatus = (typeof LIVE_CLASS_STATUSES)[number];

export const ORDER_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['requires_payment', 'succeeded', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYOUT_STATUSES = ['pending', 'approved', 'paid', 'rejected'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const QUESTION_TYPES = ['single_choice', 'multi_choice', 'true_false'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CERTIFICATE_STATUSES = ['issued', 'revoked'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'course_approved',
  'course_rejected',
  'new_enrollment',
  'live_class_reminder',
  'quiz_graded',
  'certificate_issued',
  'payment_receipt',
  'payout_update',
  'announcement',
  'video_processed',
  'video_failed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Default platform commission: 15% (1500 basis points). Configurable in admin settings. */
export const DEFAULT_COMMISSION_BPS = 1500;
export const BPS_DENOMINATOR = 10_000;

/**
 * A lesson is considered complete when the learner has watched this fraction of
 * a video lesson (or explicitly marks a non-video lesson complete).
 */
export const VIDEO_COMPLETION_THRESHOLD = 0.9;

/** Progress older than this is considered stale and is re-sent by the client. */
export const PROGRESS_SAVE_INTERVAL_MS = 10_000;

export const PAGINATION_DEFAULT_LIMIT = 12;
export const PAGINATION_MAX_LIMIT = 100;

export const FREEBUFF_NONE = null;