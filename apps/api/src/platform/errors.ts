/**
 * Structured domain errors (Part 31). NEVER `throw new Error("...")` in domain code —
 * throw a typed AppError with a standard ErrorCode. The HTTP layer maps status+code.
 */
import { HTTP_STATUS } from './http.js';

/** Canonical, machine-stable error codes. Extend as domains land; never reuse a code's meaning. */
export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CONFLICT',
  'BAD_REQUEST',
  'UNIT_CODE_EXISTS',
  'UNIT_NOT_FOUND',
  'STALE_UPDATE',
  'VERSION_REQUIRED',
  'STORAGE_NOT_CONFIGURED',
  'INVALID_IMAGE',
  'MALWARE_DETECTED',
  'TOO_MANY_REQUESTS',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Typed application error → mapped to an HTTP status by the error middleware. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }

  static notFound(code: ErrorCode | string = 'NOT_FOUND', message?: string): AppError {
    return new AppError(HTTP_STATUS.NOT_FOUND, code, message);
  }
  static unauthenticated(message?: string): AppError {
    return new AppError(HTTP_STATUS.UNAUTHENTICATED, 'UNAUTHENTICATED', message);
  }
  static forbidden(message?: string): AppError {
    return new AppError(HTTP_STATUS.FORBIDDEN, 'FORBIDDEN', message);
  }
  static conflict(code: ErrorCode | string, message?: string): AppError {
    return new AppError(HTTP_STATUS.CONFLICT, code, message);
  }
  static badRequest(code: ErrorCode | string, details?: unknown): AppError {
    return new AppError(HTTP_STATUS.BAD_REQUEST, code, code, details);
  }
  /** OCC: an update arrived without the required expected `version` (ADR-0019). */
  static versionRequired(): AppError {
    return new AppError(HTTP_STATUS.BAD_REQUEST, 'VERSION_REQUIRED', 'expected version is required');
  }
  /** OCC: the row changed since the client read it. `current` is the fresh row (incl. version). */
  static stale(current: unknown): AppError {
    return new AppError(HTTP_STATUS.CONFLICT, 'STALE_UPDATE', 'record was modified by someone else', {
      current,
    });
  }
  static internal(message?: string): AppError {
    return new AppError(HTTP_STATUS.INTERNAL, 'INTERNAL', message);
  }
}
