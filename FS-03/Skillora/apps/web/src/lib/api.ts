const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '');
let accessToken: string | null = null;
let refreshInFlight: Promise<AuthData | null> | null = null;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'instructor' | 'admin';
  avatarUrl?: string | null;
  headline?: string | null;
  isVerified: boolean;
}

export interface AuthData {
  user: AuthUser;
  accessToken: string;
  expiresInSeconds: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
  courseCount: number;
  isActive: boolean;
}

export interface Course {
  id: string;
  title: string;
  slug: string;
  headline?: string | null;
  thumbnailUrl?: string | null;
  priceMinor: number;
  currency: string;
  level: string;
  status: string;
  ratingAverage: number;
  ratingCount: number;
  enrollmentCount: number;
  totalDurationSeconds: number;
  lessonCount: number;
  category: { id: string; name: string; slug: string } | null;
  instructor: { id: string; name: string; avatarUrl?: string | null };
  isEnrolled?: boolean;
}

export interface Lesson {
  id: string;
  sectionId: string;
  title: string;
  type: 'video' | 'text' | 'quiz' | 'attachment';
  order: number;
  durationSeconds: number;
  isPublished: boolean;
  isPreview: boolean;
  content?: string | null;
  videoStatus?: string | null;
  resources: { id: string; title: string; fileName: string; sizeBytes: number; url: string }[];
}

export interface CourseDetail extends Course {
  description: string;
  objectives: string[];
  prerequisites: string[];
  language: string;
  instructorProfile: {
    displayName: string;
    headline?: string | null;
    bio?: string | null;
    ratingAverage: number;
    studentCount: number;
  } | null;
  sections: { id: string; title: string; order: number; lessons: Lesson[] }[];
  review?: { rating: number; comment: string; createdAt: string; studentName: string }[];
  enrolled?: boolean;
  access?: { canWatch: boolean; reason: string };
}

export interface Enrollment {
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

export interface LessonPlayer {
  lesson: {
    id: string;
    title: string;
    type: Lesson['type'];
    content: string | null;
    durationSeconds: number;
    sectionId: string;
    resources: Lesson['resources'];
  };
  quiz: {
    id: string;
    title: string;
    description: string | null;
    passScorePercent: number;
    timeLimitSeconds: number | null;
    maxAttempts: number;
    totalPoints: number;
    questionCount: number;
  } | null;
  video: {
    status: string;
    posterUrl: string | null;
    playlistUrl: string | null;
    durationSeconds: number;
    error: string | null;
  } | null;
  progress: {
    completed: boolean;
    lastPositionSeconds: number;
    watchedSeconds: number;
    durationSeconds: number;
  };
  canWatch: boolean;
}

export interface QuizSession {
  quiz: { title: string; passScorePercent: number; timeLimitSeconds: number | null; maxAttempts: number };
  attemptId: string;
  attemptNumber: number;
  remainingSeconds: number | null;
  questions: {
    id: string;
    type: 'single_choice' | 'multi_choice' | 'true_false';
    prompt: string;
    points: number;
    options: { id: string; text: string }[];
  }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function dataFrom<T>(body: unknown): T {
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new ApiError('The server returned an unexpected response.', 502);
  }
  return (body as { data: T }).data;
}

async function errorFrom(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status}).`;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    message = body.error?.message ?? message;
  } catch {
    // Non-JSON errors are reported with the HTTP status.
  }
  return new ApiError(message, response.status);
}

function applyAuth(data: AuthData): AuthData {
  accessToken = data.accessToken;
  return data;
}

async function refreshSession(): Promise<AuthData | null> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (response) => {
        if (response.status === 401) {
          accessToken = null;
          return null;
        }
        if (!response.ok) throw await errorFrom(response);
        return applyAuth(dataFrom<AuthData>(await response.json()));
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function restoreSession(): Promise<AuthData | null> {
  return refreshSession();
}

export function setSession(data: AuthData): AuthData {
  return applyAuth(data);
}

export function clearSession(): void {
  accessToken = null;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const send = () =>
    fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  let response = await send();
  if (response.status === 401 && auth && accessToken) {
    const refreshed = await refreshSession();
    if (refreshed) response = await send();
  }
  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;
  return dataFrom<T>(await response.json());
}

export function formatPrice(priceMinor: number, currency = 'USD'): string {
  if (priceMinor === 0) return 'Free';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(priceMinor / 100);
  } catch {
    return `${(priceMinor / 100).toFixed(2)} ${currency}`;
  }
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'Self-paced';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes ? `${minutes}m` : ''}`.trim() : `${minutes} min`;
}
