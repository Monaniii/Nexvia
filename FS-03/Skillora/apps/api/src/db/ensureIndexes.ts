import { logger } from '../lib/logger';
import {
  User,
  RefreshToken,
  AuthToken,
  InstructorProfile,
  Notification,
  AuditLog,
} from '../models/identity';
import {
  Category,
  Course,
  CourseSection,
  Lesson,
  VideoAsset,
  Enrollment,
  LessonProgress,
  CourseReview,
} from '../models/course';
import { Quiz, QuizAttempt, Certificate } from '../models/learning';
import { LiveClass, LiveClassParticipant, LiveChatMessage } from '../models/live';
import {
  Order,
  Payment,
  Refund,
  InstructorLedgerEntry,
  PayoutRequest,
  WebhookEvent,
  PlatformSettings,
} from '../models/financial';

const MODELS = [
  // identity
  User,
  RefreshToken,
  AuthToken,
  InstructorProfile,
  Notification,
  AuditLog,
  // courses
  Category,
  Course,
  CourseSection,
  Lesson,
  VideoAsset,
  Enrollment,
  LessonProgress,
  CourseReview,
  // learning
  Quiz,
  QuizAttempt,
  Certificate,
  // live
  LiveClass,
  LiveClassParticipant,
  LiveChatMessage,
  // financial
  Order,
  Payment,
  Refund,
  InstructorLedgerEntry,
  PayoutRequest,
  WebhookEvent,
  PlatformSettings,
];

/**
 * Creates every index declared in the schemas (idempotent).
 *
 * We deliberately use createIndexes rather than syncIndexes so an existing
 * production index that is not declared in code is never dropped implicitly.
 */
export async function ensureIndexes(): Promise<void> {
  const started = Date.now();
  let created = 0;
  const failures: string[] = [];

  for (const model of MODELS) {
    try {
      const result = await model.createIndexes();
      created += Array.isArray(result) ? result.length : 0;
    } catch (err) {
      failures.push(`${model.modelName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logger.info(
    { indexesChecked: created, ms: Date.now() - started, failures: failures.length },
    'Index bootstrap complete',
  );
  if (failures.length) {
    logger.warn({ failures }, 'Some index creations failed');
  }
}