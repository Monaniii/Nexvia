export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PRECONDITION_FAILED'
  | 'PAYMENT_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PRECONDITION_FAILED: 412,
  PAYMENT_ERROR: 402,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export interface FieldIssue {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: FieldIssue[];
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, details?: FieldIssue[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
    this.expose = this.status < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const errors = {
  validation: (message = 'Request validation failed', details?: FieldIssue[]) =>
    new AppError('VALIDATION_ERROR', message, details),
  unauthorized: (message = 'Authentication required') => new AppError('UNAUTHORIZED', message),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppError('FORBIDDEN', message),
  notFound: (message = 'Resource not found') => new AppError('NOT_FOUND', message),
  conflict: (message = 'Resource conflict') => new AppError('CONFLICT', message),
  rateLimited: (message = 'Too many requests, please try again later') =>
    new AppError('RATE_LIMITED', message),
  precondition: (message: string) => new AppError('PRECONDITION_FAILED', message),
  payment: (message: string) => new AppError('PAYMENT_ERROR', message),
  unavailable: (message: string) => new AppError('SERVICE_UNAVAILABLE', message),
  internal: (message = 'Internal server error') => new AppError('INTERNAL_ERROR', message),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}