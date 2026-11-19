import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { AppError, errors, isAppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { env } from '../config/env';
import type { ApiErrorBody } from '@skillora/shared';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(errors.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

function normalize(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof ZodError) {
    return errors.validation(
      'Request validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return new AppError('PAYLOAD_TOO_LARGE', 'Uploaded file is too large');
    return errors.validation(`Upload error: ${err.message}`);
  }
  const anyErr = err as { name?: string; code?: number; message?: string; type?: string };

  // Mongoose validation
  if (anyErr?.name === 'ValidationError') {
    const details = Object.values((err as unknown as { errors: Record<string, { message: string }> }).errors).map(
      (e) => ({ path: '', message: e.message }),
    );
    return errors.validation('Document validation failed', details);
  }
  // Mongoose bad ObjectId
  if (anyErr?.name === 'CastError') {
    return errors.validation('Invalid identifier supplied');
  }
  // Mongo duplicate key
  if (anyErr?.code === 11000) {
    const key = Object.keys((err as unknown as { keyPattern?: Record<string, unknown> }).keyPattern ?? {})[0];
    return new AppError('CONFLICT', `A record with this ${key ?? 'value'} already exists`);
  }
  // Body parser
  if (anyErr?.type === 'entity.too.large') {
    return new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (anyErr?.type === 'entity.parse.failed') {
    return errors.validation('Malformed JSON body');
  }
  return errors.internal();
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appErr = normalize(err);
  const status = appErr.status;

  if (status >= 500) {
    logger.error(
      { err, reqId: req.id, path: req.originalUrl, method: req.method },
      'Unhandled server error',
    );
  } else {
    logger.warn(
      {
        code: appErr.code,
        msg: appErr.message,
        reqId: req.id,
        path: req.originalUrl,
        method: req.method,
        userId: req.auth?.id,
      },
      'Request rejected',
    );
  }

  const body: ApiErrorBody = {
    success: false,
    error: {
      code: appErr.code,
      message: appErr.expose ? appErr.message : 'Internal server error',
      ...(appErr.details ? { details: appErr.details } : {}),
      ...(req.id ? { requestId: String(req.id) } : {}),
    },
  };

  res.status(status).json(body);
};

export function shouldLogBody(): boolean {
  return env.NODE_ENV !== 'production';
}