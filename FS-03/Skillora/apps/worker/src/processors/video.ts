import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Job } from 'bullmq';
import { ASSET_JOB_NAME } from '@skillora/shared';
import { Course, Lesson, VideoAsset, keys, logger, storage } from '../data';
import { probeMedia } from '../media/probe';
import {
  buildLadder,
  extractThumbnail,
  transcodeRendition,
  writeMasterPlaylist,
} from '../media/transcode';

export interface VideoJobData {
  assetId: string;
  lessonId: string;
  courseId: string;
}

/** Recomputes the course's total duration from its published lessons. */
async function refreshCourseDuration(courseId: string): Promise<void> {
  const lessons = await Lesson.find({ course: courseId, isPublished: true })
    .select('durationSeconds')
    .lean();
  const total = lessons.reduce((sum, l) => sum + (l.durationSeconds ?? 0), 0);
  await Course.updateOne({ _id: courseId }, { $set: { durationSeconds: total } }).catch(() => undefined);
}

async function walkFiles(dir: string, rel = ''): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(abs, relPath)));
    else out.push(relPath);
  }
  return out;
}

/**
 * BullMQ processor for `process-video-asset`.
 *
 * State machine: QUEUED → PROCESSING → READY | FAILED
 *
 * Idempotency: a READY asset short-circuits immediately, and the HLS prefix is
 * wiped before every run so a retried job always rebuilds a clean tree instead
 * of interleaving segments from a previous partial attempt. On failure the
 * error is recorded and the job rethrown so BullMQ's exponential backoff can
 * retry; FAILED is only written when attempts are exhausted.
 */
export async function processVideoJob(job: Job<VideoJobData>): Promise<void> {
  const { assetId, lessonId, courseId } = job.data;
  const store = storage();

  const asset = await VideoAsset.findById(assetId);
  if (!asset) {
    logger.warn({ assetId }, 'Video asset no longer exists, dropping job');
    return;
  }
  if (asset.status === 'READY') {
    logger.info({ assetId }, 'Asset already processed, skipping duplicate job');
    return;
  }

  const prefix = keys.hlsPrefix(courseId, lessonId, assetId);
  const attemptsAllowed = job.opts.attempts ?? 1;
  const isFinalAttempt = job.attemptsMade + 1 >= attemptsAllowed;

  asset.status = 'PROCESSING';
  asset.startedAt = new Date();
  asset.attempts = (asset.attempts ?? 0) + 1;
  asset.error = null;
  await asset.save();

  logger.info(
    { assetId, attempt: asset.attempts, file: asset.originalName, bytes: asset.sizeBytes },
    'Started video processing',
  );

  // A retry must not inherit files from a partial previous run.
  await store.deletePrefix(prefix).catch(() => undefined);

  const localTarget = store.localPath(prefix);
  const workdir = localTarget ?? (await fsp.mkdtemp(path.join(os.tmpdir(), 'skillora-xcode-')));
  let tempSource: string | null = null;

  try {
    if (localTarget) await fsp.mkdir(localTarget, { recursive: true });

    // Locate the source: local disk for the local driver, download otherwise.
    let sourcePath: string | null = localTarget ? null : store.localPath(asset.storageKey);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      const buffer = await store.get(asset.storageKey);
      tempSource = path.join(workdir, `source${path.extname(asset.storageKey) || '.bin'}`);
      await fsp.writeFile(tempSource, buffer);
      sourcePath = tempSource;
    }

    const probe = await probeMedia(sourcePath);
    const ladder = buildLadder(probe);

    logger.info(
      { assetId, renditions: ladder.map((r) => r.name), duration: probe.durationSeconds },
      'Transcoding HLS ladder',
    );

    for (const spec of ladder) {
      await transcodeRendition(sourcePath, probe, spec, path.join(workdir, spec.name));
    }
    await writeMasterPlaylist(workdir, ladder);

    const hasThumb = await extractThumbnail(
      sourcePath,
      probe,
      path.join(workdir, 'thumbnail.jpg'),
    );

    // Local driver: files are already in their final location. Remote driver:
    // push the whole tree up.
    if (!localTarget) {
      const files = await walkFiles(workdir);
      for (const rel of files) {
        if (rel.startsWith('source')) continue;
        const key = `${prefix}/${rel}`;
        const contentType = rel.endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : rel.endsWith('.ts')
            ? 'video/mp2t'
            : rel.endsWith('.jpg')
              ? 'image/jpeg'
              : 'application/octet-stream';
        await store.put(key, fs.createReadStream(path.join(workdir, rel)), { contentType });
      }
    }

    asset.status = 'READY';
    asset.error = null;
    asset.durationSeconds = Math.round(probe.durationSeconds);
    asset.width = probe.width;
    asset.height = probe.height;
    asset.fps = probe.fps;
    asset.masterPlaylistKey = `${prefix}/master.m3u8`;
    asset.thumbnailKey = hasThumb ? `${prefix}/thumbnail.jpg` : null;
    asset.posterKey = hasThumb ? `${prefix}/thumbnail.jpg` : null;
    asset.set(
      'renditions',
      ladder.map((r) => ({
        name: r.name,
        height: r.height,
        bandwidth: r.bandwidth,
        playlistKey: `${prefix}/${r.name}/index.m3u8`,
      })),
    );
    asset.jobId = String(job.id);
    asset.processedAt = new Date();
    await asset.save();

    await Lesson.updateOne(
      { _id: lessonId },
      { $set: { durationSeconds: Math.round(probe.durationSeconds) } },
    );
    await refreshCourseDuration(courseId);

    logger.info(
      { assetId, renditions: ladder.length, duration: probe.durationSeconds },
      'Video processing complete',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    asset.status = isFinalAttempt ? 'FAILED' : 'QUEUED';
    asset.error = message.slice(0, 1000);
    await asset.save().catch(() => undefined);
    logger.error(
      { assetId, attempt: job.attemptsMade + 1, isFinalAttempt, err: message },
      'Video processing failed',
    );
    throw err;
  } finally {
    // Remote driver: remove the scratch directory (which also holds the
    // downloaded source). Local driver: workdir IS the final HLS folder.
    if (localTarget !== workdir) {
      await fsp.rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export const VIDEO_JOB = ASSET_JOB_NAME;