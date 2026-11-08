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
export type CompressionMode = 'lossy' | 'extreme' | 'lossless' | 'auto';

/**
 * Every compression mode the API accepts.
 */
export const COMPRESSION_MODES: readonly CompressionMode[] = ['lossy', 'extreme', 'lossless', 'auto'];

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
  | string; // data: URI. An http(s) URL throws ValidationError: the API does not fetch URLs.

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
   * Required: the API refuses unsigned requests.
   * Can also be sourced from `process.env.SMALLPICT_SECRET_KEY`.
   */
  secretKey: string;

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
   * How often `optimize()` polls the job status while waiting (default: 1,000ms).
   */
  pollIntervalMs?: number;

  /**
   * How long `optimize()` waits for the job to finish before throwing `TimeoutError`
   * (default: 120,000ms). The job keeps running; poll `getJobStatus()` later.
   */
  waitTimeoutMs?: number;

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
   * Compression quality (1 - 100). Leave it out and the server picks the default for the mode
   * and output format; a value you set is kept or raised to the mode's floor. The value used is
   * reported as `qualityApplied` in the job status.
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
   * Upload folder for the optimized file (e.g. 'blog/2026'): 1-3 segments, normalized to lower
   * case by the server, which answers `400 invalid_folder` (`ValidationError`) when malformed.
   */
  folder?: string;

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
   * Always 'completed': `optimize()` uploads the bytes and waits for the job. A failed job
   * throws `SmallPictError` (`job_failed`); a job still running after `waitTimeoutMs` throws
   * `TimeoutError`.
   */
  status: 'completed';

  /**
   * Delivery URL of the optimized asset from the job status. For managed storage this is a
   * pre-signed URL valid 10 minutes; `getJobStatus()` returns a fresh one.
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
   * Mode the server's encoder used; absent when no encoder ran.
   */
  modeApplied?: string;

  /**
   * Quality the server's encoder used, on the codec's own scale.
   */
  qualityApplied?: number;

  /**
   * The original bytes, only with `fallbackMode: 'passthrough'` after a quota error.
   */
  data?: Uint8Array;

  /**
   * Folder stored with the job, as normalized by the server; absent without one.
   */
  folder?: string;
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
  /**
   * Folder stored with the job, as normalized by the server; absent without one.
   */
  folder?: string;
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
  /**
   * Read-only capacity of the key's product. `null` when the server could not read it;
   * absent from older servers. Capacity is bought only in the dashboard (`manageUrl`).
   */
  capacity?: Capacity | null;
}

/**
 * Capacity of the key's product from `GET /v1/quota`. A member that does not apply to the
 * product or plan is `null`.
 */
export interface Capacity {
  /** End of the product's current paid period (ISO 8601). */
  periodEnd: string | null;
  /** smallPict-managed storage; `null` on plans without it and for sandbox keys. */
  storage: CapacityStorage | null;
  /** Managed CDN usage of the current cycle; `null` where managed CDN is not reported. */
  cdn: CapacityCDN | null;
  booster: CapacityBooster;
  /** Unpaid-account state of the product; `null` while it is paid up. */
  lapse: CapacityLapse | null;
  /** Dashboard billing page. Show it; the SDK never opens it. */
  manageUrl: string;
}

export interface CapacityStorage {
  /** Limit the account is held to: the largest plan base plus add-ons across its subscriptions. */
  limitBytes: number;
  /** Managed storage used by the whole account. */
  usedBytes: number;
  /** Storage included in the key's plan. */
  baseBytes: number;
  /** Storage add-on blocks (10 GiB each) of the key's product. */
  addonBlocks: number;
}

export interface CapacityCDN {
  limitBytes: number;
  usedBytes: number;
  status: 'ok' | 'warn_80' | 'exceeded_grace' | 'hard_block';
}

/**
 * Booster balances left. A balance that does not apply to the product is `null`.
 */
export interface CapacityBooster {
  /** False: frozen (no active paid subscription), not sold to the plan, or a sandbox key. */
  active: boolean;
  wpQuotaBytes: number | null;
  apiTransforms: number | null;
  cdnBytes: number | null;
  /** The lot that expires first, or `null`. */
  nextExpiry: CapacityExpiry | null;
}

export interface CapacityExpiry {
  kind: 'wp_quota_bytes' | 'api_transforms' | 'cdn_bytes';
  units: number;
  /** ISO 8601. */
  expiresAt: string;
}

export interface CapacityLapse {
  stage: 'grace' | 'blocked' | 'deleting';
  /** When the product's managed files are deleted (ISO 8601); `null` in `grace`. */
  deleteAfter: string | null;
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
   * Purge scope ('url' for specific assets, 'folder' for one upload folder, 'all' for every
   * asset of the account). 'folder' and 'all' are limited per hour: `429 purge_rate_limited`
   * (`RateLimitError`, not retried automatically).
   */
  purgeType?: 'url' | 'folder' | 'all';

  /**
   * Upload folder to purge; required for, and sent only with, `purgeType: 'folder'`.
   */
  folder?: string;
}

/**
 * Result of CDN purge request.
 */
export interface PurgeResponse {
  message: string;
  /**
   * CDN the purge was sent to: `managed` (smallPict's) or `byo` (the customer's own CDN).
   * Absent from older servers.
   */
  deliveryModes?: Array<'managed' | 'byo'>;
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
  | 'invalid_folder'
  | 'purge_rate_limited'
  | 'storage_quota_exceeded'
  | 'account_read_only'
  | 'storage_addon_limit_exceeded'
  | 'storage_addon_unavailable_in_byo_mode'
  | 'storage_reduce_below_usage'
  | 'subscription_not_active'
  | 'booster_not_applicable_in_byo_mode'
  | 'booster_period_limit_exceeded'
  | 'upload_failed'
  | 'job_failed'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR';
