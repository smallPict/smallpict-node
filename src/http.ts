import { buildStringToSign, EMPTY_SHA256, hmacSha256Hex, sha256Hex } from './crypto.js';
import { createErrorFromResponse, NetworkError, SmallPictError, TimeoutError } from './errors.js';
import type { ClientOptions } from './types.js';

export interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  customHeaders?: Record<string, string>;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
  requestId?: string;
}

/**
 * Generate standard UUID v4 for idempotency keys.
 */
export function generateUUID(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  // Fallback pseudorandom UUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Sleep utility for exponential backoff.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTP Client executing authenticated requests with timeouts, retry, and backoff.
 */
export class HttpClient {
  private readonly apiKey: string;
  private readonly secretKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.secretKey = options.secretKey;
    this.baseUrl = (options.baseUrl || 'https://api.smallpict.app').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetch || globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error('No global fetch implementation found. Pass a custom fetch in ClientOptions.');
    }
  }

  /**
   * PUT raw bytes to a pre-signed storage URL. No API headers: the URL is signed for exactly
   * this Content-Type and Content-Length, and S3 refuses anything else. No retry: the worker
   * stops waiting for the object 30 s after the job was queued.
   */
  public async upload(url: string, body: Uint8Array, contentType: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType, 'Content-Length': String(body.byteLength) },
        body: body as unknown as BodyInit, // TS 5.7+ types Uint8Array<ArrayBufferLike> outside BodyInit
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new SmallPictError(`Upload to staging failed with HTTP ${response.status}${text ? `: ${text}` : ''}`, 'upload_failed', response.status);
      }
    } catch (err: unknown) {
      if (err instanceof SmallPictError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TimeoutError(`Upload to staging exceeded timeout of ${this.timeoutMs}ms`);
      }
      throw new NetworkError(err instanceof Error ? err.message : String(err), err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public async request<T = unknown>(options: RequestOptions): Promise<HttpResponse<T>> {
    const { method, path, body, idempotencyKey, customHeaders } = options;
    let cleanPath = path.startsWith('/') ? path : `/${path}`;
    if (!cleanPath.startsWith('/v1/') && !cleanPath.startsWith('/v2/')) {
      cleanPath = `/v1${cleanPath}`;
    }
    const url = `${this.baseUrl}${cleanPath}`;

    let serializedBody: string | undefined;
    let bodyHash = EMPTY_SHA256;

    if (body !== undefined && body !== null) {
      if (typeof body === 'string') {
        serializedBody = body;
        bodyHash = await sha256Hex(serializedBody);
      } else if (body instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(body))) {
        bodyHash = await sha256Hex(body);
      } else {
        serializedBody = JSON.stringify(body);
        bodyHash = await sha256Hex(serializedBody);
      }
    }

    let attempt = 0;
    const baseDelayMs = 250;

    while (attempt <= this.maxRetries) {
      attempt++;
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-API-Key': this.apiKey,
        ...customHeaders,
      };

      if (serializedBody !== undefined && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      // Generate HMAC signature if secretKey is provided
      if (this.secretKey) {
        // Path passed to string-to-sign must match OpenAPI path
        const stringToSign = buildStringToSign(method, cleanPath, timestamp, bodyHash);
        const signature = await hmacSha256Hex(this.secretKey, stringToSign);
        headers['X-Timestamp'] = timestamp;
        headers['X-Signature'] = signature;
      } else {
        // Fallback to Bearer token format
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // Add idempotency key for mutating methods
      if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
        headers['Idempotency-Key'] = idempotencyKey || generateUUID();
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body: serializedBody,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const requestId = response.headers.get('x-request-id') || undefined;
        const retryAfterHeader = response.headers.get('retry-after');

        // Check if retryable
        if (response.status === 429 || (response.status >= 500 && response.status <= 504)) {
          if (attempt <= this.maxRetries) {
            // purge_rate_limited is an hourly limit: a retry seconds later cannot succeed.
            if (response.status === 429 && (response.headers.get('content-type') || '').includes('application/json')) {
              const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
              if (data?.error?.code === 'purge_rate_limited') {
                throw createErrorFromResponse(response.status, data, requestId, retryAfterHeader);
              }
            }
            let delayMs = baseDelayMs * Math.pow(2, attempt - 1);
            if (retryAfterHeader) {
              const parsedSeconds = parseInt(retryAfterHeader, 10);
              if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
                delayMs = parsedSeconds * 1000;
              }
            }
            // Add full jitter (0 to 100ms)
            const jitter = Math.floor(Math.random() * 100);
            await sleep(delayMs + jitter);
            continue;
          }
        }

        // Parse body
        let parsedData: unknown;
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          parsedData = await response.json().catch(() => null);
        } else {
          parsedData = await response.text().catch(() => '');
        }

        if (!response.ok) {
          throw createErrorFromResponse(response.status, parsedData, requestId, retryAfterHeader);
        }

        return {
          data: parsedData as T,
          status: response.status,
          headers: response.headers,
          requestId,
        };
      } catch (err: unknown) {
        clearTimeout(timeoutId);

        if (err instanceof Error && err.name === 'AbortError') {
          if (attempt <= this.maxRetries) {
            await sleep(baseDelayMs * Math.pow(2, attempt - 1));
            continue;
          }
          throw new TimeoutError(`Request to ${cleanPath} exceeded timeout of ${this.timeoutMs}ms`);
        }

        // If it's already a SmallPictError, rethrow directly
        if (err && typeof err === 'object' && 'code' in err) {
          throw err;
        }

        // Retry on network errors
        if (attempt <= this.maxRetries) {
          await sleep(baseDelayMs * Math.pow(2, attempt - 1));
          continue;
        }

        throw new NetworkError(err instanceof Error ? err.message : String(err), err);
      }
    }

    throw new NetworkError('Request failed after maximum retry attempts');
  }
}
