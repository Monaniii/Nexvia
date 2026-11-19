import { Types } from 'mongoose';
import type { QuizSubmissionInput, QuizUpsertInput, Role } from '@skillora/shared';
import { Course, Lesson, LessonProgress } from '../models/course';
import { Quiz, QuizAttempt } from '../models/learning';
import { errors } from '../lib/errors';
import { resolveCourseAccess } from './enrollment.service';
import { createNotification } from '../models/identity';
import { recomputeEnrollmentProgress } from './enrollment.service';

function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

function totalPoints(questions: { points: number }[]): number {
  return questions.reduce((sum, q) => sum + (q.points ?? 1), 0);
}

/* ------------------------------------------------------------------ *
 * Instructor: build / edit quizzes
 * ------------------------------------------------------------------ */
export async function upsertQuiz(
  courseId: string,
  input: QuizUpsertInput,
): Promise<any> {
  const course = await Course.findById(courseId).lean();
  if (!course) throw errors.notFound('Course not found');

  if (input.lessonId) {
    const lesson = await Lesson.findOne({ _id: input.lessonId, course: course._id })
      .select('_id')
      .lean();
    if (!lesson) throw errors.notFound('Lesson not found in this course');
  }

  const questions = input.questions.map((q) => ({
    ...q,
    id: new Types.ObjectId().toHexString(),
  }));

  const quiz = await Quiz.create({
    course: course._id,
    lesson: input.lessonId ? oid(input.lessonId) : null,
    title: input.title,
    description: input.description ?? null,
    passScorePercent: input.passScorePercent,
    timeLimitSeconds: input.timeLimitSeconds,
    maxAttempts: input.maxAttempts,
    randomizeQuestions: input.randomizeQuestions,
    randomizeOptions: input.randomizeOptions,
    questions,
    totalPoints: totalPoints(questions),
  });
  return quiz;
}

export async function updateQuiz(quizId: string, input: Partial<QuizUpsertInput>) {
  const quiz = await Quiz.findById(quizId);
  if (!quiz) throw errors.notFound('Quiz not found');

  if (input.questions) {
    const questions = input.questions.map((q) => ({
      ...q,
      id: new Types.ObjectId().toHexString(),
    }));
    quiz.questions = questions as never;
    quiz.totalPoints = totalPoints(questions);
  }
  const scalar: (keyof typeof input)[] = [
    'title',
    'description',
    'passScorePercent',
    'timeLimitSeconds',
    'maxAttempts',
    'randomizeQuestions',
    'randomizeOptions',
  ];
  for (const key of scalar) {
    if (key in input) (quiz as any)[key] = input[key];
  }
  await quiz.save();
  return quiz;
}

export async function deleteQuiz(quizId: string): Promise<void> {
  const quiz = await Quiz.findById(quizId);
  if (!quiz) throw errors.notFound('Quiz not found');
  await QuizAttempt.deleteMany({ quiz: quiz._id });
  await quiz.deleteOne();
}

export async function listCourseQuizzes(courseId: string) {
  return Quiz.find({ course: oid(courseId) }).sort({ createdAt: 1 }).lean();
}

export async function getQuizForManagement(quizId: string) {
  const quiz = await Quiz.findById(quizId).lean();
  if (!quiz) throw errors.notFound('Quiz not found');
  return quiz;
}

/* ------------------------------------------------------------------ *
 * Student: take a quiz
 * ------------------------------------------------------------------ */
/** Shapes a quiz for a student — correct answers and explanations are stripped. */
function studentSession(quiz: any, attempt: any, now = Date.now()) {
  const shuffled = quiz.randomizeQuestions ? shuffle([...quiz.questions]) : quiz.questions;
  return {
    quiz: {
      id: String(quiz._id),
      title: quiz.title,
      description: quiz.description ?? null,
      passScorePercent: quiz.passScorePercent,
      timeLimitSeconds: quiz.timeLimitSeconds ?? null,
      maxAttempts: quiz.maxAttempts,
      totalPoints: quiz.totalPoints,
      questionCount: quiz.questions.length,
    },
    attemptId: String(attempt._id),
    attemptNumber: attempt.attemptNumber,
    remainingSeconds: quiz.timeLimitSeconds
      ? Math.max(0, Math.round(quiz.timeLimitSeconds - (now - new Date(attempt.startedAt).getTime()) / 1000))
      : null,
    questions: shuffled.map((q: any) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      points: q.points,
      options: quiz.randomizeOptions ? shuffle([...q.options]) : q.options,
      // NOTE: correctOptionIds and explanation are intentionally omitted
    })),
  };
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Starts (or resumes) an attempt. Enforces attempt limits and validates course
 * access. Never returns correct answers.
 */
export async function startAttempt(userId: string, quizId: string, role: Role) {
  const quiz = await Quiz.findById(quizId).lean();
  if (!quiz || !quiz.isActive) throw errors.notFound('Quiz not found');

  const access = await resolveCourseAccess(userId, String(quiz.course), role);
  if (!access.canWatch) throw errors.forbidden('You do not have access to this course');

  // Resume an in-progress attempt (double click / reconnect safety).
  const inProgress = await QuizAttempt.findOne({
    quiz: quiz._id,
    user: oid(userId),
    status: 'in_progress',
  }).lean();
  if (inProgress) {
    const expired =
      quiz.timeLimitSeconds &&
      Date.now() - new Date(inProgress.startedAt).getTime() > quiz.timeLimitSeconds * 1000;
    if (expired) {
      await gradeAttempt(String(inProgress._id), [], { expired: true });
      // fall through to start a fresh attempt if allowed
    } else {
      return studentSession(quiz, inProgress);
    }
  }

  const usedAttempts = await QuizAttempt.countDocuments({ quiz: quiz._id, user: oid(userId) });
  if (usedAttempts >= quiz.maxAttempts) {
    throw errors.precondition(`Attempt limit reached (${quiz.maxAttempts})`);
  }

  const attempt = await QuizAttempt.create({
    quiz: quiz._id,
    user: oid(userId),
    course: quiz.course,
    attemptNumber: usedAttempts + 1,
    status: 'in_progress',
    pointsTotal: quiz.totalPoints,
    questionSnapshot: quiz.questions,
    startedAt: new Date(),
  });

  return studentSession(quiz, attempt);
}

/**
 * Grades a submission on the backend.
 *
 * - Answers are matched against the *snapshot* taken at attempt start, so later
 *   instructor edits cannot change an in-flight grade.
 * - Duplicate submissions are rejected (unique index + status check).
 * - The score is written once and never becomes editable afterwards.
 */
export async function submitAttempt(userId: string, quizId: string, input: QuizSubmissionInput) {
  const attempt = await QuizAttempt.findOne({
    quiz: oid(quizId),
    user: oid(userId),
    status: 'in_progress',
  });
  if (!attempt) throw errors.conflict('No attempt is in progress for this quiz');

  const quiz = await Quiz.findById(quizId).lean();
  if (!quiz) throw errors.notFound('Quiz not found');

  const elapsedMs = Date.now() - new Date(attempt.startedAt).getTime();
  const timedOut = quiz.timeLimitSeconds ? elapsedMs > quiz.timeLimitSeconds * 1000 + 5000 : false;

  return gradeAttempt(String(attempt._id), input.answers, { expired: timedOut });
}

export async function gradeAttempt(
  attemptId: string,
  answers: { questionId: string; optionIds: string[] }[],
  opts: { expired?: boolean } = {},
): Promise<any> {
  const attempt = await QuizAttempt.findById(attemptId);
  if (!attempt) throw errors.notFound('Attempt not found');
  if (attempt.status === 'graded') throw errors.conflict('This attempt has already been graded');

  const questions: any[] = (attempt.questionSnapshot as any[])?.length
    ? (attempt.questionSnapshot as any[])
    : [];

  const answerMap = new Map<string, string[]>();
  for (const a of answers) answerMap.set(a.questionId, [...new Set(a.optionIds ?? [])]);

  let earned = 0;
  const gradedAnswers = questions.map((q) => {
    const selected = answerMap.get(q.id) ?? [];
    const correctSet = new Set<string>(q.correctOptionIds ?? []);
    let correct = false;
    let points = 0;

    if (!opts.expired) {
      if (q.type === 'multi_choice') {
        const selectedSet = new Set(selected);
        correct =
          selectedSet.size === correctSet.size && [...correctSet].every((id) => selectedSet.has(id));
      } else {
        correct = selected.length === 1 && correctSet.has(selected[0]);
      }
      if (correct) points = q.points ?? 1;
    }
    earned += points;
    return {
      questionId: q.id,
      selectedOptionIds: selected,
      correct,
      pointsAwarded: points,
    };
  });

  const pointsTotal = questions.reduce((sum, q) => sum + (q.points ?? 1), 0);
  const scorePercent = pointsTotal > 0 ? Math.round((earned / pointsTotal) * 100) : 0;
  const passThreshold = await getPassThreshold(attempt);
  const passed = !opts.expired && scorePercent >= passThreshold;

  attempt.answers = gradedAnswers as never;
  attempt.pointsEarned = earned;
  attempt.pointsTotal = pointsTotal;
  attempt.scorePercent = scorePercent;
  attempt.passed = passed;
  attempt.status = 'graded';
  attempt.submittedAt = new Date();
  await attempt.save();

  if (passed) {
    const quiz = await Quiz.findById(attempt.quiz).select('lesson course').lean();
    if (quiz?.lesson) {
      const lesson = await Lesson.findOne({ _id: quiz.lesson, course: quiz.course })
        .select('_id durationSeconds')
        .lean();
      if (lesson) {
        await LessonProgress.findOneAndUpdate(
          { user: attempt.user, lesson: lesson._id },
          {
            $set: {
              completed: true,
              completedAt: new Date(),
              course: quiz.course,
              durationSeconds: lesson.durationSeconds ?? 0,
            },
          },
          { upsert: true, new: true },
        );
        await recomputeEnrollmentProgress(String(attempt.user), String(quiz.course));
      }
    }
    await createNotification({
      user: String(attempt.user),
      type: 'quiz_graded',
      title: 'Quiz passed',
      body: `You scored ${scorePercent}% on "${await quizTitle(String(attempt.quiz))}".`,
      link: `/learn/${String(attempt.course)}`,
    });
  }

  return {
    id: String(attempt._id),
    attemptNumber: attempt.attemptNumber,
    scorePercent,
    pointsEarned: earned,
    pointsTotal,
    passed,
    graded: gradedAnswers.map((a) => ({ questionId: a.questionId, correct: a.correct, pointsAwarded: a.pointsAwarded })),
  };
}

async function getPassThreshold(attempt: any): Promise<number> {
  const quiz = await Quiz.findById(attempt.quiz).select('passScorePercent').lean();
  return quiz?.passScorePercent ?? 60;
}

async function quizTitle(quizId: string): Promise<string> {
  const quiz = await Quiz.findById(quizId).select('title').lean();
  return quiz?.title ?? 'Quiz';
}

/* ------------------------------------------------------------------ *
 * Results & history
 * ------------------------------------------------------------------ */
export async function getAttemptHistory(userId: string, quizId: string) {
  const attempts = await QuizAttempt.find({
    quiz: oid(quizId),
    user: oid(userId),
    status: 'graded',
  })
    .sort({ attemptNumber: 1 })
    .lean();

  const quiz = await Quiz.findById(quizId).lean();
  return {
    quizId,
    title: quiz?.title ?? 'Quiz',
    passScorePercent: quiz?.passScorePercent ?? 60,
    maxAttempts: quiz?.maxAttempts ?? 1,
    attempts: attempts.map((a) => ({
      id: String(a._id),
      attemptNumber: a.attemptNumber,
      scorePercent: a.scorePercent,
      pointsEarned: a.pointsEarned,
      pointsTotal: a.pointsTotal,
      passed: a.passed,
      startedAt: new Date(a.startedAt).toISOString(),
      submittedAt: a.submittedAt ? new Date(a.submittedAt).toISOString() : null,
      answers: (a.answers ?? []).map((x: any) => ({
        questionId: x.questionId,
        correct: x.correct,
        pointsAwarded: x.pointsAwarded,
      })),
    })),
    bestScorePercent: attempts.reduce((max, a) => Math.max(max, a.scorePercent), 0),
    passed: attempts.some((a) => a.passed),
  };
}

/** Instructor view: aggregate performance across attempts. */
export async function getQuizAnalytics(quizId: string) {
  const quiz = await Quiz.findById(quizId).lean();
  if (!quiz) throw errors.notFound('Quiz not found');
  const attempts = await QuizAttempt.find({ quiz: quiz._id, status: 'graded' }).lean();
  const attemptsByQuestion = new Map<string, { total: number; correct: number }>();

  for (const attempt of attempts) {
    for (const answer of (attempt.answers ?? []) as any[]) {
      const entry = attemptsByQuestion.get(answer.questionId) ?? { total: 0, correct: 0 };
      entry.total += 1;
      if (answer.correct) entry.correct += 1;
      attemptsByQuestion.set(answer.questionId, entry);
    }
  }

  const questionStats = (quiz.questions ?? []).map((q: any) => {
    const stat = attemptsByQuestion.get(q.id) ?? { total: 0, correct: 0 };
    return {
      questionId: q.id,
      prompt: q.prompt,
      attempts: stat.total,
      correctRatePercent: stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0,
    };
  });

  return {
    quizId,
    title: quiz.title,
    attemptCount: attempts.length,
    averageScorePercent: attempts.length
      ? Math.round(attempts.reduce((s, a) => s + a.scorePercent, 0) / attempts.length)
      : 0,
    passRatePercent: attempts.length
      ? Math.round((attempts.filter((a) => a.passed).length / attempts.length) * 100)
      : 0,
    questionStats,
  };
}

/**
 * Aggregate for certificate eligibility: how many required quizzes passed.
 */
export async function getQuizCompletionForCourse(userId: string, courseId: string) {
  const quizzes = await Quiz.find({ course: oid(courseId), isActive: true }).lean();
  const attempts = await QuizAttempt.find({
    quiz: { $in: quizzes.map((q) => q._id) },
    user: oid(userId),
    status: 'graded',
    passed: true,
  })
    .select('quiz scorePercent')
    .lean();

  const passedSet = new Set(attempts.map((a) => String(a.quiz)));
  const passedQuizzes = quizzes.filter((q) => passedSet.has(String(q._id)));
  const scores = attempts.map((a) => a.scorePercent);
  const average = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0;

  return {
    requiredQuizCount: quizzes.length,
    passedRequiredQuizzes: passedQuizzes.length,
    averageScorePercent: average,
    allPassed: quizzes.length > 0 ? passedQuizzes.length === quizzes.length : true,
  };
}

export function isQuizLessonCompleted(
  lessonId: string,
  passedQuizIds: Set<string>,
  quizzesByLesson: Map<string, string>,
): boolean {
  const quizId = quizzesByLesson.get(lessonId);
  return quizId ? passedQuizIds.has(quizId) : false;
}
