import type {
  AssetStatus,
  CertificateStatus,
  CourseStatus,
  DifficultyLevel,
  LiveClassStatus,
  LessonType,
  NotificationType,
  OrderStatus,
  PayoutStatus,
  QuestionType,
  Role,
} from './constants';

/* ------------------------------------------------------------------ *
 * Transport envelopes
 * ------------------------------------------------------------------ */

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Array<{ path: string; message: string }>;
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export type PaginationQuery = { page?: number; limit?: number; sort?: string };

/* ------------------------------------------------------------------ *
 * Auth / profile
 * ------------------------------------------------------------------ */

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl?: string | null;
  headline?: string | null;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface AuthResponse {
  user: PublicUser;
  accessToken: string;
  /** Refresh token is delivered as an HTTP-only cookie; the value is never returned. */
  expiresInSeconds: number;
}

export interface InstructorProfileDto {
  id: string;
  userId: string;
  displayName: string;
  headline?: string | null;
  bio?: string | null;
  expertise: string[];
  website?: string | null;
  socialLinks: { label: string; url: string }[];
  approved: boolean;
  ratingAverage: number;
  ratingCount: number;
  courseCount: number;
  studentCount: number;
}

/* ------------------------------------------------------------------ *
 * Catalog / courses
 * ------------------------------------------------------------------ */

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
  courseCount: number;
  isActive: boolean;
}

export interface CourseSummaryDto {
  id: string;
  title: string;
  slug: string;
  headline?: string | null;
  thumbnailUrl?: string | null;
  priceMinor: number;
  currency: string;
  level: DifficultyLevel;
  status: CourseStatus;
  ratingAverage: number;
  ratingCount: number;
  enrollmentCount: number;
  totalDurationSeconds: number;
  lessonCount: number;
  category: { id: string; name: string; slug: string } | null;
  instructor: { id: string; name: string; avatarUrl?: string | null };
  updatedAt: string;
  isEnrolled?: boolean;
}

export interface LessonDto {
  id: string;
  sectionId: string;
  title: string;
  type: LessonType;
  order: number;
  durationSeconds: number;
  isPublished: boolean;
  isPreview: boolean;
  videoAssetId?: string | null;
  videoStatus?: AssetStatus | null;
  content?: string | null;
  resources: { id: string; title: string; fileName: string; sizeBytes: number; url: string }[];
}

export interface SectionDto {
  id: string;
  title: string;
  order: number;
  lessons: LessonDto[];
}

export interface CourseDetailDto extends CourseSummaryDto {
  description: string;
  objectives: string[];
  prerequisites: string[];
  language: string;
  sections: SectionDto[];
  instructorProfile: InstructorProfileDto | null;
  updatedAtIso: string;
  publishedAt?: string | null;
  review?: { rating: number; comment: string; createdAt: string; studentName: string }[];
  enrolled?: boolean;
  access?: { canWatch: boolean; reason: string };
  certificateRules?: {
    requireAllLessons: boolean;
    requireAllQuizzes: boolean;
    minOverallScorePercent: number | null;
  };
}

/* ------------------------------------------------------------------ *
 * Learning
 * ------------------------------------------------------------------ */

export interface EnrollmentDto {
  id: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  thumbnailUrl?: string | null;
  progressPercent: number;
  completedLessons: number;
  totalLessons: number;
  lastAccessedAt: string;
  enrolledAt: string;
}

export interface LessonProgressDto {
  lessonId: string;
  completed: boolean;
  watchedSeconds: number;
  durationSeconds: number;
  lastPositionSeconds: number;
  completedAt?: string | null;
  updatedAt: string;
}

/* ------------------------------------------------------------------ *
 * Quizzes
 * ------------------------------------------------------------------ */

export interface QuizQuestionDto {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  options: { id: string; text: string }[];
  /** Only present for instructors/admins. */
  correctOptionIds?: string[];
  explanation?: string | null;
}

export interface QuizDto {
  id: string;
  lessonId: string | null;
  title: string;
  description?: string | null;
  passScorePercent: number;
  timeLimitSeconds: number | null;
  maxAttempts: number;
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  totalPoints: number;
  questionCount: number;
  questions?: QuizQuestionDto[];
  attempts?: QuizAttemptDto[];
}

export interface QuizAttemptDto {
  id: string;
  quizId: string;
  attemptNumber: number;
  scorePercent: number;
  pointsEarned: number;
  pointsTotal: number;
  passed: boolean;
  startedAt: string;
  submittedAt: string;
  answers?: { questionId: string; correct: boolean; pointsAwarded: number }[];
}

/** What a student receives while taking a quiz — never includes correct answers. */
export interface QuizSessionDto {
  quiz: Pick<QuizDto, 'id' | 'title' | 'description' | 'passScorePercent' | 'timeLimitSeconds' | 'maxAttempts' | 'totalPoints' | 'questionCount'>;
  attemptId: string;
  attemptNumber: number;
  remainingSeconds: number | null;
  questions: {
    id: string;
    type: QuestionType;
    prompt: string;
    points: number;
    options: { id: string; text: string }[];
  }[];
}

/* ------------------------------------------------------------------ *
 * Live classes
 * ------------------------------------------------------------------ */

export interface LiveClassDto {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  description?: string | null;
  status: LiveClassStatus;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  roomName: string;
  maxParticipants: number;
  attendanceCount: number;
  isEnrolled?: boolean;
  canJoin: boolean;
}

export interface LiveClassParticipantDto {
  id: string;
  userName: string;
  avatarUrl?: string | null;
  role: Role;
  joinedAt: string | null;
  leftAt: string | null;
  attendanceSeconds: number;
}

export interface LiveChatMessageDto {
  id: string;
  liveClassId: string;
  senderName: string;
  senderRole: Role;
  message: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Certificates
 * ------------------------------------------------------------------ */

export interface CertificateDto {
  id: string;
  certificateNumber: string;
  courseId: string;
  courseTitle: string;
  studentName: string;
  instructorName: string;
  issuedAt: string;
  status: CertificateStatus;
  verificationUrl: string;
  downloadUrl: string;
  scorePercent?: number | null;
}

export interface CertificateVerificationDto {
  valid: boolean;
  certificateNumber: string;
  courseTitle?: string;
  studentName?: string;
  issuedAt?: string;
  status?: CertificateStatus;
  reason?: string;
}

/* ------------------------------------------------------------------ *
 * Payments & earnings
 * ------------------------------------------------------------------ */

export interface OrderDto {
  id: string;
  reference: string;
  courseId: string;
  courseTitle: string;
  amountMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  status: OrderStatus;
  paymentProvider: 'stripe' | 'local_test_gateway';
  createdAt: string;
  paidAt?: string | null;
}

export interface LedgerEntryDto {
  id: string;
  orderId: string;
  orderReference: string;
  courseTitle: string;
  type: 'sale' | 'commission' | 'refund' | 'fee' | 'adjustment';
  amountMinor: number;
  currency: string;
  description: string;
  createdAt: string;
}

export interface PayoutRequestDto {
  id: string;
  reference: string;
  amountMinor: number;
  currency: string;
  status: PayoutStatus;
  requestedAt: string;
  processedAt?: string | null;
  note?: string | null;
}

export interface EarningsSummaryDto {
  grossMinor: number;
  commissionMinor: number;
  refundMinor: number;
  netMinor: number;
  payableMinor: number;
  paidOutMinor: number;
  pendingPayoutMinor: number;
  currency: string;
  enrollmentCount: number;
  series: { label: string; grossMinor: number; netMinor: number }[];
}

/* ------------------------------------------------------------------ *
 * Notifications / admin
 * ------------------------------------------------------------------ */

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface AuditLogDto {
  id: string;
  actorName: string;
  actorRole: Role | 'system';
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  createdAt: string;
}

export interface PlatformSettingsDto {
  commissionBps: number;
  platformName: string;
  supportEmail: string;
  payoutThresholdMinor: number;
  autoApproveCourses: boolean;
  maintenanceMode: boolean;
}

export interface AdminStatsDto {
  users: { total: number; students: number; instructors: number; admins: number };
  courses: { total: number; published: number; pendingReview: number; rejected: number };
  enrollments: { total: number; last30Days: number };
  revenue: { grossMinor: number; refundedMinor: number; currency: string };
  mediaQueue: { queued: number; processing: number; failed: number };
  liveClasses: { scheduled: number; completed: number };
}