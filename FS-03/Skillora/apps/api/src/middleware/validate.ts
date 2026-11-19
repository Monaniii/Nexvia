import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { errors } from '../lib/errors';

type Source = 'body' | 'query' | 'params';

/**
 * Validates and replaces the request part with the *parsed* Zod value, so
 * handlers only ever see coerced, stripped, defaulted data.
 */
export function validate<T extends ZodTypeAny>(schema: T, source: Source = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.') || source,
        message: i.message,
      }));
      return next(errors.validation('Request validation failed', details));
    }
    // Express 5 forbids assigning to req.query; Express 4 allows it. We set both safely.
    if (source === 'query') {
      Object.assign(req.query as Record<string, unknown>, result.data as Record<string, unknown>);
      for (const key of Object.keys(req.query)) {
        if (!(key in (result.data as object))) delete (req.query as Record<string, unknown>)[key];
      }
      (req as unknown as { validatedQuery: unknown }).validatedQuery = result.data;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any)[source] = result.data;
    }
    next();
  };
}

export function getValidatedQuery<T>(req: unknown): T {
  return (req as { validatedQuery?: T }).validatedQuery as T;
}

export function parseBody<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.') || 'body',
      message: i.message,
    }));
    throw errors.validation('Request validation failed', details);
  }
  return result.data;
}