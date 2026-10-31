import { describe, it, expect, vi } from 'vitest';
import { SmallPictClient } from '../src/client.js';
import { AuthenticationError, QuotaExceededError, ValidationError } from '../src/errors.js';

describe('SmallPictClient', () => {
  it('throws ValidationError if no API key is provided', () => {
    expect(() => new SmallPictClient({ apiKey: '' })).toThrow(ValidationError);
  });

  it('successfully optimizes an image buffer using mock fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': 'req_opt_001',
      }),
      json: async () => ({
        job_id: 'job-123-abc',
        status: 'completed',
        url: 'https://cdn.smallpict.app/opt/test.avif',
        format: 'avif',
        original_size: 100000,
        compressed_size: 15000,
        bytes_saved: 85000,
        savings_percentage: 85.0,
      }),
    });

    const client = new SmallPictClient({
      apiKey: 'sp_sdk_testkey1234567890abcdef',
      secretKey: 'sec_testsecret12345678',
      fetch: mockFetch,
    });

    const buffer = Buffer.from('fake image binary content');
    const result = await client.optimize(buffer, {
      format: 'avif',
      quality: 85,
    });

    expect(result.status).toBe('completed');
    expect(result.url).toBe('https://cdn.smallpict.app/opt/test.avif');
    expect(result.savingsPercentage).toBe(85);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const callArgs = mockFetch.mock.calls[0]!;
    expect(callArgs[0]).toBe('https://api.smallpict.app/v1/optimize');
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('sp_sdk_testkey1234567890abcdef');
    expect(headers['X-Signature']).toBeDefined();
    expect(headers['X-Timestamp']).toBeDefined();
    expect(headers['Idempotency-Key']).toBeDefined();
  });

  it('retrieves quota metrics correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        plan: 'api_velocity',
        bytes_used: 1258291200,
        quota_limit: 10737418240,
        quota_percentage: 11.72,
        cdn_egress_used_bytes: 3450000000,
        cdn_egress_quota_bytes: 53687091200,
      }),
    });

    const client = new SmallPictClient({
      apiKey: 'sp_sdk_testkey1234567890abcdef',
      fetch: mockFetch,
    });

    const quota = await client.getQuota();
    expect(quota.plan).toBe('api_velocity');
    expect(quota.bytesUsed).toBe(1258291200);
    expect(quota.quotaPercentage).toBe(11.72);
  });

  it('purges CDN cache successfully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        message: 'Purge job enqueued successfully',
      }),
    });

    const client = new SmallPictClient({
      apiKey: 'sp_sdk_testkey1234567890abcdef',
      fetch: mockFetch,
    });

    const res = await client.purgeCdn(['https://cdn.smallpict.app/opt/hero.avif']);
    expect(res.message).toBe('Purge job enqueued successfully');
    expect('deliveryModes' in res).toBe(false);

    const callArgs = mockFetch.mock.calls[0]!;
    expect(callArgs[0]).toBe('https://api.smallpict.app/v1/purge');
  });

  it('maps delivery_modes of a purge to deliveryModes', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ message: 'Purge job enqueued successfully', delivery_modes: ['byo'] }),
    });
    const client = new SmallPictClient({ apiKey: 'sp_sdk_testkey1234567890abcdef', fetch: mockFetch });

    const res = await client.purgeCdn({ purgeType: 'all' });
    expect(res).toEqual({ message: 'Purge job enqueued successfully', deliveryModes: ['byo'] });
  });

  it('validates key returning true on 200 and false on 401', async () => {
    const successFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ plan: 'starter' }),
    });

    const clientValid = new SmallPictClient({
      apiKey: 'sp_sdk_valid',
      fetch: successFetch,
    });
    expect(await clientValid.validateKey()).toBe(true);

    const failFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: { code: 'UNAUTHORIZED', message: 'Bad key' } }),
    });

    const clientInvalid = new SmallPictClient({
      apiKey: 'sp_sdk_invalid',
      fetch: failFetch,
    });
    expect(await clientInvalid.validateKey()).toBe(false);
  });

  it('retries on 429 and eventually succeeds', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 2) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '0' }),
          json: async () => ({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Slow down' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ plan: 'scale' }),
      };
    });

    const client = new SmallPictClient({
      apiKey: 'sp_sdk_test',
      fetch: mockFetch,
    });

    const quota = await client.getQuota();
    expect(quota.plan).toBe('scale');
    expect(callCount).toBe(2);
  });

  it('supports fallbackMode: passthrough on QuotaExceededError', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: { code: 'QUOTA_EXCEEDED', message: 'Limit reached' } }),
    });

    const client = new SmallPictClient({
      apiKey: 'sp_sdk_test',
      fallbackMode: 'passthrough',
      fetch: mockFetch,
    });

    const buffer = Buffer.from('uncompressed image data');
    const result = await client.optimize(buffer, { filename: 'photo.jpg' });

    expect(result.jobId).toBe('fallback-passthrough');
    expect(result.savingsPercentage).toBe(0);
    expect(result.bytesSaved).toBe(0);
  });
});
