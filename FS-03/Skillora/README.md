# Skillora

Skillora is a full-stack learning management system (LMS) built as a TypeScript monorepo. It is designed to support the core flow of an online education product: learners discover courses, instructors publish content, students enroll and progress, and the platform handles video delivery, live sessions, quizzes, and payments.

This repository is not just a front-end demo. It combines a React application, an Express API, a Redis-backed worker tier, MongoDB persistence, and shared validation/domain logic so that the same rules are enforced consistently across the system.

## What Skillora aims to achieve

Skillora sets out to provide a modern learning platform with four main goals:

- Give learners a clean catalog and learning experience for discovering and completing courses.
- Give instructors a structured way to author courses, segments, lessons, quizzes, and live sessions.
- Enforce access, completion, and payment rules consistently through server-side logic.
- Handle media, reminders, emails, and real-time classroom events through background jobs and asynchronous infrastructure.

In practical terms, the project models a platform similar to an online course marketplace and learning portal, with a simulated checkout flow and optional real integrations for Stripe, S3 storage, and LiveKit.

## What the project includes

- Public course catalog with filtering and search
- Course detail pages and enrollment logic
- Instructor authoring workflow for drafts, publishing, and review states
- Structured lesson progression and completion tracking
- Video lessons with HLS transcoding and signed media URLs
- Quiz lessons and completion scoring
- Live class scheduling, chat, participant tracking, and room token issuance
- Order and payment flows, including a local test payment gateway and Stripe support
- Instructor earnings, payouts, and basic admin metrics
- Background job processing for reminders, email, and media conversion

## How it achieves this

### 1. Monorepo structure

The project is split into workspaces so each concern has a clear boundary:

- `apps/web`: the browser client built with React, Vite, Redux Toolkit, and routing.
- `apps/api`: the API server built with Express, Zod, MongoDB, Redis, Socket.IO, and JWT auth.
- `apps/worker`: background job processor for media conversion, reminders, and outbound email.
- `packages/shared`: shared schemas, domain rules, constants, and DTO types consumed by both client and server.

This reduces duplicated validation and keeps business rules in one place.

### 2. API-first business logic

The API handles:

- Authentication and authorization
- Course discovery and purchase decisions
- Enrollment and completion tracking
- Lesson access checks
- Quiz submission and grading logic
- Live class authorization and room tokens
- Payment event handling and order records

The server validates requests with Zod schemas and centralizes rule logic in the shared package so that the UI and API both enforce the same contract.

### 3. Shared rules and schemas

The `packages/shared` workspace contains the domain contract used across the system:

- enumerations for content types, course status, lesson states, and notification types
- money utilities
- business rule helpers for course publication and completion
- request validation schemas for auth, payments, quizzes, and live classes

Because these rules are shared, one source of truth exists instead of re-implementing validation in each app.

### 4. Background processing pipeline

The worker layer decouples expensive tasks from the request lifecycle:

- Video ingestion and FFmpeg-based HLS conversion
- Live reminder emails
- Outbound email sending
- Any future async work such as archive generation or notifications

Redis + BullMQ provides reliable job queuing, retries, and concurrency control.

### 5. Media pipeline and playback

Video lessons are processed through an HLS workflow:

- Source video is validated with `ffprobe`
- FFmpeg transcodes it into multiple renditions
- A `master.m3u8` playlist is generated
- Posters and segment files are stored locally or in S3
- The API exposes signed URLs so content is streamed without exposing raw storage paths

This gives a scalable media playback path while keeping access checks protected.

### 6. Real-time classes and communication

For live classroom features, the API issues room credentials and chat/session data is managed through a socket layer. The app integrates with LiveKit-style room semantics and uses Redis-backed job reminders for schedule notifications.

## Typical user flow

1. A learner opens the catalog and browses public courses.
2. They register or sign in and view course details.
3. They enroll in a free or paid course.
4. The API checks access, price, and enrollment rules.
5. The learner watches lesson content and updates progress as they consume videos or complete quiz lessons.
6. The platform stores completion, progress percentages, and course state.
7. Instructors publish course content and manage live classes or review cycles.
8. Video jobs run asynchronously in the worker tier, updating the lesson and course metadata when ready.
9. Payments can be handled by the local gateway or Stripe in production.

## Repository structure

```text
skillora/
├── apps/
│   ├── api/                  # Express API server and business logic
│   │   ├── src/
│   │   │   ├── config/       # env, DB, Redis, queue config
│   │   │   ├── db/           # startup and seed scripts
│   │   │   ├── docs/         # OpenAPI document generation
│   │   │   ├── lib/          # logger, utils, errors, media helpers
│   │   │   ├── middleware/   # auth, validation, error handling
│   │   │   ├── models/       # MongoDB models
│   │   │   ├── routes/       # REST endpoints
│   │   │   ├── services/     # domain logic
│   │   │   ├── sockets/      # real-time socket server
│   │   │   ├── storage/      # local/S3 media driver
│   │   │   ├── app.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── web/                 # React + Vite client
│   │   ├── src/
│   │   └── package.json
│   └── worker/              # BullMQ processors and background jobs
│       ├── src/
│       ├── README.md
│       └── package.json
├── packages/
│   └── shared/              # domain schemas, constants, and rules
├── data/                    # local infrastructure and logs
├── docs/                    # project docs area
├── scripts/                 # dev infrastructure and helper scripts
├── .env.example             # environment template
├── docker-compose.yml       # MongoDB and Redis services
├── package.json             # workspace scripts and root dependencies
├── tsconfig.base.json
├── vitest.workspace.ts
├── eslint.config.mjs
├── README.md
└── ...
```

## Technology stack

### Frontend
- React 18
- Vite
- TypeScript
- React Router
- Redux Toolkit
- HLS.js for browser playback
- Custom CSS styling

### Backend
- Node.js 20+
- Express
- MongoDB with Mongoose
- Redis with BullMQ
- Socket.IO
- JWT for auth
- Zod validation
- Helmet, CORS, compression, rate limiting

### Media and integration services
- FFmpeg and ffprobe
- S3-compatible storage support
- Stripe payment integration
- LiveKit server SDK
- SMTP/email infrastructure via log provider or SMTP URL

## Local development setup

### Requirements

- Node.js 20.10 or later
- npm 10 or later
- MongoDB 7
- Redis 7
- Docker Compose (recommended) or the Windows helper scripts
- FFmpeg and ffprobe available on your `PATH`

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example environment file:

```bash
copy .env.example .env
```

On Linux/macOS:

```bash
cp .env.example .env
```

The default local development values are intended for local testing only. Update the JWT secrets and cookie settings before exposing the app outside a development environment.

### 3. Start infrastructure

With Docker:

```bash
npm run infra:up
```

On Windows without Docker:

```bash
node scripts/dev-infra.mjs setup
node scripts/dev-infra.mjs start
```

### 4. Seed demo data

```bash
npm run build:shared
npm run seed
```

This creates development accounts such as:

- `learner@skillora.local`
- `instructor@skillora.local`
- `admin@skillora.local`

The default password is `SkilloraDev123!` 

The development catalog contains 26 courses.The video-led additions cover HTML, CSS, JavaScript, Python, SQL, Git, React, TypeScript, Node/Express, Excel, data analysis, Figma, Docker, neural networks, machine learning, and computer science. The other five additions are hands-on labs for weekly planning, proposal writing, photo storytelling, data storytelling, and portfolio building. New courses include objective-based in-app quizzes.

Seeded video lessons embed free-to-watch YouTube videos in YouTube's privacy-enhanced player. They are not downloaded or stored by Skillora; playback requires an internet connection. Learners mark an embedded video lesson complete manually because third-party playback progress is not tracked.

Seed data is created idempotently. Running `npm run seed` adds missing demo records without overwriting existing course or lesson content.

### 5. Run the app

```bash
npm run dev
```

This starts:

- Web app at `http://127.0.0.1:5173`
- API at `http://127.0.0.1:4000`
- Swagger docs at `http://127.0.0.1:4000/api/v1/docs`

The web app proxies API requests to the local server so the browser can share a cookie-based session.

## Instructor and administrator tools

Instructors can open **Learners** beside a class in the teaching studio to review its learner ranking, individual lesson completion, quiz results, course progress, and recent activity.

Administrators can use **Admin** to review and approve or return submitted courses, manage account roles and active status, and respond to support requests. Learners and instructors can submit a request from **Support**; the admin team can reply, coordinate resolution, and update its status.

## Useful commands

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test
npm run seed
npm run infra:down
```

`npm run infra:down` tears down the database containers and removes the MongoDB data volume. Avoid using it if you want to preserve existing local data.

## Configuration and integrations

The API validates environment variables on startup. Important settings include:

- `MONGODB_URI`
- `REDIS_URL`
- `WEB_ORIGIN`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `STORAGE_DRIVER`
- `PAYMENT_PROVIDER`
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
- `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `SMTP_URL`

The project supports a local simulated payment flow by default. To use production-grade integrations, enable the relevant provider and configure credentials before deployment.

## Production considerations

The project includes the building blocks for a safer production setup, but those settings must be configured intentionally:

- use long, unique JWT secrets
- enable secure, HTTP-only cookies behind HTTPS
- set `COOKIE_SECURE=true`; production startup rejects the development JWT defaults, matching access/refresh secrets, non-HTTPS app URLs, insecure CORS origins, and wildcard CORS
- use strong `WEB_ORIGIN` and `APP_URL` values
- set `PAYMENT_PROVIDER=stripe` with a Stripe live secret key and `STRIPE_WEBHOOK_SECRET`; production paid checkout requires these, rejects test keys, and never falls back to the local test gateway
- configure the Stripe webhook endpoint at `/api/v1/webhooks/stripe` and verify the production `/api/v1/ready` check reports payments ready
- use S3 or another external media store when scaling beyond local storage
- keep FFmpeg and ffprobe installed in the worker environment
- enforce production-grade database and Redis credentials instead of local defaults

The local simulated card checkout is development-only. It remains clearly labeled in development and its card-list and confirmation endpoints are disabled in production.

Outbound email is not production-ready yet: `EMAIL_PROVIDER=log` records messages but does not deliver them, and SMTP transport is not implemented. Do not rely on email verification, password reset, or notification email until a real provider is implemented and configured. Production readiness reports degraded while email delivery is unavailable.

The code also uses Helmet, request validation, signed media URLs, and rate limiting as part of the platform safety layer.

## Limitations and scope

Skillora is best understood as a full-featured prototype or production-oriented starter for an LMS product. It covers much of the common learning-platform flow, but it is not a generic SaaS platform with every possible enterprise extension built in. The code is intentionally organized around the learning domain and its operational concerns, which makes it a good foundation for extension.

## Additional documentation

See the worker-specific notes here:

- [`apps/worker/README.md`](./apps/worker/README.md)

This repo is designed for local development and experimentation, while still being structured enough to support a production deployment path with the right environment and infrastructure configuration.
# Skillora
