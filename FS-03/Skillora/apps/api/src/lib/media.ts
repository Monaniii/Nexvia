import crypto from 'node:crypto';
import { env } from '../config/env';
import { timingSafeEqual } from './crypto';

/**
 * Signed media URLs.
 *
 * Course video content is never publicly readable: the master playlist and
 * every segment require a short-lived HMAC signature bound to (key, userId,
 * expiry). Verification happens in the API before any bytes are written.
 */
export interface MediaClaims {
  key: string;
  uid: string;
  exp: number;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(payload).digest('base64url');
}

export function signMediaUrl(key: string, userId: string, ttlSeconds = env.SIGNED_URL_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${key}|${userId}|${exp}`;
  const sig = sign(payload);
  return `${env.API_BASE_PATH}/media/stream?key=${encodeURIComponent(key)}&u=${encodeURIComponent(
    userId,
  )}&e=${exp}&s=${encodeURIComponent(sig)}`;
}

export function verifyMediaSignature(key: string, userId: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = sign(`${key}|${userId}|${exp}`);
  return timingSafeEqual(expected, sig);
}

/** Extract every referenced segment/playlist inside an HLS master playlist. */
export function parseHlsUris(masterContent: string): string[] {
  const uris: string[] = [];
  for (const line of masterContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#EXT')) {
      // #EXT-X-STREAM-INF:...,URI="index.m3u8"
      const uriMatch = /URI="([^"]+)"/.exec(trimmed);
      if (uriMatch) uris.push(uriMatch[1]);
      continue;
    }
    uris.push(trimmed);
  }
  return uris;
}

/**
 * Rewrite a playlist so every referenced URI becomes an absolute signed URL.
 * `baseUrl` is the directory of the requested playlist inside the store.
 */
export function rewritePlaylist(
  content: string,
  baseUrl: string,
  userId: string,
): string {
  return content
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return raw;
      if (line.startsWith('#')) {
        return raw.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
          const abs = resolveKey(baseUrl, uri);
          return `URI="${signMediaUrl(abs, userId)}"`;
        });
      }
      const abs = resolveKey(baseUrl, line);
      return signMediaUrl(abs, userId);
    })
    .join('\n');
}

function resolveKey(baseUrl: string, rel: string): string {
  if (/^https?:\/\//.test(rel)) return rel;
  if (rel.startsWith('/')) return rel.slice(1);
  const parts = (baseUrl ? baseUrl.split('/') : []).filter(Boolean);
  parts.pop(); // drop the filename
  for (const segment of rel.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}
