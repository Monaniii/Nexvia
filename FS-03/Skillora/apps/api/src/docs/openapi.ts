import { env, integrationStatus } from '../config/env';

type Json = Record<string, any>;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const okResp = (data: Json, description = 'Success'): Json => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data,
          meta: { type: 'object', description: 'Pagination or auxiliary metadata' },
        },
      },
    },
  },
});

const errResp = (description: string): Json => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorEnvelope' },
      example: {
        success: false,
        error: { code: 'FORBIDDEN', message: description, details: [] },
      },
    },
  },
});

const commonErrors = (opts: { noAuth?: boolean; noNotFound?: boolean } = {}): Json => {
  const r: Json = {
    '400': errResp('Validation failed'),
    '429': errResp('Rate limit exceeded'),
  };
  if (!opts.noAuth) {
    r['401'] = errResp('Missing or invalid access token');
    r['403'] = errResp('Insufficient role or ownership for this resource');
  }
  if (!opts.noNotFound) r['404'] = errResp('Resource not found');
  return r;
};

const p = (name: string, description?: string, schema: Json = { type: 'string' }): Json => ({
  name,
  in: 'path',
  required: true,
  description,
  schema,
});

const q = (name: string, schema: Json, description?: string, required = false): Json => ({
  name,
  in: 'query',
  required,
  description,
  schema,
});

const body = (schema: Json, example?: Json): Json => ({
  required: true,
  content: { 'application/json': { schema, ...(example ? { example } : {}) } },
});

const ok200 = (data: Json, description?: string): Json => ({
  '200': okResp(data, description),
});

const ok201 = (data: Json, description?: string): Json => ({
  '201': okResp(data, description),
});

const op = (
  summary: string,
  tag: string,
  opts: {
    description?: string;
    security?: Json[] | false;
    parameters?: Json[];
    requestBody?: Json;
    responses?: Json;
    role?: string;
  } = {},
): Json => {
  const operation: Json = {
    summary,
    tags: [tag],
    description: [opts.role ? `**Role:** ${opts.role}` : null, opts.description ?? null]
      .filter(Boolean)
      .join('\n\n') || undefined,
    responses: {
      ...(opts.responses ?? { '200': okResp({ type: 'object' }) }),
      ...commonErrors({
        noAuth: opts.security === false,
        noNotFound: !opts.parameters?.some((param) => param.in === 'path'),
      }),
    },
  };
  if (opts.security === false) operation.security = [];
  if (opts.parameters?.length) operation.parameters = opts.parameters;
  if (opts.requestBody) operation.requestBody = opts.requestBody;
  return operation;
};

/* ------------------------------------------------------------------ */
/* Reusable schemas                                                    */
/* ------------------------------------------------------------------ */

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });

const schemas: Json = {
  RegisterRequest: {
    type: 'object',
    required: ['name', 'email', 'password'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 80, example: 'Ada Lovelace' },
      email: { type: 'string', format: 'email', example: 'ada@example.com' },
      password: { type: 'string', minLength: 8, maxLength: 128, format: 'password' },
      role: { type: 'string', enum: ['student', 'instructor'], default: 'student' },
      headline: { type: 'string', maxLength: 160, nullable: true },
    },
  },
  LoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', format: 'password' },
    },
  },
  QuizUpsert: {
    type: 'object',
    required: ['title', 'questions'],
    description: 'Instructor payload; includes correct answers (never returned to students).',
    properties: {
      title: { type: 'string', minLength: 2, maxLength: 140 },
      description: { type: 'string', nullable: true },
      passScorePercent: { type: 'integer', minimum: 0, maximum: 100, default: 60 },
      timeLimitSeconds: { type: 'integer', nullable: true, default: null },
      maxAttempts: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
      randomizeQuestions: { type: 'boolean', default: false },
      randomizeOptions: { type: 'boolean', default: false },
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          required: ['prompt', 'type', 'options', 'correctOptionIds'],
          properties: {
            prompt: { type: 'string' },
            type: { type: 'string', enum: ['single', 'multi', 'boolean'] },
            points: { type: 'integer', minimum: 1, default: 1 },
            options: {
              type: 'array',
              items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } } },
            },
            correctOptionIds: { type: 'array', items: { type: 'string' } },
            explanation: { type: 'string', nullable: true },
          },
        },
      },
    },
  },
  ChatMessage: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      liveClassId: { type: 'string' },
      user: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } } },
      message: { type: 'string', maxLength: 2000 },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  ErrorEnvelope: {
    type: 'object',
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: {
            type: 'string',
            example: 'VALIDATION_ERROR',
            enum: [
              'VALIDATION_ERROR',
              'UNAUTHORIZED',
              'FORBIDDEN',
              'NOT_FOUND',
              'CONFLICT',
              'RATE_LIMITED',
              'PAYMENT_FAILED',
              'INTERNAL_ERROR',
            ],
          },
          message: { type: 'string' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
      },
    },
  },
  Page: {
    type: 'object',
    properties: {
      page: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 20 },
      total: { type: 'integer', example: 100 },
      totalPages: { type: 'integer', example: 5 },
      hasMore: { type: 'boolean', example: true },
    },
  },
  User: {
    type: 'object',
    properties: {
      id: { type: 'string', example: '6610f1a2b3c4d5e6f7a8b9c0' },
      name: { type: 'string', example: 'Ada Lovelace' },
      email: { type: 'string', format: 'email', example: 'ada@example.com' },
      role: { type: 'string', enum: ['student', 'instructor', 'admin'] },
      isVerified: { type: 'boolean' },
      isActive: { type: 'boolean' },
      instructorApproved: { type: 'boolean' },
      avatarUrl: { type: 'string', nullable: true },
      headline: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  AuthSession: {
    type: 'object',
    properties: {
      user: ref('User'),
      accessToken: {
        type: 'string',
        description: 'Short-lived JWT (also set as an HTTP-only cookie)',
        example: 'eyJhbGciOi...',
      },
      expiresInSeconds: { type: 'integer', example: 900 },
    },
  },
  Category: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string', example: 'Web Development' },
      slug: { type: 'string', example: 'web-development' },
      icon: { type: 'string' },
      courseCount: { type: 'integer' },
    },
  },
  CourseSummary: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string', example: 'Modern React from Zero' },
      slug: { type: 'string' },
      headline: { type: 'string', nullable: true },
      thumbnailUrl: { type: 'string', nullable: true },
      priceMinor: { type: 'integer', example: 4999 },
      currency: { type: 'string', example: 'USD' },
      level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
      ratingAvg: { type: 'number', example: 4.7 },
      ratingCount: { type: 'integer' },
      enrollmentCount: { type: 'integer' },
      durationSeconds: { type: 'integer' },
      instructor: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
      status: {
        type: 'string',
        enum: ['draft', 'pending', 'published', 'rejected', 'archived'],
      },
    },
  },
  CourseDetail: {
    allOf: [
      ref('CourseSummary'),
      {
        type: 'object',
        properties: {
          description: { type: 'string' },
          objectives: { type: 'array', items: { type: 'string' } },
          prerequisites: { type: 'array', items: { type: 'string' } },
          language: { type: 'string' },
          category: ref('Category'),
          sections: { type: 'array', items: ref('Section') },
          reviews: { type: 'array', items: ref('Review') },
        },
      },
    ],
  },
  Section: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string', example: 'Getting Started' },
      order: { type: 'integer' },
      lessons: { type: 'array', items: ref('Lesson') },
    },
  },
  Lesson: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string', example: 'Installing the toolchain' },
      type: { type: 'string', enum: ['video', 'text', 'quiz', 'attachment'] },
      order: { type: 'integer' },
      durationSeconds: { type: 'integer' },
      isPreview: { type: 'boolean' },
      isPublished: { type: 'boolean' },
      content: { type: 'string', nullable: true },
      videoStatus: {
        type: 'string',
        nullable: true,
        enum: ['UPLOADING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED'],
      },
    },
  },
  Review: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      rating: { type: 'integer', minimum: 1, maximum: 5 },
      comment: { type: 'string', nullable: true },
      user: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Enrollment: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      course: ref('CourseSummary'),
      status: { type: 'string', enum: ['active', 'refunded', 'revoked'] },
      progressPercent: { type: 'integer', example: 42 },
      completedLessons: { type: 'integer' },
      enrolledAt: { type: 'string', format: 'date-time' },
      lastAccessedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  Progress: {
    type: 'object',
    properties: {
      courseId: { type: 'string' },
      completedLessonIds: { type: 'array', items: { type: 'string' } },
      progressPercent: { type: 'integer' },
      completedAt: { type: 'string', format: 'date-time', nullable: true },
      certificateEligible: { type: 'boolean' },
    },
  },
  Quiz: {
    type: 'object',
    description: 'Quiz metadata; correct answers are never included for students',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      passScorePercent: { type: 'integer' },
      maxAttempts: { type: 'integer' },
      timeLimitSeconds: { type: 'integer', nullable: true },
      questionCount: { type: 'integer' },
      course: { type: 'string' },
    },
  },
  QuizAttempt: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      quizId: { type: 'string' },
      attemptNumber: { type: 'integer' },
      scorePercent: { type: 'integer' },
      passed: { type: 'boolean' },
      startedAt: { type: 'string', format: 'date-time' },
      submittedAt: { type: 'string', format: 'date-time', nullable: true },
      answers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            questionId: { type: 'string' },
            optionIds: { type: 'array', items: { type: 'string' } },
            correct: { type: 'boolean' },
            pointsAwarded: { type: 'number' },
          },
        },
      },
    },
  },
  Certificate: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      certificateNumber: { type: 'string', example: 'SKL-2026-4F9A-1C7E' },
      courseTitle: { type: 'string' },
      studentName: { type: 'string' },
      issuedAt: { type: 'string', format: 'date-time' },
      revoked: { type: 'boolean' },
      verifyUrl: { type: 'string', example: 'https://skillora.local/verify/SKL-2026-4F9A-1C7E' },
    },
  },
  LiveClass: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      courseId: { type: 'string' },
      status: { type: 'string', enum: ['scheduled', 'live', 'completed', 'cancelled'] },
      startsAt: { type: 'string', format: 'date-time' },
      endsAt: { type: 'string', format: 'date-time' },
      maxParticipants: { type: 'integer' },
      participantCount: { type: 'integer' },
      roomName: { type: 'string', nullable: true },
    },
  },
  RoomToken: {
    type: 'object',
    description: 'LiveKit join credentials for an authorized participant',
    properties: {
      token: { type: 'string' },
      wsUrl: { type: 'string', nullable: true },
      roomName: { type: 'string' },
      role: { type: 'string', enum: ['host', 'participant'] },
      integrationMode: { type: 'string', enum: ['livekit', 'unconfigured'] },
    },
  },
  Order: {
    type: 'object',
    properties: {
      reference: { type: 'string', example: 'ord_9f8e7d6c5b' },
      course: ref('CourseSummary'),
      grossMinor: { type: 'integer', example: 4999 },
      commissionMinor: { type: 'integer', example: 750 },
      netMinor: { type: 'integer', example: 4249 },
      currency: { type: 'string', example: 'USD' },
      status: {
        type: 'string',
        enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
      },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  LedgerEntry: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      type: { type: 'string', enum: ['sale', 'commission', 'refund', 'adjustment', 'payout'] },
      amountMinor: { type: 'integer' },
      currency: { type: 'string' },
      orderReference: { type: 'string', nullable: true },
      description: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  EarningsSummary: {
    type: 'object',
    properties: {
      grossMinor: { type: 'integer' },
      commissionMinor: { type: 'integer' },
      refundMinor: { type: 'integer' },
      netMinor: { type: 'integer' },
      payableMinor: { type: 'integer', description: 'Net minus already-paid payouts' },
      currency: { type: 'string' },
      byCourse: { type: 'array', items: { type: 'object' } },
    },
  },
  PayoutRequest: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      amountMinor: { type: 'integer' },
      status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'paid'] },
      note: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      decidedAt: { type: 'string', format: 'date-time', nullable: true },
      simulated: { type: 'boolean', example: true },
    },
  },
  Notification: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      type: { type: 'string', example: 'live_class_reminder' },
      title: { type: 'string' },
      body: { type: 'string' },
      read: { type: 'boolean' },
      link: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  AuditLog: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      actor: { type: 'object', properties: { id: { type: 'string' }, role: { type: 'string' } } },
      action: { type: 'string', example: 'course.moderate' },
      target: { type: 'object', properties: { type: { type: 'string' }, id: { type: 'string' } } },
      ip: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  MediaAsset: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      lessonId: { type: 'string' },
      status: {
        type: 'string',
        enum: ['UPLOADING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED'],
      },
      progressPercent: { type: 'integer' },
      durationSeconds: { type: 'number' },
      renditions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', example: '720p' },
            width: { type: 'integer' },
            height: { type: 'integer' },
            bitrateKbps: { type: 'integer' },
          },
        },
      },
      thumbnailUrl: { type: 'string', nullable: true },
      error: { type: 'string', nullable: true },
      attempts: { type: 'integer' },
    },
  },
};

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

function buildPaths(): Json {
  const authTag = 'Auth';
  const catalogTag = 'Catalog';
  const instructorTag = 'Instructor';
  const learningTag = 'Learning';
  const mediaTag = 'Media';
  const quizTag = 'Quizzes';
  const liveTag = 'Live Classes';
  const certTag = 'Certificates';
  const paymentTag = 'Payments';
  const adminTag = 'Admin';
  const systemTag = 'System';

  const paths: Json = {};

  const add = (path: string, method: string, operation: Json): void => {
    paths[path] = paths[path] ?? {};
    paths[path][method] = operation;
  };

  /* ----------------------------- Auth ---------------------------- */

  add('/register', 'post', op('Register a new account', authTag, {
    security: false,
    requestBody: body(ref('RegisterRequest'), {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Str0ng!Passw0rd',
      role: 'student',
    }),
    responses: ok201(ref('AuthSession'), 'Account created; session issued'),
  }));
  add('/login', 'post', op('Log in and issue a session', authTag, {
    security: false,
    requestBody: body(ref('LoginRequest'), {
      email: 'ada@example.com',
      password: 'Str0ng!Passw0rd',
    }),
    responses: ok200(ref('AuthSession')),
  }));
  add('/refresh', 'post', op('Rotate the refresh token and get a new access token', authTag, {
    security: false,
    description: 'Uses the HTTP-only refresh cookie. Rotation revokes the presented token.',
    responses: ok200(ref('AuthSession')),
  }));
  add('/logout', 'post', op('Log out the current session', authTag, {
    responses: ok200({ type: 'object', properties: { loggedOut: { type: 'boolean' } } }),
  }));
  add('/logout-all', 'post', op('Revoke every session for the current user', authTag, {
    responses: ok200({ type: 'object', properties: { revoked: { type: 'integer' } } }),
  }));
  add('/forgot-password', 'post', op('Request a password-reset token', authTag, {
    security: false,
    description: 'Always returns 200 to avoid disclosing whether an email exists.',
    requestBody: body({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } }),
    responses: ok200({ type: 'object', properties: { accepted: { type: 'boolean' } } }),
  }));
  add('/reset-password', 'post', op('Reset a password with a single-use token', authTag, {
    security: false,
    requestBody: body({
      type: 'object',
      required: ['token', 'password'],
      properties: { token: { type: 'string' }, password: { type: 'string', minLength: 8 } },
    }),
    responses: ok200({ type: 'object', properties: { reset: { type: 'boolean' } } }),
  }));
  add('/verify-email', 'post', op('Request an email-verification token', authTag, {
    responses: ok200({ type: 'object', properties: { sent: { type: 'boolean' } } }),
  }));
  add('/verify-email/{token}', 'get', op('Verify an email address', authTag, {
    security: false,
    parameters: [p('token')],
    responses: ok200({ type: 'object', properties: { verified: { type: 'boolean' } } }),
  }));
  add('/change-password', 'post', op('Change password using the current password', authTag, {
    requestBody: body({
      type: 'object',
      required: ['currentPassword', 'newPassword'],
      properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string', minLength: 8 } },
    }),
    responses: ok200({ type: 'object', properties: { changed: { type: 'boolean' } } }),
  }));
  add('/me', 'get', op('Get the current user profile', authTag, {
    responses: ok200(ref('User')),
  }));
  add('/me', 'patch', op('Update the current user profile', authTag, {
    requestBody: body({
      type: 'object',
      properties: {
        name: { type: 'string' },
        avatarUrl: { type: 'string', nullable: true },
        headline: { type: 'string', nullable: true },
        bio: { type: 'string', nullable: true },
        website: { type: 'string', nullable: true },
        expertise: { type: 'array', items: { type: 'string' } },
        socialLinks: { type: 'array', items: { type: 'object' } },
      },
    }),
    responses: ok200(ref('User')),
  }));

  /* --------------------------- Catalog --------------------------- */

  add('/categories', 'get', op('List categories', catalogTag, {
    security: false,
    responses: ok200({ type: 'array', items: ref('Category') }),
  }));
  add('/courses', 'get', op('Search and filter published courses', catalogTag, {
    security: false,
    description: 'Supports search, category, level, price, rating, duration, instructor and sorting.',
    parameters: [
      q('q', { type: 'string' }, 'Free-text search over title, headline and description'),
      q('category', { type: 'string' }, 'Category slug'),
      q('level', { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] }),
      q('price', { type: 'string', enum: ['free', 'paid'] }),
      q('minRating', { type: 'number', minimum: 0, maximum: 5 }),
      q('instructor', { type: 'string' }, 'Instructor name'),
      q('duration', { type: 'string', enum: ['short', 'medium', 'long'] }),
      q('sort', { type: 'string', enum: ['newest', 'rating', 'popular', 'price_asc', 'price_desc'] }),
      q('page', { type: 'integer', minimum: 1 }),
      q('limit', { type: 'integer', minimum: 1, maximum: 50 }),
    ],
    responses: ok200({
      type: 'object',
      properties: { items: { type: 'array', items: ref('CourseSummary') }, ...ref('Page').properties },
    }),
  }));
  add('/courses/{idOrSlug}', 'get', op('Get a course by id or slug', catalogTag, {
    security: false,
    parameters: [p('idOrSlug')],
    responses: ok200(ref('CourseDetail')),
  }));
  add('/courses/{id}/reviews', 'get', op('List reviews for a course', catalogTag, {
    security: false,
    parameters: [p('id'), q('page', { type: 'integer' }), q('limit', { type: 'integer' })],
    responses: ok200({ type: 'array', items: ref('Review') }),
  }));
  add('/courses/{id}/reviews', 'post', op('Write a review (verified enrollment required)', catalogTag, {
    role: 'student (must be enrolled)',
    parameters: [p('id')],
    requestBody: body({
      type: 'object',
      required: ['rating'],
      properties: { rating: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string' } },
    }),
    responses: ok201(ref('Review')),
  }));

  /* ------------------------- Instructor -------------------------- */

  add('/instructor/courses', 'post', op('Create a course draft', instructorTag, {
    role: 'instructor (approved)',
    requestBody: body(ref('CreateCourseRequest'), { title: 'Modern React from Zero', level: 'beginner' }),
    responses: ok201(ref('CourseDetail')),
  }));
  add('/instructor/courses', 'get', op('List my courses (including drafts)', instructorTag, {
    role: 'instructor',
    parameters: [
      q('status', { type: 'string', enum: ['draft', 'pending', 'published', 'rejected', 'archived'] }),
      q('page', { type: 'integer' }),
      q('limit', { type: 'integer' }),
    ],
    responses: ok200({ type: 'array', items: ref('CourseSummary') }),
  }));
  add('/instructor/courses/{id}', 'get', op('Get one of my courses', instructorTag, {
    role: 'owner instructor',
    parameters: [p('id')],
    responses: ok200(ref('CourseDetail')),
  }));
  add('/instructor/courses/{id}', 'patch', op('Update course metadata', instructorTag, {
    role: 'owner instructor',
    parameters: [p('id')],
    requestBody: body({ type: 'object', properties: { title: { type: 'string' } } }),
    responses: ok200(ref('CourseDetail')),
  }));
  add('/instructor/courses/{id}', 'delete', op('Archive a course', instructorTag, {
    role: 'owner instructor',
    parameters: [p('id')],
    responses: ok200({ type: 'object', properties: { archived: { type: 'boolean' } } }),
  }));
  add('/instructor/courses/{id}/publish', 'post', op('Submit, approve, reject, unpublish or archive', instructorTag, {
    role: 'owner instructor (approve/reject requires admin)',
    parameters: [p('id')],
    requestBody: body({
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['submit', 'approve', 'reject', 'unpublish', 'archive'] },
        reason: { type: 'string' },
      },
    }),
    responses: ok200(ref('CourseSummary')),
  }));
  add('/instructor/courses/{id}/sections', 'post', op('Add a section', instructorTag, {
    role: 'owner instructor',
    parameters: [p('id')],
    requestBody: body({ type: 'object', required: ['title'], properties: { title: { type: 'string' } } }),
    responses: ok201(ref('Section')),
  }));
  add('/instructor/sections/{sectionId}', 'patch', op('Update or reorder a section', instructorTag, {
    role: 'owner instructor',
    parameters: [p('sectionId')],
    requestBody: body({ type: 'object', properties: { title: { type: 'string' }, order: { type: 'integer' } } }),
    responses: ok200(ref('Section')),
  }));
  add('/instructor/sections/{sectionId}', 'delete', op('Delete a section', instructorTag, {
    role: 'owner instructor',
    parameters: [p('sectionId')],
    responses: ok200({ type: 'object', properties: { deleted: { type: 'boolean' } } }),
  }));
  add('/instructor/sections/{sectionId}/lessons', 'post', op('Add a lesson', instructorTag, {
    role: 'owner instructor',
    parameters: [p('sectionId')],
    requestBody: body({
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        type: { type: 'string', enum: ['video', 'text', 'quiz', 'attachment'] },
        content: { type: 'string' },
        durationSeconds: { type: 'integer' },
        isPreview: { type: 'boolean' },
        isPublished: { type: 'boolean' },
      },
    }),
    responses: ok201(ref('Lesson')),
  }));
  add('/instructor/lessons/{lessonId}', 'patch', op('Update a lesson', instructorTag, {
    role: 'owner instructor',
    parameters: [p('lessonId')],
    requestBody: body({ type: 'object', properties: { title: { type: 'string' } } }),
    responses: ok200(ref('Lesson')),
  }));
  add('/instructor/lessons/{lessonId}', 'delete', op('Delete a lesson', instructorTag, {
    role: 'owner instructor',
    parameters: [p('lessonId')],
    responses: ok200({ type: 'object', properties: { deleted: { type: 'boolean' } } }),
  }));
  add('/instructor/courses/{id}/learners', 'get', op('List enrolled learners and their progress', instructorTag, {
    role: 'owner instructor',
    parameters: [p('id'), q('page', { type: 'integer' }), q('limit', { type: 'integer' })],
    responses: ok200({ type: 'array', items: ref('Enrollment') }),
  }));
  add('/admin/categories', 'post', op('Create a category', adminTag, {
    role: 'admin',
    requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, icon: { type: 'string' } } }),
    responses: ok201(ref('Category')),
  }));
  add('/admin/categories/{id}', 'patch', op('Update a category', adminTag, {
    role: 'admin',
    parameters: [p('id')],
    requestBody: body({ type: 'object', properties: { name: { type: 'string' } } }),
    responses: ok200(ref('Category')),
  }));
  add('/admin/categories/{id}', 'delete', op('Delete a category', adminTag, {
    role: 'admin',
    parameters: [p('id')],
    responses: ok200({ type: 'object', properties: { deleted: { type: 'boolean' } } }),
  }));

  /* -------------------------- Learning --------------------------- */

  add('/enrollments', 'post', op('Enroll in a free course', learningTag, {
    role: 'student',
    requestBody: body({ type: 'object', required: ['courseId'], properties: { courseId: { type: 'string' } } }),
    description: 'Paid courses must go through /checkout; this endpoint only activates free enrollments.',
    responses: ok201(ref('Enrollment')),
  }));
  add('/enrollments', 'get', op('List my enrollments (my learning)', learningTag, {
    role: 'student',
    parameters: [
      q('q', { type: 'string' }),
      q('status', { type: 'string', enum: ['active', 'completed', 'refunded'] }),
      q('page', { type: 'integer' }),
      q('limit', { type: 'integer' }),
    ],
    responses: ok200({ type: 'array', items: ref('Enrollment') }),
  }));
  add('/enrollments/{courseId}', 'get', op('Get my enrollment for a course', learningTag, {
    role: 'enrolled student',
    parameters: [p('courseId')],
    responses: ok200(ref('Enrollment')),
  }));
  add('/progress', 'post', op('Report playback progress for a lesson', learningTag, {
    role: 'enrolled student',
    description: 'Records lastPositionSeconds; does not complete the lesson.',
    requestBody: body({
      type: 'object',
      required: ['lessonId'],
      properties: {
        lessonId: { type: 'string' },
        lastPositionSeconds: { type: 'integer', minimum: 0 },
        watchedSeconds: { type: 'integer', minimum: 0 },
      },
    }),
    responses: ok200(ref('Progress')),
  }));
  add('/progress/{lessonId}/complete', 'post', op('Mark a lesson complete', learningTag, {
    role: 'enrolled student',
    description: 'Server enforces the completion rule (minimum watched percentage for video lessons).',
    parameters: [p('lessonId')],
    responses: ok200(ref('Progress')),
  }));
  add('/progress/{courseId}', 'get', op('Get course progress', learningTag, {
    role: 'enrolled student',
    parameters: [p('courseId')],
    responses: ok200(ref('Progress')),
  }));
  add('/lessons/{lessonId}/player', 'get', op('Get the lesson player payload', learningTag, {
    role: 'preview lesson: public; otherwise enrolled student',
    parameters: [p('lessonId')],
    description: 'Returns a signed HLS manifest URL, resume position and next/prev navigation.',
    responses: ok200({
      type: 'object',
      properties: {
        lesson: ref('Lesson'),
        streamUrl: { type: 'string', nullable: true },
        resumePositionSeconds: { type: 'integer' },
        nextLessonId: { type: 'string', nullable: true },
        prevLessonId: { type: 'string', nullable: true },
        resources: { type: 'array', items: { type: 'object' } },
      },
    }),
  }));

  /* ---------------------------- Media ---------------------------- */

  add('/lessons/{lessonId}/video', 'post', op('Upload a lesson video', mediaTag, {
    role: 'owner instructor',
    description:
      'multipart/form-data with a `file` part. Validates ownership, size and real media type (ffprobe) before queuing the transcode job.',
    parameters: [p('lessonId')],
    requestBody: {
      required: true,
      content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } },
    },
    responses: ok201(ref('MediaAsset')),
  }));
  add('/assets/{assetId}/retry', 'post', op('Retry a failed transcode job', mediaTag, {
    role: 'owner instructor or admin',
    parameters: [p('assetId')],
    responses: ok200(ref('MediaAsset')),
  }));
  add('/assets/{assetId}', 'get', op('Poll processing status', mediaTag, {
    role: 'owner instructor or admin',
    parameters: [p('assetId')],
    responses: ok200(ref('MediaAsset')),
  }));
  add('/courses/{courseId}/thumbnail', 'post', op('Upload a course thumbnail', mediaTag, {
    role: 'owner instructor',
    parameters: [p('courseId')],
    requestBody: {
      required: true,
      content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } },
    },
    responses: ok200({ type: 'object', properties: { thumbnailUrl: { type: 'string' } } }),
  }));
  add('/stream', 'get', op('Stream a protected HLS asset (signed URL)', mediaTag, {
    role: 'enrolled student / authorized viewer',
    description: 'Serves master.m3u8 and segments after verifying enrollment and URL signature.',
    parameters: [q('key', { type: 'string' }, 'Storage key of the manifest or segment', true), q('exp', { type: 'integer' }), q('sig', { type: 'string' })],
    responses: {
      '200': { description: 'HLS playlist or segment', content: { 'application/vnd.apple.mpegurl': { schema: { type: 'string' } } } },
    },
  }));
  add('/public', 'get', op('Fetch a public media file (thumbnails, previews)', mediaTag, {
    security: false,
    parameters: [q('key', { type: 'string' }, 'Storage key', true)],
    responses: { '200': { description: 'File bytes', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } } },
  }));
  add('/integration-status', 'get', op('Report which external integrations are configured', mediaTag, {
    security: false,
    responses: ok200({
      type: 'object',
      properties: {
        stripe: { type: 'boolean', example: integrationStatus.stripe },
        aws: { type: 'boolean', example: integrationStatus.aws },
        livekit: { type: 'boolean', example: integrationStatus.livekit },
        ffmpeg: { type: 'boolean' },
      },
    }),
  }));
  add('/media/dev-sign', 'get', op('[Dev] Sign a media key for local player testing', mediaTag, {
    security: false,
    description: 'Available only when NODE_ENV != production.',
    parameters: [q('key', { type: 'string' }, 'Storage key', true), q('u', { type: 'string' }, 'User id used in the signature')],
    responses: ok200({ type: 'object', properties: { url: { type: 'string' } } }),
  }));

  /* --------------------------- Quizzes --------------------------- */

  add('/instructor/courses/{courseId}/quizzes', 'get', op('List quizzes for my course', quizTag, {
    role: 'owner instructor',
    parameters: [p('courseId')],
    responses: ok200({ type: 'array', items: ref('Quiz') }),
  }));
  add('/instructor/courses/{courseId}/quizzes', 'post', op('Create a quiz (with answers)', quizTag, {
    role: 'owner instructor',
    parameters: [p('courseId')],
    requestBody: body(ref('QuizUpsert')),
    responses: ok201(ref('Quiz')),
  }));
  add('/instructor/quizzes/{quizId}', 'get', op('Get a quiz including correct answers', quizTag, {
    role: 'owner instructor',
    parameters: [p('quizId')],
    responses: ok200({ allOf: [ref('Quiz'), { type: 'object', properties: { questions: { type: 'array', items: { type: 'object' } } } }] }),
  }));
  add('/instructor/quizzes/{quizId}', 'patch', op('Update a quiz', quizTag, {
    role: 'owner instructor',
    parameters: [p('quizId')],
    requestBody: body(ref('QuizUpsert')),
    responses: ok200(ref('Quiz')),
  }));
  add('/instructor/quizzes/{quizId}', 'delete', op('Delete a quiz', quizTag, {
    role: 'owner instructor',
    parameters: [p('quizId')],
    responses: ok200({ type: 'object', properties: { deleted: { type: 'boolean' } } }),
  }));
  add('/instructor/quizzes/{quizId}/analytics', 'get', op('Quiz analytics (scores, pass rate)', quizTag, {
    role: 'owner instructor',
    parameters: [p('quizId')],
    responses: ok200({ type: 'object', properties: { attempts: { type: 'integer' }, avgScore: { type: 'number' }, passRate: { type: 'number' } } }),
  }));
  add('/quizzes/{quizId}', 'get', op('Get a quiz for taking (answers stripped)', quizTag, {
    role: 'enrolled student',
    description: 'Correct answers and explanations are never included before submission.',
    parameters: [p('quizId')],
    responses: ok200(ref('Quiz')),
  }));
  add('/quizzes/{quizId}/start', 'post', op('Start a quiz attempt', quizTag, {
    role: 'enrolled student',
    parameters: [p('quizId')],
    responses: ok201({
      type: 'object',
      properties: {
        attemptId: { type: 'string' },
        attemptNumber: { type: 'integer' },
        questionCount: { type: 'integer' },
        timeLimitSeconds: { type: 'integer', nullable: true },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
      },
    }),
  }));
  add('/quizzes/{quizId}/submit', 'post', op('Submit answers for grading', quizTag, {
    role: 'enrolled student',
    description: 'Graded server-side. Attempt limits and deadlines are enforced; results are idempotent.',
    parameters: [p('quizId')],
    requestBody: body({
      type: 'object',
      required: ['attemptId', 'answers'],
      properties: {
        attemptId: { type: 'string' },
        answers: {
          type: 'array',
          items: {
            type: 'object',
            required: ['questionId'],
            properties: { questionId: { type: 'string' }, optionIds: { type: 'array', items: { type: 'string' } } },
          },
        },
      },
    }),
    responses: ok200(ref('QuizAttempt')),
  }));
  add('/quizzes/{quizId}/attempts', 'get', op('My attempt history for a quiz', quizTag, {
    role: 'enrolled student',
    parameters: [p('quizId')],
    responses: ok200({ type: 'array', items: ref('QuizAttempt') }),
  }));

  /* -------------------------- Live classes ----------------------- */

  add('/live/upcoming', 'get', op('Upcoming live classes visible to me', liveTag, {
    parameters: [q('page', { type: 'integer' }), q('limit', { type: 'integer' })],
    responses: ok200({ type: 'array', items: ref('LiveClass') }),
  }));
  add('/live/instructor', 'get', op('My scheduled classes (instructor)', liveTag, {
    role: 'instructor',
    parameters: [q('status', { type: 'string' })],
    responses: ok200({ type: 'array', items: ref('LiveClass') }),
  }));
  add('/courses/{courseId}/live-classes', 'get', op('List classes for a course', liveTag, {
    role: 'public schedule; participants see attendance state',
    parameters: [p('courseId')],
    responses: ok200({ type: 'array', items: ref('LiveClass') }),
  }));
  add('/instructor/live-classes', 'post', op('Schedule a live class', liveTag, {
    role: 'owner instructor',
    requestBody: body({
      type: 'object',
      required: ['courseId', 'title', 'startsAt', 'endsAt'],
      properties: {
        courseId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string', nullable: true },
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time' },
        maxParticipants: { type: 'integer', default: 100 },
      },
    }),
    responses: ok201(ref('LiveClass')),
  }));
  add('/live/{id}', 'get', op('Get class details', liveTag, {
    parameters: [p('id')],
    responses: ok200(ref('LiveClass')),
  }));
  add('/instructor/live-classes/{id}', 'patch', op('Edit or cancel a class', liveTag, {
    role: 'owner instructor',
    parameters: [p('id')],
    requestBody: body({ type: 'object', properties: { title: { type: 'string' }, status: { type: 'string', enum: ['scheduled', 'completed', 'cancelled'] } } }),
    responses: ok200(ref('LiveClass')),
  }));
  add('/live/{id}/join', 'post', op('Get LiveKit room credentials', liveTag, {
    role: 'instructor (host) or enrolled student (participant)',
    parameters: [p('id')],
    description: 'Server decides participant permissions; students never receive host tokens.',
    responses: ok200(ref('RoomToken')),
  }));
  add('/live/{id}/chat', 'get', op('Read class chat history', liveTag, {
    role: 'class participant',
    parameters: [p('id'), q('before', { type: 'string' }, 'Cursor for pagination')],
    responses: ok200({ type: 'array', items: ref('ChatMessage') }),
  }));
  add('/live/{id}/chat', 'post', op('Post a chat message (REST fallback)', liveTag, {
    role: 'class participant',
    parameters: [p('id')],
    requestBody: body({ type: 'object', required: ['message'], properties: { message: { type: 'string', maxLength: 2000 } } }),
    responses: ok201(ref('ChatMessage')),
  }));
  add('/live/{id}/participants', 'get', op('List participants with attendance', liveTag, {
    role: 'class participant',
    parameters: [p('id')],
    responses: ok200({ type: 'array', items: { type: 'object' } }),
  }));
  add('/live/{id}/heartbeat', 'post', op('Refresh attendance presence', liveTag, {
    role: 'class participant',
    parameters: [p('id')],
    responses: ok200({ type: 'object', properties: { ok: { type: 'boolean' } } }),
  }));
  add('/live/{id}/leave', 'post', op('Record leaving the class', liveTag, {
    role: 'class participant',
    parameters: [p('id')],
    responses: ok200({ type: 'object', properties: { ok: { type: 'boolean' } } }),
  }));
  add('/admin/live-classes', 'get', op('Platform-wide class monitoring', liveTag, {
    role: 'admin',
    parameters: [q('status', { type: 'string' }), q('page', { type: 'integer' })],
    responses: ok200({ type: 'array', items: ref('LiveClass') }),
  }));

  /* ------------------------ Certificates ------------------------- */

  add('/certificates', 'get', op('My certificates', certTag, {
    role: 'student',
    responses: ok200({ type: 'array', items: ref('Certificate') }),
  }));
  add('/certificates/check/{courseId}', 'post', op('Check (and issue) certificate eligibility', certTag, {
    role: 'enrolled student',
    description: 'Evaluates completion rules; issues the certificate once when all requirements pass.',
    parameters: [p('courseId')],
    responses: ok200({
      type: 'object',
      properties: {
        eligible: { type: 'boolean' },
        requirements: { type: 'array', items: { type: 'object' } },
        certificate: ref('Certificate'),
      },
    }),
  }));
  add('/certificates/{certificateNumber}/pdf', 'get', op('Download certificate PDF', certTag, {
    role: 'owner student or admin',
    parameters: [p('certificateNumber')],
    responses: { '200': { description: 'PDF document', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } } },
  }));
  add('/verify/{lookup}', 'get', op('Public certificate verification', certTag, {
    security: false,
    description: 'Accepts a certificate number or verification code. Returns validity without exposing personal data beyond name and course.',
    parameters: [p('lookup', 'Certificate number or verification code')],
    responses: ok200({
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        studentName: { type: 'string' },
        courseTitle: { type: 'string' },
        issuedAt: { type: 'string', format: 'date-time' },
        revoked: { type: 'boolean' },
      },
    }),
  }));
  add('/admin/certificates/{id}/revoke', 'post', op('Revoke a certificate (audited)', certTag, {
    role: 'admin',
    parameters: [p('id')],
    requestBody: body({ type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } }),
    responses: ok200(ref('Certificate')),
  }));
  add('/admin/courses/{courseId}/certificates', 'get', op('List certificates issued for a course', certTag, {
    role: 'admin',
    parameters: [p('courseId')],
    responses: ok200({ type: 'array', items: ref('Certificate') }),
  }));

  /* --------------------------- Payments -------------------------- */

  add('/checkout', 'post', op('Create a checkout for a paid course', paymentTag, {
    role: 'student',
    requestBody: body({ type: 'object', required: ['courseId'], properties: { courseId: { type: 'string' }, couponCode: { type: 'string' } } }),
    description: 'Server recomputes the price. In local test mode returns a hosted test-gateway reference; with Stripe keys returns a Stripe Checkout URL.',
    responses: ok201({
      type: 'object',
      properties: {
        reference: { type: 'string' },
        provider: { type: 'string', enum: ['local', 'stripe'] },
        checkoutUrl: { type: 'string', nullable: true },
        amountMinor: { type: 'integer' },
        currency: { type: 'string' },
        testGatewayUrl: { type: 'string', nullable: true },
      },
    }),
  }));
  add('/payments/status/{reference}', 'get', op('Poll payment status', paymentTag, {
    role: 'purchasing student',
    parameters: [p('reference')],
    responses: ok200({
      type: 'object',
      properties: { status: { type: 'string', enum: ['pending', 'paid', 'failed', 'refunded'] }, enrolled: { type: 'boolean' } },
    }),
  }));
  add('/payments/test-gateway/cards', 'get', op('List test cards for the local gateway', paymentTag, {
    security: false,
    responses: ok200({ type: 'array', items: { type: 'object', properties: { number: { type: 'string' }, outcome: { type: 'string' } } } }),
  }));
  add('/payments/test-gateway/{reference}/confirm', 'post', op('Confirm a test-gateway payment', paymentTag, {
    role: 'purchasing student',
    description: 'Simulates the card network response; the same idempotent path as a Stripe webhook is then executed.',
    parameters: [p('reference')],
    requestBody: body({ type: 'object', required: ['cardNumber'], properties: { cardNumber: { type: 'string' }, outcome: { type: 'string', enum: ['succeed', 'decline'] } } }),
    responses: ok200({ type: 'object', properties: { status: { type: 'string' }, enrolled: { type: 'boolean' } } }),
  }));
  add('/webhooks/stripe', 'post', op('Stripe webhook receiver', paymentTag, {
    security: false,
    description: 'Verifies the Stripe signature (or the local HMAC header), deduplicates by event id, then applies the payment transition idempotently.',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { type: 'object' } } },
    },
    responses: { '200': { description: 'Event processed or intentionally ignored' } },
  }));
  add('/orders', 'get', op('My purchase history', paymentTag, {
    role: 'student',
    parameters: [q('page', { type: 'integer' }), q('limit', { type: 'integer' })],
    responses: ok200({ type: 'array', items: ref('Order') }),
  }));
  add('/payments/config', 'get', op('Public payment configuration for the client', paymentTag, {
    security: false,
    responses: ok200({ type: 'object', properties: { provider: { type: 'string' }, publishableKey: { type: 'string', nullable: true }, testMode: { type: 'boolean' } } }),
  }));
  add('/instructor/earnings', 'get', op('Earnings summary', paymentTag, {
    role: 'instructor',
    parameters: [q('from', { type: 'string', format: 'date-time' }), q('to', { type: 'string', format: 'date-time' })],
    responses: ok200(ref('EarningsSummary')),
  }));
  add('/instructor/ledger', 'get', op('Ledger entries (append-only financial history)', paymentTag, {
    role: 'instructor',
    parameters: [q('page', { type: 'integer' }), q('type', { type: 'string', enum: ['sale', 'commission', 'refund', 'adjustment', 'payout'] })],
    responses: ok200({ type: 'array', items: ref('LedgerEntry') }),
  }));
  add('/instructor/payouts', 'get', op('My payout requests', paymentTag, {
    role: 'instructor',
    responses: ok200({ type: 'array', items: ref('PayoutRequest') }),
  }));
  add('/instructor/payouts', 'post', op('Request a payout', paymentTag, {
    role: 'instructor',
    description: 'Amount must be at least the platform threshold and not exceed payable balance. Payouts are simulated unless a real provider is configured.',
    requestBody: body({ type: 'object', required: ['amountMinor'], properties: { amountMinor: { type: 'integer', minimum: 100 }, note: { type: 'string' } } }),
    responses: ok201(ref('PayoutRequest')),
  }));
  add('/admin/orders', 'get', op('All orders', paymentTag, {
    role: 'admin',
    parameters: [q('status', { type: 'string' }), q('page', { type: 'integer' }), q('q', { type: 'string' })],
    responses: ok200({ type: 'array', items: ref('Order') }),
  }));
  add('/admin/orders/{reference}/refund', 'post', op('Issue a refund', paymentTag, {
    role: 'admin',
    parameters: [p('reference')],
    description: 'Creates a Refund record, posts compensating ledger entries and revokes enrollment access per policy.',
    requestBody: body({ type: 'object', properties: { reason: { type: 'string' }, amountMinor: { type: 'integer' } } }),
    responses: ok200({ type: 'object', properties: { refunded: { type: 'boolean' }, order: ref('Order') } }),
  }));
  add('/admin/payouts', 'get', op('All payout requests', paymentTag, {
    role: 'admin',
    responses: ok200({ type: 'array', items: ref('PayoutRequest') }),
  }));
  add('/admin/payouts/{id}/decision', 'post', op('Approve, reject or mark a payout paid', paymentTag, {
    role: 'admin',
    parameters: [p('id')],
    requestBody: body({ type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['approve', 'reject', 'mark_paid'] }, note: { type: 'string' } } }),
    responses: ok200(ref('PayoutRequest')),
  }));
  add('/admin/webhook-events', 'get', op('Webhook delivery log', paymentTag, {
    role: 'admin',
    parameters: [q('page', { type: 'integer' })],
    responses: ok200({ type: 'array', items: { type: 'object' } }),
  }));
  add('/admin/refunds', 'get', op('All refunds', paymentTag, {
    role: 'admin',
    parameters: [q('page', { type: 'integer' })],
    responses: ok200({ type: 'array', items: { type: 'object' } }),
  }));

  /* ---------------------------- Admin ---------------------------- */

  add('/stats', 'get', op('Platform overview statistics', adminTag, {
    role: 'admin',
    responses: ok200({
      type: 'object',
      properties: {
        users: { type: 'object' },
        courses: { type: 'object' },
        revenue: { type: 'object' },
        enrollments: { type: 'object' },
        liveClasses: { type: 'object' },
      },
    }),
  }));
  add('/users', 'get', op('Search and filter users', adminTag, {
    role: 'admin',
    parameters: [q('q', { type: 'string' }), q('role', { type: 'string' }), q('page', { type: 'integer' })],
    responses: ok200({ type: 'array', items: ref('User') }),
  }));
  add('/users/{id}', 'patch', op('Update user role/status/approval', adminTag, {
    role: 'admin',
    parameters: [p('id')],
    requestBody: body({
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['student', 'instructor', 'admin'] },
        isActive: { type: 'boolean' },
        isVerified: { type: 'boolean' },
        instructorApproved: { type: 'boolean' },
      },
    }),
    responses: ok200(ref('User')),
  }));
  add('/courses', 'get', op('Moderation list of all courses', adminTag, {
    role: 'admin',
    parameters: [q('status', { type: 'string' }), q('page', { type: 'integer' })],
    responses: ok200({ type: 'array', items: ref('CourseSummary') }),
  }));
  add('/courses/{id}/moderate', 'post', op('Approve, reject, unpublish or archive a course', adminTag, {
    role: 'admin',
    parameters: [p('id')],
    requestBody: body({
      type: 'object',
      required: ['action'],
      properties: { action: { type: 'string', enum: ['approve', 'reject', 'unpublish', 'archive'] }, reason: { type: 'string' } },
    }),
    responses: ok200(ref('CourseSummary')),
  }));
  add('/reviews', 'get', op('Review moderation queue', adminTag, {
    role: 'admin',
    parameters: [q('page', { type: 'integer' })],
    responses: ok200({ type: 'array', items: ref('Review') }),
  }));
  add('/reviews/{id}/hide', 'post', op('Hide or restore a review', adminTag, {
    role: 'admin',
    parameters: [p('id')],
    responses: ok200(ref('Review')),
  }));
  add('/media-queue', 'get', op('Media-processing queue and failures', adminTag, {
    role: 'admin',
    parameters: [q('status', { type: 'string', enum: ['QUEUED', 'PROCESSING', 'FAILED'] }), q('page', { type: 'integer' })],
    responses: ok200({ type: 'array', items: ref('MediaAsset') }),
  }));
  add('/settings', 'get', op('Platform settings', adminTag, {
    role: 'admin',
    responses: ok200({
      type: 'object',
      properties: {
        commissionBps: { type: 'integer', example: 1500 },
        platformName: { type: 'string' },
        payoutThresholdMinor: { type: 'integer' },
        autoApproveCourses: { type: 'boolean' },
        maintenanceMode: { type: 'boolean' },
      },
    }),
  }));
  add('/settings', 'patch', op('Update platform settings', adminTag, {
    role: 'admin',
    requestBody: body({
      type: 'object',
      properties: {
        commissionBps: { type: 'integer', minimum: 0, maximum: 10000 },
        platformName: { type: 'string' },
        supportEmail: { type: 'string' },
        payoutThresholdMinor: { type: 'integer' },
        autoApproveCourses: { type: 'boolean' },
        maintenanceMode: { type: 'boolean' },
      },
    }),
    responses: ok200({ type: 'object' }),
  }));
  add('/audit-logs', 'get', op('Searchable audit trail', adminTag, {
    role: 'admin',
    parameters: [q('action', { type: 'string' }), q('actorId', { type: 'string' }), q('from', { type: 'string', format: 'date-time' }), q('page', { type: 'integer' })],
    responses: ok200({ type: 'array', items: ref('AuditLog') }),
  }));

  /* --------------------------- System ---------------------------- */

  add('/health', 'get', op('Liveness probe', systemTag, {
    security: false,
    responses: ok200({ type: 'object', properties: { status: { type: 'string', example: 'ok' }, uptimeSeconds: { type: 'number' } } }),
  }));
  add('/ready', 'get', op('Readiness probe (DB, Redis, queues)', systemTag, {
    security: false,
    responses: {
      '200': okResp({ type: 'object', properties: { mongo: { type: 'string' }, redis: { type: 'string' } } }, 'All dependencies ready'),
      '503': errResp('A dependency is unavailable'),
    },
  }));
  add('/meta', 'get', op('Public platform metadata (levels, currencies, flags)', systemTag, {
    security: false,
    responses: ok200({ type: 'object' }),
  }));
  add('/notifications', 'get', op('My notifications', systemTag, {
    role: 'authenticated user',
    parameters: [q('unreadOnly', { type: 'boolean' }), q('page', { type: 'integer' })],
    responses: ok200({ type: 'array', items: ref('Notification') }),
  }));
  add('/notifications/read', 'post', op('Mark notifications read', systemTag, {
    role: 'authenticated user',
    requestBody: body({ type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean' } } }),
    responses: ok200({ type: 'object', properties: { updated: { type: 'integer' } } }),
  }));
  add('/admin/health/details', 'get', op('Detailed operational health', systemTag, {
    role: 'admin',
    responses: ok200({
      type: 'object',
      properties: {
        mongo: { type: 'object' },
        redis: { type: 'object' },
        queues: { type: 'object' },
        storage: { type: 'object' },
        integrationStatus: { type: 'object' },
      },
    }),
  }));

  return paths;
}

/* ------------------------------------------------------------------ */
/* Document assembly                                                   */
/* ------------------------------------------------------------------ */

export function buildOpenApiDocument(): Json {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Skillora API',
      version: '1.0.0',
      description: [
        'REST API for the Skillora learning platform: catalog, enrollment, learning progress,',
        'quizzes, live classes, certificates, payments and administration.',
        '',
        '**Response envelope:** every JSON response is `{ success, data, meta? }`; errors are',
        '`{ success: false, error: { code, message, details? } }`.',
        '',
        '**Authentication:** `POST /login` returns a short-lived access token that must be sent as',
        '`Authorization: Bearer <token>` (the refresh token lives in an HTTP-only cookie and is',
        'rotated on every `POST /refresh`).',
        '',
        '**Authorization:** role and ownership checks are enforced server-side on every protected',
        'route; the roles are `student`, `instructor` and `admin`.',
        '',
        integrationStatus.stripe
          ? '**Payments:** Stripe test mode is configured.'
          : '**Payments:** running in local test-gateway mode (no Stripe credentials present). The',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    servers: [
      { url: `http://127.0.0.1:${env.PORT}${env.API_BASE_PATH}`, description: 'Local development' },
      { url: `https://api.example.com${env.API_BASE_PATH}`, description: 'Production' },
    ],
    tags: [
      { name: 'Auth', description: 'Registration, sessions, profile' },
      { name: 'Catalog', description: 'Categories, public course discovery, reviews' },
      { name: 'Instructor', description: 'Course authoring, curriculum, learners' },
      { name: 'Learning', description: 'Enrollment, progress, lesson player' },
      { name: 'Media', description: 'Uploads, transcoding status, signed streaming' },
      { name: 'Quizzes', description: 'Authoring, attempts, automatic grading' },
      { name: 'Live Classes', description: 'Scheduling, LiveKit rooms, chat, attendance' },
      { name: 'Certificates', description: 'Issuance, PDF download, public verification' },
      { name: 'Payments', description: 'Checkout, webhooks, ledger, payouts' },
      { name: 'Admin', description: 'Moderation, users, settings, audit logs' },
      { name: 'System', description: 'Health, readiness, notifications, metadata' },
    ],
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'skillora_refresh',
          description: 'Refresh cookie, used only by /refresh and /logout',
        },
      },
      schemas,
    },
    paths: buildPaths(),
  };
}