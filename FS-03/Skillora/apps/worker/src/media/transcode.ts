import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { env, logger } from '../data';
import type { ProbeResult } from './probe';

const execFileAsync = promisify(execFile);

export interface RenditionSpec {
  name: string;
  width: number;
  height: number;
  /** Target total bitrate in bits per second (video + audio). */
  bandwidth: number;
  videoBitrateKbps: number;
}

/** Standard ladder: 240p … 1080p. Source height decides which rungs are used. */
const LADDER: Array<{ height: number; bandwidth: number }> = [
  { height: 240, bandwidth: 400_000 },
  { height: 360, bandwidth: 800_000 },
  { height: 480, bandwidth: 1_400_000 },
  { height: 720, bandwidth: 2_800_000 },
  { height: 1080, bandwidth: 5_000_000 },
];

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * Picks renditions that never upscale: every rung must be ≤ the source, and
 * there is always at least one rung (tiny sources get a single source-height
 * rendition) so playback is possible for any upload.
 */
export function buildLadder(probe: ProbeResult): RenditionSpec[] {
  const chosen = LADDER.filter((r) => r.height <= probe.height);
  if (chosen.length === 0) {
    const height = even(probe.height);
    const bandwidth = Math.max(400_000, Math.round(probe.width * probe.height * probe.fps * 0.07));
    return [
      {
        name: `${height}p`,
        width: even((height * probe.width) / probe.height),
        height,
        bandwidth,
        videoBitrateKbps: Math.max(300, Math.round(bandwidth * 0.9 / 1000)),
      },
    ];
  }
  return chosen.map((r) => ({
    name: `${r.height}p`,
    width: even((r.height * probe.width) / probe.height),
    height: r.height,
    bandwidth: r.bandwidth,
    videoBitrateKbps: Math.round((r.bandwidth - 128_000) / 1000), // leave 128kbps for AAC
  }));
}

async function run(bin: string, args: string[], label: string): Promise<void> {
  try {
    const { stderr } = await execFileAsync(bin, args, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30 * 60_000,
    });
    const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
    if (tail) logger.debug({ label, tail }, 'ffmpeg output');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string }).stderr ?? '';
    const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-6).join(' | ');
    throw new Error(`ffmpeg failed (${label}): ${tail || msg}`);
  }
}

/** Encodes one HLS rendition (VOD playlist + TS segments) into `outDir`. */
export async function transcodeRendition(
  sourcePath: string,
  probe: ProbeResult,
  spec: RenditionSpec,
  outDir: string,
): Promise<void> {
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
  await fsp.mkdir(outDir, { recursive: true });

  const args = [
    '-y',
    '-hide_banner',
    '-nostdin',
    '-i',
    sourcePath,
    '-vf',
    `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=decrease,pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-profile:v',
    'main',
    '-level',
    '4.0',
    '-b:v',
    `${spec.videoBitrateKbps}k`,
    '-maxrate',
    `${Math.round(spec.videoBitrateKbps * 1.07)}k`,
    '-bufsize',
    `${Math.round(spec.videoBitrateKbps * 1.5)}k`,
    '-g',
    '48',
    '-keyint_min',
    '48',
    '-sc_threshold',
    '0',
  ];

  if (probe.hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000');
  } else {
    args.push('-an');
  }

  args.push(
    '-f',
    'hls',
    '-hls_time',
    '6',
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    path.join(outDir, 'seg_%05d.ts'),
    path.join(outDir, 'index.m3u8'),
  );

  await run(ffmpeg, args, spec.name);
}

/** Writes the master playlist referencing every rendition relatively. */
export async function writeMasterPlaylist(
  outDir: string,
  ladder: RenditionSpec[],
): Promise<void> {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const spec of ladder) {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${spec.bandwidth},RESOLUTION=${spec.width}x${spec.height}`);
    lines.push(`${spec.name}/index.m3u8`);
  }
  await fsp.writeFile(path.join(outDir, 'master.m3u8'), `${lines.join('\n')}\n`, 'utf8');
}

/** Captures a poster/thumbnail frame (best-effort: a failure never fails the job). */
export async function extractThumbnail(
  sourcePath: string,
  probe: ProbeResult,
  outFile: string,
): Promise<boolean> {
  try {
    const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
    const seek = Math.min(5, Math.max(0, probe.durationSeconds / 2));
    const width = Math.min(1280, probe.width);
    await run(ffmpeg, [
      '-y',
      '-hide_banner',
      '-nostdin',
      '-ss',
      seek.toFixed(2),
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-vf',
      `scale=${width}:-2`,
      '-q:v',
      '3',
      outFile,
    ], 'thumbnail');
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Thumbnail extraction failed (continuing without poster)',
    );
    return false;
  }
}