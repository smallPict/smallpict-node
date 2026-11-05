import { describe, it, expect, vi } from 'vitest';
import { SmallPictClient } from '../src/client.js';
import { SmallPictError, TimeoutError, ValidationError } from '../src/errors.js';

const UPLOAD_URL = 'https://smallpict-staging.s3.test/uploads/me/job-1/photo.png?X-Amz-Signature=abc';

function json(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Fake transport: POST queues the job, PUT stores the bytes, each GET pops the next status. */
function fakeApi(statuses: unknown[], put = { ok: true, status: 200 }) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === UPLOAD_URL) return { ...put, headers: new Headers(), text: async () => 'AccessDenied' };
    if (init?.method === 'POST') return json({ job_id: 'job-1', status: 'queued', upload_url: UPLOAD_URL });
    if (url.includes('/v1/optimize/status?job_id=job-1')) return json(statuses.length > 1 ? statuses.shift() : statuses[0]);
    throw new Error(`unexpected request ${init?.method} ${url}`);
  });
  return fetch;
}

function client(fetch: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) {
  return new SmallPictClient({
    apiKey: 'sp_sdk_testkey1234567890abcdef',
    secretKey: 'sec_testsecret12345678',
    fetch: fetch as unknown as typeof globalThis.fetch,
    maxRetries: 0,
    pollIntervalMs: 1,
    waitTimeoutMs: 200,
    ...extra,
  });
}

describe('optimize() uploads the bytes and waits for the job', () => {
  it('PUTs the bytes to upload_url without auth headers, polls, and returns the status fields', async () => {
    const fetch = fakeApi([
      { job_id: 'job-1', status: 'processing' },
      { job_id: 'job-1', status: 'completed', url: 'https://cdn.test/out.webp', format: 'webp', bytes_saved: 4, mode_applied: 'lossy', quality_applied: 80, folder: 'blog/2026' },
    ]);
    const bytes = Buffer.from('png bytes!');
    const result = await client(fetch).optimize(bytes, { mimeType: 'image/png', filename: 'photo.png', folder: 'blog/2026' });

    const calls = fetch.mock.calls.map(([url, init]) => `${(init as RequestInit).method} ${url}`);
    expect(calls[0]).toBe('POST https://api.smallpict.app/v1/optimize');
    expect(calls[1]).toBe(`PUT ${UPLOAD_URL}`);
    expect(calls.slice(2)).toEqual([
      'GET https://api.smallpict.app/v1/optimize/status?job_id=job-1',
      'GET https://api.smallpict.app/v1/optimize/status?job_id=job-1',
    ]);

    const put = fetch.mock.calls[1]![1] as RequestInit;
    const headers = put.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('image/png');
    expect(headers['Content-Length']).toBe('10');
    expect(Object.keys(headers).sort()).toEqual(['Content-Length', 'Content-Type']);
    expect(Buffer.from(put.body as Uint8Array).toString()).toBe('png bytes!');

    expect(result).toMatchObject({
      jobId: 'job-1',
      status: 'completed',
      url: 'https://cdn.test/out.webp',
      format: 'webp',
      originalSize: 10,
      compressedSize: 6,
      bytesSaved: 4,
      savingsPercentage: 40,
      modeApplied: 'lossy',
      qualityApplied: 80,
      folder: 'blog/2026',
    });
    expect(result.uploadUrl).toBeUndefined();
  });

  it('throws SmallPictError job_failed with the server message when the job fails', async () => {
    const fetch = fakeApi([{ job_id: 'job-1', status: 'failed', error: { message: 'client upload never arrived' } }]);
    const err = await client(fetch).optimize(Buffer.from('x')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmallPictError);
    expect((err as SmallPictError).code).toBe('job_failed');
    expect((err as SmallPictError).message).toBe('client upload never arrived');
    expect((err as SmallPictError).details).toEqual({ job_id: 'job-1' });
  });

  it('throws TimeoutError naming the job when waitTimeoutMs passes', async () => {
    const fetch = fakeApi([{ job_id: 'job-1', status: 'processing' }]);
    const err = await client(fetch, { waitTimeoutMs: 20 }).optimize(Buffer.from('x')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as Error).message).toContain('job-1');
    expect(fetch.mock.calls.filter(([, init]) => (init as RequestInit).method === 'GET').length).toBeGreaterThan(1);
  });

  it('throws SmallPictError upload_failed when the storage refuses the PUT', async () => {
    const fetch = fakeApi([], { ok: false, status: 403 });
    const err = await client(fetch).optimize(Buffer.from('x')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmallPictError);
    expect((err as SmallPictError).code).toBe('upload_failed');
    expect((err as SmallPictError).status).toBe(403);
    expect(fetch.mock.calls.length).toBe(2);
  });

  it('rejects an http(s) source before any request', async () => {
    const fetch = fakeApi([]);
    await expect(client(fetch).optimize('https://example.com/a.png')).rejects.toBeInstanceOf(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
