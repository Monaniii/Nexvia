import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env, logger } from '../data';

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  hasAudio: boolean;
  sizeBytes: number;
}

interface FFprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
}

interface FFprobeOutput {
  format?: { duration?: string; size?: string };
  streams?: FFprobeStream[];
}

/** Parses "30000/1001" style frame rates; falls back to 0 when unparseable. */
function parseRate(rate?: string): number {
  if (!rate) return 0;
  const [num, den] = rate.split('/').map(Number);
  if (!Number.isFinite(num)) return 0;
  if (!Number.isFinite(den) || den === 0) return num;
  return Math.round((num / den) * 100) / 100;
}

/**
 * Inspects a media file with ffprobe. This is the trust boundary for uploads:
 * the pipeline refuses to process files whose streams ffprobe cannot read,
 * which is what actually distinguishes a video from a renamed executable.
 */
export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const bin = env.FFPROBE_PATH || 'ffprobe';
  const { stdout } = await execFileAsync(
    bin,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { maxBuffer: 8 * 1024 * 1024, timeout: 120_000 },
  );

  const parsed = JSON.parse(stdout) as FFprobeOutput;
  const video = parsed.streams?.find((s) => s.codec_type === 'video');
  if (!video || !video.width || !video.height) {
    throw new Error('ffprobe found no usable video stream');
  }

  const duration = Number(parsed.format?.duration ?? video.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('ffprobe could not determine media duration');
  }

  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30;

  logger.debug(
    { width: video.width, height: video.height, duration, fps, codec: video.codec_name },
    'ffprobe result',
  );

  return {
    durationSeconds: Math.round(duration * 100) / 100,
    width: video.width,
    height: video.height,
    fps: Math.min(Math.max(fps, 1), 240),
    videoCodec: video.codec_name ?? 'unknown',
    hasAudio: Boolean(parsed.streams?.find((s) => s.codec_type === 'audio')),
    sizeBytes: Number(parsed.format?.size ?? 0),
  };
}