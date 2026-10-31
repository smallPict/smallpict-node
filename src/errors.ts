import type { ErrorCode } from './types.js';

/**
 * Mask sensitive credentials and tokens from error strings.
 */
export function sanitizeMessage(msg: string): string {
  if (!msg) return msg;
  return msg
    .replace(/sp_(test|sdk|wp)_[a-zA-Z0-9_-]{10,}/g, (match) => {
      return match.substring(0, 10) + '...' + match.substring(match.length - 4);
    })
    .replace(/(sec|secret)_[a-zA-Z0-9_-]{8,}/gi, '***REDACTED***')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ***REDACTED***');
}

/**
 * Base exception class for all SmallPict SDK errors.
 */
export class SmallPictError extends Error {
  public readonly code: ErrorCode;
  public readonly status?: number;
  public readonly requestId?: string;
  public readonly details?: Record<string, unknown>;
  /**
   * Dashboard page where the missing capacity is added (`details.upgrade_url`), or `null`.
   * Shown to the user; the SDK never opens or fetches it.
   */
  public readonly upgradeUrl: string | null;

  constructor(
    message: string,
    code: ErrorCode = 'INTERNAL_ERROR',
    status?: number,
    requestId?: string,
    details?: Record<string, unknown>
  ) {
    const safeMessage = sanitizeMessage(message);
    super(safeMessage);
    this.name = 'SmallPictError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
    this.upgradeUrl = typeof details?.upgrade_url === 'string' ? details.upgrade_url : null;

    Object.setPrototypeOf(this, new.target.prototype);
  }

  public override toString(): string {
    return `[${this.name}] (${this.code}${this.status ? ` HTTP ${this.status}` : ''}): ${this.message}${
      this.requestId ? ` (Request ID: ${this.requestId})` : ''
    }`;
  }
}

export class ValidationError extends SmallPictError {
  constructor(message: string, requestId?: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_FAILED', 400, requestId, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends SmallPictError {
  constructor(message: string, requestId?: string, details?: Record<string, unknown>) {
    super(message, 'UNAUTHORIZED', 401, requestId, details);
    this.name = 'AuthenticationError';
  }
}

export class PermissionDeniedError extends SmallPictError {
  /** Modes the plan allows, from `details.allowed_modes` of `mode_not_in_plan`; otherwise `null`. */
  public readonly allowedModes: string[] | null;

  constructor(message: string, requestId?: string, details?: Record<string, unknown>) {
    super(message, 'FORBIDDEN', 403, requestId, details);
    this.name = 'PermissionDeniedError';
    const modes = details?.allowed_modes;
    this.allowedModes = Array.isArray(modes) ? modes.filter((m): m is string => typeof m === 'string') : null;
  }
}

export class NotFoundError extends SmallPictError {
  constructor(message: string, requestId?: string, details?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, requestId, details);
    this.name = 'NotFoundError';
  }
}

export class QuotaExceededError extends SmallPictError {
  constructor(message: string, requestId?: string, details?: Record<string, unknown>) {
    super(message, 'QUOTA_EXCEEDED', 402, requestId, details);
    this.name = 'QuotaExceededError';
  }
}

export class RateLimitError extends SmallPictError {
  public readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    retryAfterSeconds?: number,
    requestId?: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, requestId, details);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ServerError extends SmallPictError {
  constructor(message: string, status = 500, requestId?: string, details?: Record<string, unknown>) {
    super(message, 'INTERNAL_ERROR', status, requestId, details);
    this.name = 'ServerError';
  }
}

export class TimeoutError extends SmallPictError {
  constructor(message = 'Request timed out after maximum duration', requestId?: string) {
    super(message, 'TIMEOUT_ERROR', 408, requestId);
    this.name = 'TimeoutError';
  }
}

export class NetworkError extends SmallPictError {
  constructor(message: string, originalError?: unknown) {
    super(
      `Network communication failed: ${message}`,
      'NETWORK_ERROR',
      0,
      undefined,
      originalError instanceof Error ? { cause: originalError.message } : undefined
    );
    this.name = 'NetworkError';
  }
}

/**
 * Factory to map HTTP status and JSON response payload to typed SmallPict exceptions.
 */
export function createErrorFromResponse(
  status: number,
  body: unknown,
  requestId?: string,
  retryAfterHeader?: string | null
): SmallPictError {
  let message = `API request failed with HTTP ${status}`;
  let code: ErrorCode = 'INTERNAL_ERROR';
  let details: Record<string, unknown> | undefined;

  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, any>;
    if (b.error) {
      if (typeof b.error === 'string') {
        message = b.error;
      } else if (typeof b.error === 'object') {
        message = b.error.message || message;
        code = b.error.code || code;
        details = b.error.details;
      }
    } else if (b.message) {
      message = b.message;
    }
  } else if (typeof body === 'string' && body.trim().length > 0) {
    message = body;
  }

  const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) || undefined : undefined;

  switch (status) {
    case 400:
      return new ValidationError(message, requestId, details);
    case 401:
      return new AuthenticationError(message, requestId, details);
    case 402:
      return new QuotaExceededError(message, requestId, details);
    case 403:
      return new PermissionDeniedError(message, requestId, details);
    case 404:
      return new NotFoundError(message, requestId, details);
    case 429:
      return new RateLimitError(message, retryAfter, requestId, details);
    default:
      if (status >= 500) {
        return new ServerError(message, status, requestId, details);
      }
      return new SmallPictError(message, code, status, requestId, details);
  }
}
