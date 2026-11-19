import type { Response } from 'express';
import type { ApiEnvelope, Paginated } from '@skillora/shared';

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>, status = 200): void {
  const body: ApiEnvelope<T> = { success: true, data, ...(meta ? { meta } : {}) };
  res.status(status).json(body);
}

export function created<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  ok(res, data, meta, 201);
}

export function noContent(res: Response): void {
  res.status(204).end();
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    items,
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}

export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }, forwardedFor?: string): string {
  return (forwardedFor ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
}