export { SmallPictClient, SmallPictClient as default } from './client.js';

export {
  SmallPictError,
  ValidationError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  QuotaExceededError,
  RateLimitError,
  ServerError,
  TimeoutError,
  NetworkError,
  sanitizeMessage,
} from './errors.js';

export {
  hmacSha256Hex,
  sha256Hex,
  buildStringToSign,
  bufferToHex,
  EMPTY_SHA256,
} from './crypto.js';

export { COMPRESSION_MODES } from './types.js';

export type {
  ClientOptions,
  OptimizeOptions,
  OptimizeResult,
  JobStatusResult,
  QuotaResponse,
  PurgeOptions,
  PurgeResponse,
  ImageFormat,
  FitMode,
  CompressionMode,
  FallbackMode,
  ImageSource,
  ErrorCode,
} from './types.js';
