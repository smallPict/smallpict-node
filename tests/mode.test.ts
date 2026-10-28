import { describe, it, expect, vi } from 'vitest';
import { SmallPictClient } from '../src/client.js';
import { PermissionDeniedError, ValidationError } from '../src/errors.js';
import type { OptimizeOptions } from '../src/types.js';

// Copy of mapping_cases in smallpict-sdk-shared/compression-modes.json (FND-07); that repo
// is not checked out in CI.
const cases: { name: string; input: OptimizeOptions; wire_mode?: string; error?: boolean }[] = [
  { name: 'no mode, no flag', input: {} },
  { name: 'mode only', input: { mode: 'extreme' }, wire_mode: 'extreme' },
  { name: 'deprecated flag only', input: { lossless: true }, wire_mode: 'lossless' },
  { name: 'flag false is ignored', input: { lossless: false } },
  { name: 'flag agrees with mode', input: { mode: 'lossless', lossless: true }, wire_mode: 'lossless' },
  { name: 'flag contradicts mode', input: { mode: 'lossy', lossless: true }, error: true },
];

function jsonFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function client(fetch: ReturnType<typeof vi.fn>) {
  return new SmallPictClient({ apiKey: 'sp_sdk_testkey1234567890abcdef', secretKey: 'sec_testsecret12345678', fetch, maxRetries: 0 });
}

describe('compression mode', () => {
  for (const tc of cases) {
    it(tc.name, async () => {
      const fetch = jsonFetch(200, { job_id: 'j', status: 'queued' });
      const run = client(fetch).optimize(Buffer.from('img'), tc.input);
      if (tc.error) {
        await expect(run).rejects.toBeInstanceOf(ValidationError);
        expect(fetch).not.toHaveBeenCalled();
        return;
      }
      await run;
      const sent = JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(sent.options.mode).toBe(tc.wire_mode);
      expect('lossless' in sent.options).toBe(false);
    });
  }

  it('reads mode_applied and quality_applied from the job status', async () => {
    const fetch = jsonFetch(200, { job_id: 'j', status: 'completed', mode_applied: 'lossy', quality_applied: 65 });
    const status = await client(fetch).getJobStatus('j');
    expect(status.modeApplied).toBe('lossy');
    expect(status.qualityApplied).toBe(65);
  });

  it('surfaces 403 mode_not_in_plan with allowed_modes', async () => {
    const fetch = jsonFetch(403, {
      error: { code: 'mode_not_in_plan', message: 'The lossless compression mode is not included in the Free plan.', details: { mode: 'lossless', allowed_modes: ['lossy', 'extreme'] } },
    });
    const err = await client(fetch).optimize(Buffer.from('img'), { mode: 'lossless' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect((err as PermissionDeniedError).details?.allowed_modes).toEqual(['lossy', 'extreme']);
    expect((err as PermissionDeniedError).message).toContain('not included in the Free plan');
  });
});
