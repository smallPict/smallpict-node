import { HttpClient } from './http.js';
import { QuotaExceededError, ValidationError } from './errors.js';
import type {
  ClientOptions,
  CompressionMode,
  FallbackMode,
  ImageSource,
  JobStatusResult,
  OptimizeOptions,
  OptimizeResult,
  PurgeOptions,
  PurgeResponse,
  QuotaResponse,
} from './types.js';

/**
 * Resolves the wire `mode` from `mode` and the deprecated `lossless` flag.
 */
export function resolveMode(options?: OptimizeOptions): CompressionMode | undefined {
  const lossless = options?.lossless === true;
  if (options?.mode) {
    if (lossless && options.mode !== 'lossless') {
      throw new ValidationError(`lossless: true contradicts mode: '${options.mode}'. Use mode only.`);
    }
    return options.mode;
  }
  return lossless ? 'lossless' : undefined;
}

/**
 * Light client-side check of an upload folder; the server applies the full rule (`invalid_folder`).
 */
export function validateFolder(folder: string): void {
  const segments = folder.split('/');
  if (segments.length > 3 || segments.some((s) => s === '' || s === '..')) {
    throw new ValidationError(
      `Invalid folder '${folder}': use 1-3 segments separated by '/', without empty or '..' segments.`
    );
  }
}

/**
 * Helper to inspect binary size and mime type from ImageSource.
 */
async function resolveImageSource(
  source: ImageSource,
  options?: OptimizeOptions
): Promise<{ filename: string; mimeType: string; filesize: number; buffer?: Uint8Array }> {
  let filename = options?.filename || 'image.jpg';
  let mimeType = options?.mimeType || options?.contentType || 'image/jpeg';
  let filesize = 0;
  let buffer: Uint8Array | undefined;

  if (typeof source === 'string') {
    // If it's a URL or path
    if (source.startsWith('http://') || source.startsWith('https://')) {
      filename = source.split('/').pop()?.split('?')[0] || filename;
      return { filename, mimeType, filesize: 0 };
    }
    // Base64 Data URI
    if (source.startsWith('data:')) {
      const parts = source.split(',');
      const match = parts[0]?.match(/:(.*?);/);
      if (match && match[1]) mimeType = match[1];
      const binaryStr = atob(parts[1] || '');
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      buffer = bytes;
      filesize = bytes.length;
      return { filename, mimeType, filesize, buffer };
    }
  } else if (typeof Blob !== 'undefined' && source instanceof Blob) {
    mimeType = source.type || mimeType;
    if (typeof File !== 'undefined' && source instanceof File) {
      filename = source.name || filename;
    }
    filesize = source.size;
    const arrayBuf = await source.arrayBuffer();
    buffer = new Uint8Array(arrayBuf);
    return { filename, mimeType, filesize, buffer };
  } else if (source instanceof ArrayBuffer) {
    buffer = new Uint8Array(source);
    filesize = buffer.length;
    return { filename, mimeType, filesize, buffer };
  } else if (source instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(source))) {
    buffer = source instanceof Uint8Array ? source : new Uint8Array(source);
    filesize = buffer.length;
    return { filename, mimeType, filesize, buffer };
  }

  return { filename, mimeType, filesize, buffer };
}

/**
 * Official SmallPict SDK Client.
 */
export class SmallPictClient {
  private readonly http: HttpClient;
  private readonly fallbackMode: FallbackMode;

  constructor(options?: Partial<ClientOptions>) {
    const apiKey = options?.apiKey || (typeof process !== 'undefined' ? process.env?.['SMALLPICT_API_KEY'] : undefined);
    const secretKey = options?.secretKey || (typeof process !== 'undefined' ? process.env?.['SMALLPICT_SECRET_KEY'] : undefined);

    if (!apiKey) {
      throw new ValidationError(
        'Missing required SmallPict API key. Provide `apiKey` in ClientOptions or set SMALLPICT_API_KEY environment variable.'
      );
    }

    this.fallbackMode = options?.fallbackMode || 'throw';

    this.http = new HttpClient({
      apiKey,
      secretKey,
      baseUrl: options?.baseUrl,
      timeoutMs: options?.timeoutMs,
      maxRetries: options?.maxRetries,
      fetch: options?.fetch,
    });
  }

  /**
   * Optimize, compress, and transcode an image asset.
   *
   * @param source Binary buffer, Blob, File, Stream, or URL
   * @param options Compression and resizing parameters
   * @returns Optimized result with permanent CDN delivery URL
   *
   * @example
   * ```ts
   * const result = await client.optimize(imageBuffer, {
   *   format: 'avif',
   *   quality: 80,
   *   maxWidth: 1920
   * });
   * console.log(`Optimized URL: ${result.url}, Saved: ${result.savingsPercentage}%`);
   * ```
   */
  public async optimize(source: ImageSource, options?: OptimizeOptions): Promise<OptimizeResult> {
    const mode = resolveMode(options);
    if (options?.folder !== undefined) validateFolder(options.folder);
    const resolved = await resolveImageSource(source, options);

    const payload = {
      filename: resolved.filename,
      mime_type: resolved.mimeType,
      content_type: resolved.mimeType,
      filesize: resolved.filesize,
      options: {
        format: options?.format || 'auto',
        quality: options?.quality, // undefined is dropped by JSON.stringify: the server picks the default per mode
        max_width: options?.maxWidth,
        max_height: options?.maxHeight,
        max_dimension: options?.maxDimension,
        fit: options?.fit || 'cover',
        mode,
        folder: options?.folder,
        strip_metadata: options?.stripMetadata ?? true,
      },
    };

    try {
      const response = await this.http.request<Record<string, any>>({
        method: 'POST',
        path: '/v1/optimize',
        body: payload,
        idempotencyKey: options?.idempotencyKey,
      });

      const res = response.data;
      const originalSize = res.original_size || resolved.filesize;
      const compressedSize = res.compressed_size || originalSize;
      const bytesSaved = res.bytes_saved ?? Math.max(0, originalSize - compressedSize);
      const savingsPercentage =
        res.savings_percentage ?? (originalSize > 0 ? ((bytesSaved / originalSize) * 100) : 0);

      return {
        jobId: res.job_id || 'sync',
        status: res.status || 'completed',
        url: res.url || '',
        format: res.format || options?.format || 'auto',
        originalSize,
        compressedSize,
        bytesSaved,
        savingsPercentage: Number(savingsPercentage.toFixed(2)),
        uploadUrl: res.upload_url,
        folder: res.folder,
      };
    } catch (err: unknown) {
      if (err instanceof QuotaExceededError && this.fallbackMode === 'passthrough') {
        // Fallback gracefully without crashing caller
        return {
          jobId: 'fallback-passthrough',
          status: 'completed',
          url: typeof source === 'string' ? source : '',
          format: resolved.mimeType.replace('image/', ''),
          originalSize: resolved.filesize,
          compressedSize: resolved.filesize,
          bytesSaved: 0,
          savingsPercentage: 0,
          data: resolved.buffer,
        };
      }
      throw err;
    }
  }

  /**
   * Check real-time storage quota and CDN egress bandwidth metrics.
   *
   * @returns Quota usage metrics
   *
   * @example
   * ```ts
   * const quota = await client.getQuota();
   * console.log(`Quota used: ${quota.quotaPercentage}% (${quota.bytesUsed} bytes)`);
   * ```
   */
  public async getQuota(): Promise<QuotaResponse> {
    const response = await this.http.request<Record<string, any>>({
      method: 'GET',
      path: '/v1/quota',
    });

    const d = response.data;
    const bytesUsed = d.bytes_used ?? 0;
    const quotaLimit = d.quota_limit ?? 0;
    const quotaPercentage =
      d.quota_percentage ?? (quotaLimit > 0 ? Number(((bytesUsed / quotaLimit) * 100).toFixed(2)) : 0);

    return {
      plan: d.plan || 'free',
      bytesUsed,
      quotaLimit,
      quotaPercentage,
      cdnEgressUsedBytes: d.cdn_egress_used_bytes,
      cdnEgressQuotaBytes: d.cdn_egress_quota_bytes,
      activeKeysCount: d.active_keys_count,
      activeSitesCount: d.active_sites_count,
    };
  }

  /**
   * Invalidate and purge cached assets across global CDN edge locations.
   *
   * @param options List of URLs or purge scope options
   * @returns Purge confirmation response
   *
   * @example
   * ```ts
   * await client.purgeCdn({ urls: ['https://cdn.smallpict.app/opt/hero.avif'] });
 * await client.purgeCdn({ purgeType: 'folder', folder: 'blog/2026' });
   * ```
   */
  public async purgeCdn(options?: PurgeOptions | string[]): Promise<PurgeResponse> {
    let payload: PurgeOptions = { purgeType: 'url', urls: [] };

    if (Array.isArray(options)) {
      payload = { purgeType: 'url', urls: options };
    } else if (options) {
      payload = {
        purgeType: options.purgeType || 'url',
        urls: options.urls || [],
      };
      if (payload.purgeType === 'folder') {
        if (options.folder === undefined || options.folder === '') {
          throw new ValidationError("folder is required for purgeType 'folder'");
        }
        validateFolder(options.folder);
        payload.folder = options.folder;
      }
    }

    const response = await this.http.request<PurgeResponse>({
      method: 'POST',
      path: '/v1/purge',
      body: {
        purge_type: payload.purgeType,
        folder: payload.folder,
        urls: payload.urls,
      },
    });

    return response.data;
  }

  /**
   * Validate if the configured API credentials are valid and active.
   *
   * @returns True if credentials are valid, false otherwise.
   *
   * @example
   * ```ts
   * if (await client.validateKey()) {
   *   console.log('Credentials valid!');
   * }
   * ```
   */
  public async validateKey(): Promise<boolean> {
    try {
      await this.getQuota();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Poll current status of an asynchronous image conversion job.
   *
   * @param jobId UUID of the job
   * @returns Job status and CDN delivery URL if completed
   */
  public async getJobStatus(jobId: string): Promise<JobStatusResult> {
    if (!jobId) {
      throw new ValidationError('jobId parameter is required');
    }

    const response = await this.http.request<Record<string, any>>({
      method: 'GET',
      path: `/v1/optimize/status?job_id=${encodeURIComponent(jobId)}`,
    });

    const d = response.data;
    return {
      jobId: d.job_id || jobId,
      status: d.status || 'processing',
      url: d.url,
      format: d.format,
      bytesSaved: d.bytes_saved,
      modeApplied: d.mode_applied,
      qualityApplied: d.quality_applied,
      folder: d.folder,
      error: d.error,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    };
  }
}
