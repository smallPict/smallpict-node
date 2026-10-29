import { describe, it, expect, vi } from 'vitest';
import { SmallPictClient } from '../src/client.js';
import { RateLimitError, ValidationError } from '../src/errors.js';

function jsonFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function client(fetch: ReturnType<typeof vi.fn>, maxRetries = 0) {
  return new SmallPictClient({ apiKey: 'sp_sdk_testkey1234567890abcdef', secretKey: 'sec_testsecret12345678', fetch, maxRetries });
}

function sentBody(fetch: ReturnType<typeof vi.fn>) {
  return JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string);
}

describe('upload folder', () => {
  it('sends folder as options.folder', async () => {
    const fetch = jsonFetch(200, { job_id: 'j', status: 'queued' });
    await client(fetch).optimize(Buffer.from('img'), { folder: 'Blog/2026' });
    expect(sentBody(fetch).options.folder).toBe('Blog/2026');
  });

  it('omits folder when unset', async () => {
    const fetch = jsonFetch(200, { job_id: 'j', status: 'queued' });
    await client(fetch).optimize(Buffer.from('img'));
    expect('folder' in sentBody(fetch).options).toBe(false);
  });

  it('surfaces folder from the optimize response and the job status', async () => {
    const fetch = jsonFetch(200, { job_id: 'j', status: 'completed', folder: 'blog/2026' });
    const c = client(fetch);
    expect((await c.optimize(Buffer.from('img'), { folder: 'Blog/2026' })).folder).toBe('blog/2026');
    expect((await c.getJobStatus('j')).folder).toBe('blog/2026');
  });

  for (const bad of ['', 'a//b', '/a', 'a/', '../x', 'a/../b', 'a/b/c/d']) {
    it(`rejects folder '${bad}' before any request`, async () => {
      const fetch = jsonFetch(200, { job_id: 'j', status: 'queued' });
      await expect(client(fetch).optimize(Buffer.from('img'), { folder: bad })).rejects.toBeInstanceOf(ValidationError);
      await expect(client(fetch).purgeCdn({ purgeType: 'folder', folder: bad })).rejects.toBeInstanceOf(ValidationError);
      expect(fetch).not.toHaveBeenCalled();
    });
  }

  it('surfaces 400 invalid_folder as ValidationError with the server message', async () => {
    const fetch = jsonFetch(400, { error: { code: 'invalid_folder', message: 'folder segment contains invalid characters' } });
    const err = await client(fetch).optimize(Buffer.from('img'), { folder: 'a b' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toBe('folder segment contains invalid characters');
  });
});

describe('folder purge', () => {
  it('sends purge_type folder with folder', async () => {
    const fetch = jsonFetch(202, { message: 'Purge job enqueued successfully' });
    await client(fetch).purgeCdn({ purgeType: 'folder', folder: 'products/shoes' });
    expect(sentBody(fetch)).toEqual({ purge_type: 'folder', folder: 'products/shoes', urls: [] });
  });

  it('does not send folder with other purge types', async () => {
    const fetch = jsonFetch(202, { message: 'ok' });
    await client(fetch).purgeCdn({ purgeType: 'all', folder: 'products' });
    expect(sentBody(fetch)).toEqual({ purge_type: 'all', urls: [] });
  });

  it('requires folder for purge type folder', async () => {
    const fetch = jsonFetch(202, { message: 'ok' });
    await expect(client(fetch).purgeCdn({ purgeType: 'folder' })).rejects.toBeInstanceOf(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('raises RateLimitError on 429 purge_rate_limited without retrying', async () => {
    const fetch = jsonFetch(429, { error: { code: 'purge_rate_limited', message: 'Folder purges are limited to 10 per hour.' } });
    const err = await client(fetch, 3).purgeCdn({ purgeType: 'folder', folder: 'blog' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).message).toContain('10 per hour');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
