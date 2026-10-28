/**
 * Target output image format for transcoding.
 */
export type ImageFormat = 'auto' | 'avif' | 'webp' | 'jpeg' | 'png';

/**
 * Image resizing fit mode.
 */
export type FitMode = 'cover' | 'contain' | 'inside' | 'outside';

/**
 * Compression mode. The server checks it against the plan: a mode outside the plan is
 * `403 mode_not_in_plan` (`PermissionDeniedError`, `details.allowed_modes`).
 */
export type CompressionMode = 'lossy' | 'extreme' | 'lossless';

/**
 * Every compression mode the API accepts.
 */
export const COMPRESSION_MODES: readonly CompressionMode[] = ['lossy', 'extreme', 'lossless'];

/**
 * Fallback behavior when monthly quota limit is reached.
 * - 'throw': Throws QuotaExceededError (default).
 * - 'passthrough': Returns original unoptimized image with a warning log.
 */
export type FallbackMode = 'throw' | 'passthrough';

/**
 * Supported binary or reference input types for image optimization.
 */
export type ImageSource =
  | Buffer
  | Uint8Array
  | ArrayBuffer
  | Blob
  | File
  | ReadableStream
  | string; // URL or File path string

/**
 * Configuration options for initializing the SmallPict SDK client.
 */
export interface ClientOptions {
  /**
   * SmallPict API Key (e.g. `sp_sdk_...`, `sp_test_...`, `sp_wp_...`).
   * Can also be sourced from `process.env.SMALLPICT_API_KEY`.
   */
  apiKey: string;

  /**
   * Secret Key used to generate HMAC-SHA256 request signatures.
   * Can also be sourced from `process.env.SMALLPICT_SECRET_KEY`.
   */
  secretKey?: string;

  /**
   * API Base URL (defaults to `https://api.smallpict.app/v1`).
   */
  baseUrl?: string;

  /**
   * Request timeout in milliseconds (default: 30,000ms / 30s).
   */
  timeoutMs?: number;

  /**
   * Maximum number of retry attempts for 429 and transient 5xx errors (default: 3).
   */
  maxRetries?: number;

  /**
   * Fallback mode when account quota is exhausted (default: 'throw').
   */
  fallbackMode?: FallbackMode;

  /**
   * Custom `fetch` function implementation (optional, defaults to global `fetch`).
   */
  fetch?: typeof fetch;
}

/**
 * Transformation and compression options for image optimization.
 */
export interface OptimizeOptions {
  /**
   * Target format (defaults to 'auto' for intelligent AVIF/WebP auto-negotiation).
   */
  format?: ImageFormat;

  /**
   * Compression mode (server default: 'lossy').
   */
  mode?: CompressionMode;

  /**
   * Compression quality (1 - 100, defaults to 80). The server applies the floor of the
   * mode and reports the value used as `qualityApplied` in the job status.
   */
  quality?: number;

  /**
   * Maximum bounding width constraint in pixels.
   */
  maxWidth?: number;

  /**
   * Maximum bounding height constraint in pixels.
   */
  maxHeight?: number;

  /**
   * Maximum bounding dimension constraint (longest edge) in pixels.
   */
  maxDimension?: number;

  /**
   * Resizing fit behavior.
   */
  fit?: FitMode;

  /**
   * @deprecated Use `mode: 'lossless'`. `true` is sent as `mode: 'lossless'`; combined with a
   * different `mode` it throws a `ValidationError`.
   */
  lossless?: boolean;

  /**
   * Strip private EXIF, GPS, and camera metadata (default: true).
   */
  stripMetadata?: boolean;

  /**
   * Suggested filename for pre-signed storage mapping.
   */
  filename?: string;

  /**
   * Explicit MIME type of input image (e.g. 'image/jpeg', 'image/png').
   */
  mimeType?: string;

  /**
   * Alias for mimeType.
   */
  contentType?: string;

  /**
   * Idempotency key UUID to guarantee single processing on network retries.
   */
  idempotencyKey?: string;
}

/**
 * Result returned after successful image optimization.
 */
export interface OptimizeResult {
  /**
   * Unique Job identifier.
   */
  jobId: string;

  /**
   * Processing status.
   */
  status: 'completed' | 'queued' | 'processing' | 'failed';

  /**
   * Permanent Edge CDN delivery URL for the optimized asset.
   */
  url: string;

  /**
   * Output image format (e.g. 'avif', 'webp').
   */
  format: string;

  /**
   * Original file size in bytes.
   */
  originalSize: number;

  /**
   * Compressed file size in bytes.
   */
  compressedSize: number;

  /**
   * Total bytes saved.
   */
  bytesSaved: number;

  /**
   * Percentage saved (e.g. 88.5).
   */
  savingsPercentage: number;

  /**
   * Pre-signed upload URL if large binary stream upload is required.
   */
  uploadUrl?: string;

  /**
   * Binary data if requested in buffer mode.
   */
  data?: Uint8Array;
}

/**
 * Status response for asynchronous conversion job polling.
 */
export interface JobStatusResult {
  jobId: string;
  status: 'completed' | 'queued' | 'processing' | 'failed';
  url?: string;
  format?: string;
  bytesSaved?: number;
  /**
   * Mode the server's encoder used; absent for older jobs or when no encoder ran.
   */
  modeApplied?: string;
  /**
   * Quality the server's encoder used, on the codec's own scale.
   */
  qualityApplied?: number;
  error?: {
    message: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Real-time storage and CDN egress metrics.
 */
export interface QuotaResponse {
  plan: string;
  bytesUsed: number;
  quotaLimit: number;
  quotaPercentage: number;
  cdnEgressUsedBytes?: number;
  cdnEgressQuotaBytes?: number;
  activeKeysCount?: number;
  activeSitesCount?: number;
}

/**
 * Options for invalidating Edge CDN cache.
 */
export interface PurgeOptions {
  /**
   * List of full CDN asset URLs to invalidate.
   */
  urls?: string[];

  /**
   * Purge scope ('url' for specific assets, 'all' for complete edge zone purge).
   */
  purgeType?: 'url' | 'all';
}

/**
 * Result of CDN purge request.
 */
export interface PurgeResponse {
  message: string;
}

/**
 * Standard domain error codes returned by SmallPict backend.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'OVERAGE_EXCEEDED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'invalid_mode'
  | 'mode_not_in_plan'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR';
