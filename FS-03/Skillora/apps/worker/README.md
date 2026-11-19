# @skillora/worker

Background job consumers: video processing (FFmpeg → HLS), live-class reminders,
and outbound email dispatch.

## Why it imports `../api/src`

The API and the worker are separate processes sharing one MongoDB. To guarantee
they always agree on schemas, storage key layouts, env parsing and logging, the
worker compiles the API's persistence modules directly (`src/data/index.ts` is
the only file allowed to cross the boundary). `tsconfig.json` sets its
compilation root accordingly. Duplication would drift; this cannot.

## Queues

| Queue                 | Job name                | Concurrency | Handler                     |
| --------------------- | ----------------------- | ----------- | --------------------------- |
| `video-processing`    | `process-video-asset`   | `MEDIA_WORKERS` (default 2) | `processors/video.ts` |
| `live-class-reminders`| `live-class-reminder`   | 2           | `processors/reminder.ts`    |
| `email`               | `send-email`            | 2           | `processors/email.ts`       |

Job options (attempts: 3, exponential backoff) are defined by the API when it
enqueues.

## Video pipeline

`QUEUED → PROCESSING → READY | FAILED`

1. ffprobe validates the source (a renamed executable never reaches FFmpeg).
2. The HLS prefix is wiped first, so a retried job rebuilds cleanly (idempotent).
3. FFmpeg encodes a rung ladder (240p…1080p, never upscale) to HLS + TS segments.
4. `master.m3u8` and a poster thumbnail are written.
5. Files land in the local driver's directory, or are uploaded to S3.
6. The asset, lesson and course duration metadata are updated.
7. On failure the error is recorded and the job rethrown for backoff retry;
   `FAILED` is only written when attempts are exhausted (retry via
   `POST /api/v1/assets/:id/retry`).

## Health

`GET http://127.0.0.1:4100/health` (override with `WORKER_HEALTH_PORT`).

## Run

```bash
npm run dev -w @skillora/worker   # tsx watch
npm run build -w @skillora/worker # tsc → dist/
```

Requires MongoDB, Redis and `ffmpeg`/`ffprobe` on PATH (or `FFMPEG_PATH` /
`FFPROBE_PATH`).
