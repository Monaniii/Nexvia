import { Router } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../lib/asyncHandler';
import { created, ok } from '../lib/http';
import { authenticate, authorize } from '../middleware/auth';
import { errors } from '../lib/errors';
import { env, integrationStatus } from '../config/env';
import { assertCourseOwner } from '../services/course.service';
import { Lesson, VideoAsset, Course } from '../models/course';
import { storage, keys } from '../storage';
import { signMediaUrl, verifyMediaSignature, rewritePlaylist } from '../lib/media';
import { enqueue, videoQueue } from '../config/queues';
import { ASSET_JOB_NAME } from '@skillora/shared';
import { logger } from '../lib/logger';
import { writeAudit } from '../models/identity';

const router = Router();

const tmpDir = path.join(os.tmpdir(), 'skillora-uploads');
fs.mkdirSync(tmpDir, { recursive: true });

const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/x-msvideo',
  'video/mpeg',
  'video/ogg',
]);
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/** Magic-byte sniffing so a renamed .exe cannot pass as a video. */
function sniffMime(buffer: Buffer): { mime: string; ext: string } | null {
  if (buffer.length < 12) return null;
  const hex = buffer.subarray(0, 12).toString('hex').toLowerCase();

  // ISO-BMFF / MP4 family: 'ftyp' at offset 4
  if (hex.slice(8, 16) === '66747970') return { mime: 'video/mp4', ext: 'mp4' };
  // Matroska / WebM: 1A45DFA3
  if (hex.startsWith('1a45dfa3')) return { mime: 'video/webm', ext: 'webm' };
  // AVI: RIFF....AVI
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '41564920') return { mime: 'video/x-msvideo', ext: 'avi' };
  // Ogg: OggS
  if (hex.startsWith('4f676753')) return { mime: 'video/ogg', ext: 'ogg' };
  // MPEG program/transport stream
  if (hex.startsWith('000001ba') || hex.startsWith('00000003ba') || hex.startsWith('47')) return { mime: 'video/mpeg', ext: 'mpg' };
  // PNG
  if (hex.startsWith('89504e470d0a1a0a')) return { mime: 'image/png', ext: 'png' };
  // JPEG
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', ext: 'jpg' };
  // GIF
  if (hex.startsWith('47494638')) return { mime: 'image/gif', ext: 'gif' };
  // WebP (RIFF....WEBP)
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return { mime: 'image/webp', ext: 'webp' };
  // AVIF (ftypavif)
  if (hex.slice(8, 16) === '66747970' && buffer.subarray(8, 12).toString() === 'ftyp' && buffer.subarray(12, 16).toString().startsWith('avi')) {
    return { mime: 'image/avif', ext: 'avif' };
  }
  return null;
}

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
    },
  }),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_VIDEO_MIME.has(file.mimetype)) {
      cb(errors.validation('Unsupported video content type'));
      return;
    }
    cb(null, true);
  },
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.IMAGE_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      cb(errors.validation('Thumbnails must be JPEG, PNG, WebP, GIF or AVIF'));
      return;
    }
    cb(null, true);
  },
});

/* ------------------------------------------------------------------ *
 * Lesson video upload (instructor, ownership enforced)
 * ------------------------------------------------------------------ */
router.post(
  '/lessons/:lessonId/video',
  authenticate,
  authorize('instructor', 'admin'),
  videoUpload.single('file'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw errors.validation('A video file is required (field name: file)');

    try {
      const lesson = await Lesson.findById(req.params.lessonId).lean();
      if (!lesson) throw errors.notFound('Lesson not found');
      await assertCourseOwner(String(lesson.course), req.auth!);

      if (lesson.type !== 'video') {
        throw errors.precondition('Only video lessons accept video uploads');
      }

      // Validate magic bytes of the first 4KB before trusting the file.
      const handle = await fsp.open(file.path, 'r');
      const head = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(head, 0, 4096, 0);
      await handle.close();
      const sniffed = sniffMime(head.subarray(0, bytesRead));
      if (!sniffed || !ALLOWED_VIDEO_MIME.has(sniffed.mime)) {
        await fsp.rm(file.path, { force: true });
        throw errors.validation('The uploaded file is not a recognized video format');
      }

      // Replace any previous asset for this lesson.
      const previous = await VideoAsset.findOne({ lesson: lesson._id }).lean();
      if (previous) {
        await storage()
          .deletePrefix(keys.hlsPrefix(String(lesson.course), String(lesson._id), String(previous._id)))
          .catch(() => undefined);
        await storage().delete(previous.storageKey).catch(() => undefined);
        await VideoAsset.deleteOne({ _id: previous._id });
      }

      const asset = await VideoAsset.create({
        lesson: lesson._id,
        course: lesson.course,
        owner: req.auth!.id,
        originalName: file.originalname,
        mimeType: sniffed.mime,
        sizeBytes: file.size,
        storageKey: '',
        status: 'UPLOADING',
      });

      const storageKey = keys.sourceVideo(
        String(lesson.course),
        String(lesson._id),
        String(asset._id),
        sniffed.ext,
      );
      await storage().put(storageKey, fs.createReadStream(file.path), { contentType: sniffed.mime });

      asset.storageKey = storageKey;
      asset.status = 'QUEUED';
      asset.queuedAt = new Date();
      await asset.save();

      await Lesson.updateOne({ _id: lesson._id }, { $set: { videoAsset: asset._id, durationSeconds: lesson.durationSeconds } });

      const result = await enqueue(
        videoQueue(),
        ASSET_JOB_NAME,
        { assetId: String(asset._id), lessonId: String(lesson._id), courseId: String(lesson.course) },
        { jobId: `video:${String(asset._id)}` },
      );

      if (!result.enqueued) {
        asset.status = 'FAILED';
        asset.error = 'Job queue unavailable — start Redis and retry processing';
        await asset.save();
      }

      await writeAudit({
        actor: req.auth!.id,
        actorRole: req.auth!.role,
        action: 'media.uploaded',
        entityType: 'videoAsset',
        entityId: String(asset._id),
        metadata: { lessonId: String(lesson._id), bytes: file.size, queued: result.enqueued },
      });

      created(res, {
        assetId: String(asset._id),
        status: asset.status,
        jobId: result.jobId ?? null,
        originalName: asset.originalName,
        sizeBytes: asset.sizeBytes,
        mimeType: asset.mimeType,
      });
    } finally {
      await fsp.rm(file.path, { force: true }).catch(() => undefined);
    }
  }),
);

/** Re-queue a failed asset. */
router.post(
  '/assets/:assetId/retry',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const asset = await VideoAsset.findById(req.params.assetId).lean();
    if (!asset) throw errors.notFound('Video asset not found');
    await assertCourseOwner(String(asset.course), req.auth!);
    if (asset.status !== 'FAILED') throw errors.precondition(`Asset is ${asset.status}`);

    await VideoAsset.updateOne(
      { _id: asset._id },
      { $set: { status: 'QUEUED', error: null, queuedAt: new Date() } },
    );
    const result = await enqueue(
      videoQueue(),
      ASSET_JOB_NAME,
      { assetId: String(asset._id), lessonId: String(asset.lesson), courseId: String(asset.course) },
      { jobId: `video:${String(asset._id)}:${Date.now()}` },
    );
    ok(res, { queued: result.enqueued, status: result.enqueued ? 'QUEUED' : 'FAILED' });
  }),
);

router.get(
  '/assets/:assetId',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const asset = await VideoAsset.findById(req.params.assetId).lean();
    if (!asset) throw errors.notFound('Video asset not found');
    await assertCourseOwner(String(asset.course), req.auth!);
    ok(res, {
      assetId: String(asset._id),
      status: asset.status,
      error: asset.error ?? null,
      durationSeconds: asset.durationSeconds,
      width: asset.width,
      height: asset.height,
      renditions: asset.renditions ?? [],
      attempts: asset.attempts,
      processedAt: asset.processedAt ? new Date(asset.processedAt).toISOString() : null,
    });
  }),
);

/* ------------------------------------------------------------------ *
 * Course thumbnail
 * ------------------------------------------------------------------ */
router.post(
  '/courses/:courseId/thumbnail',
  authenticate,
  authorize('instructor', 'admin'),
  imageUpload.single('file'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw errors.validation('An image file is required (field name: file)');
    await assertCourseOwner(String(req.params.courseId), req.auth!);

    const sniffed = sniffMime(file.buffer);
    if (!sniffed || !ALLOWED_IMAGE_MIME.has(sniffed.mime)) {
      throw errors.validation('The uploaded file is not a supported image');
    }

    const key = keys.thumbnail(String(req.params.courseId), `${Date.now()}.${sniffed.ext}`);
    await storage().put(key, file.buffer, { contentType: sniffed.mime });

    const publicUrl = `${env.API_BASE_PATH}/media/public?key=${encodeURIComponent(key)}`;
    await Course.updateOne({ _id: req.params.courseId }, { $set: { thumbnailUrl: publicUrl } });
    ok(res, { thumbnailUrl: publicUrl, key });
  }),
);

/* ------------------------------------------------------------------ *
 * Signed streaming (protected course content)
 * ------------------------------------------------------------------ */
router.get(
  '/stream',
  asyncHandler(async (req, res) => {
    const key = String(req.query.key ?? '');
    const uid = String(req.query.u ?? '');
    const exp = Number(req.query.e ?? 0);
    const sig = String(req.query.s ?? '');

    if (!key || !uid || !sig || !verifyMediaSignature(key, uid, exp, sig)) {
      throw errors.forbidden('Invalid or expired media signature');
    }
    if (!/^(courses|certificates)\//.test(key)) {
      throw errors.forbidden('Invalid media key');
    }

    const store = storage();
    const absolute = store.localPath(key);
    const isPlaylist = key.endsWith('.m3u8');

    if (isPlaylist) {
      const raw = (await store.get(key)).toString('utf8');
      const rewritten = rewritePlaylist(raw, key, uid);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'private, max-age=5');
      res.status(200).send(rewritten);
      return;
    }

    if (absolute && fs.existsSync(absolute)) {
      const stat = await fsp.stat(absolute);
      const range = req.headers.range;
      const contentType = key.endsWith('.ts')
        ? 'video/mp2t'
        : key.endsWith('.mp4')
          ? 'video/mp4'
          : key.endsWith('.m4s')
            ? 'video/iso.segment'
            : 'application/octet-stream';

      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        const start = match?.[1] ? Number(match[1]) : 0;
        const end = match?.[2] ? Number(match[2]) : stat.size - 1;
        if (start >= stat.size || end >= stat.size || start > end) {
          res.status(416).set({ 'Content-Range': `bytes */${stat.size}` });
          return;
        }
        res.status(206).set({
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=5',
        });
        fs.createReadStream(absolute, { start, end }).pipe(res);
        return;
      }

      res.status(200).set({
        'Content-Length': String(stat.size),
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=5',
      });
      fs.createReadStream(absolute).pipe(res);
      return;
    }

    // Non-local drivers: redirect to a short-lived presigned URL in a real
    // deployment; here we stream bytes through the API for portability.
    const buffer = await store.get(key);
    res.status(200).set({
      'Content-Length': String(buffer.length),
      'Content-Type': key.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream',
      'Cache-Control': 'private, max-age=5',
    });
    res.end(buffer);
  }),
);

/** Public (non-course) assets such as thumbnails. */
router.get(
  '/public',
  asyncHandler(async (req, res) => {
    const key = String(req.query.key ?? '');
    if (!/^courses\/[^/]+\/thumbnails\//.test(key)) {
      throw errors.forbidden('Invalid public media key');
    }
    const store = storage();
    const absolute = store.localPath(key);
    if (absolute && fs.existsSync(absolute)) {
      const stat = await fsp.stat(absolute);
      res.set({
        'Content-Type': key.endsWith('.png')
          ? 'image/png'
          : key.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg',
        'Content-Length': String(stat.size),
        'Cache-Control': 'public, max-age=86400',
      });
      fs.createReadStream(absolute).pipe(res);
      return;
    }
    const buffer = await store.get(key);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(buffer);
  }),
);

/** Integration status so the UI can label local vs. verified AWS delivery. */
router.get(
  '/integration-status',
  asyncHandler(async (_req, res) => {
    ok(res, {
      storage: { driver: env.STORAGE_DRIVER, aws: integrationStatus.aws, cdn: Boolean(env.CDN_BASE_URL) },
      payments: { provider: env.PAYMENT_PROVIDER, stripe: integrationStatus.stripe, simulated: !integrationStatus.stripe },
      livekit: { configured: integrationStatus.livekit },
      ffmpeg: { ffmpegPath: env.FFMPEG_PATH ?? 'PATH', ffprobePath: env.FFPROBE_PATH ?? 'PATH' },
    });
  }),
);

export { signMediaUrl };
export default router;