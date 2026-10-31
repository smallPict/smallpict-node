import { describe, it, expect, vi } from 'vitest';
import { SmallPictClient } from '../src/client.js';
import {
  createErrorFromResponse,
  PermissionDeniedError,
  QuotaExceededError,
  SmallPictError,
} from '../src/errors.js';

// Copy of quota_responses and error_cases in smallpict-sdk-shared/capacity.json; that
// directory is not checked out in CI.
const responses: Record<string, Record<string, unknown>> = {
  wordpress_with_capacity: {
    plan: 'pro',
    bytes_used: 1048576,
    capacity: {
      period_end: '2026-11-30T00:00:00Z',
      storage: { limit_bytes: 75161927680, used_bytes: 7516192768, base_bytes: 53687091200, addon_blocks: 2 },
      cdn: { limit_bytes: 53687091200, used_bytes: 44023414784, status: 'warn_80' },
      booster: {
        active: true,
        wp_quota_bytes: 2147483648,
        api_transforms: null,
        cdn_bytes: 107374182400,
        next_expiry: { kind: 'cdn_bytes', units: 42949672960, expires_at: '2027-01-05T00:00:00Z' },
      },
      lapse: null,
      manage_url: 'https://smallpict.app/dashboard/billing',
    },
  },
  api_blocked: {
    plan: 'velocity',
    bytes_used: 0,
    capacity: {
      period_end: null,
      storage: { limit_bytes: 107374182400, used_bytes: 1073741824, base_bytes: 107374182400, addon_blocks: 0 },
      cdn: null,
      booster: { active: false, wp_quota_bytes: null, api_transforms: 5000, cdn_bytes: null, next_expiry: null },
      lapse: { stage: 'blocked', delete_after: '2027-01-28T00:00:00Z' },
      manage_url: 'https://smallpict.app/dashboard/billing',
    },
  },
  sandbox: {
    plan: 'sandbox',
    bytes_used: 0,
    capacity: {
      period_end: null,
      storage: null,
      cdn: { limit_bytes: 1073741824, used_bytes: 0, status: 'ok' },
      booster: { active: false, wp_quota_bytes: null, api_transforms: 0, cdn_bytes: 0, next_expiry: null },
      lapse: null,
      manage_url: 'https://smallpict.app/dashboard/billing',
    },
  },
  capacity_unreadable: { plan: 'pro', bytes_used: 0, capacity: null },
  older_server_without_capacity: { plan: 'pro', bytes_used: 0 },
};

const billing = 'https://smallpict.app/dashboard/billing';

function client(body: unknown) {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  return new SmallPictClient({ apiKey: 'sp_sdk_testkey1234567890abcdef', secretKey: 'sec_testsecret12345678', fetch, maxRetries: 0 });
}

describe('getQuota capacity', () => {
  it('maps every member of a WordPress capacity', async () => {
    const q = await client(responses.wordpress_with_capacity).getQuota();
    expect(q.plan).toBe('pro');
    expect(q.bytesUsed).toBe(1048576);
    expect(q.capacity).toEqual({
      periodEnd: '2026-11-30T00:00:00Z',
      storage: { limitBytes: 75161927680, usedBytes: 7516192768, baseBytes: 53687091200, addonBlocks: 2 },
      cdn: { limitBytes: 53687091200, usedBytes: 44023414784, status: 'warn_80' },
      booster: {
        active: true,
        wpQuotaBytes: 2147483648,
        apiTransforms: null,
        cdnBytes: 107374182400,
        nextExpiry: { kind: 'cdn_bytes', units: 42949672960, expiresAt: '2027-01-05T00:00:00Z' },
      },
      lapse: null,
      manageUrl: billing,
    });
  });

  it('keeps null members null (API key in the unpaid-account cycle)', async () => {
    const c = (await client(responses.api_blocked).getQuota()).capacity!;
    expect(c.periodEnd).toBeNull();
    expect(c.cdn).toBeNull();
    expect(c.booster).toEqual({ active: false, wpQuotaBytes: null, apiTransforms: 5000, cdnBytes: null, nextExpiry: null });
    expect(c.lapse).toEqual({ stage: 'blocked', deleteAfter: '2027-01-28T00:00:00Z' });
  });

  it('sandbox: inactive booster with zero balances', async () => {
    const c = (await client(responses.sandbox).getQuota()).capacity!;
    expect(c.storage).toBeNull();
    expect(c.booster.active).toBe(false);
    expect(c.booster.apiTransforms).toBe(0);
    expect(c.booster.cdnBytes).toBe(0);
  });

  it('capacity null when the server could not read it', async () => {
    expect((await client(responses.capacity_unreadable).getQuota()).capacity).toBeNull();
  });

  it('parses an older response without capacity', async () => {
    const q = await client(responses.older_server_without_capacity).getQuota();
    expect(q.plan).toBe('pro');
    expect('capacity' in q).toBe(false);
  });
});

describe('capacity errors', () => {
  const cases: {
    status: number;
    code: string;
    type: new (...args: any[]) => SmallPictError;
    details: Record<string, unknown>;
    upgradeUrl: string | null;
    allowedModes?: string[];
  }[] = [
    { status: 402, code: 'QUOTA_EXCEEDED', type: QuotaExceededError, details: { upgrade_url: billing }, upgradeUrl: billing },
    { status: 402, code: 'storage_quota_exceeded', type: QuotaExceededError, details: { limit_bytes: 10, used_bytes: 10, remaining_bytes: 0, upgrade_url: billing }, upgradeUrl: billing },
    { status: 402, code: 'account_read_only', type: QuotaExceededError, details: { delete_after: '2027-01-28T00:00:00Z', upgrade_url: billing }, upgradeUrl: billing },
    { status: 402, code: 'QUOTA_EXCEEDED', type: QuotaExceededError, details: { payload_bytes: 60000000 }, upgradeUrl: null },
    { status: 403, code: 'mode_not_in_plan', type: PermissionDeniedError, details: { mode: 'extreme', allowed_modes: ['lossy', 'lossless'] }, upgradeUrl: null, allowedModes: ['lossy', 'lossless'] },
    { status: 409, code: 'booster_period_limit_exceeded', type: SmallPictError, details: { remaining_steps: 0, upgrade_url: billing }, upgradeUrl: billing },
  ];

  for (const tc of cases) {
    it(`${tc.status} ${tc.code} -> ${tc.type.name}`, () => {
      const err = createErrorFromResponse(tc.status, { error: { code: tc.code, message: 'm', details: tc.details } });
      expect(err.constructor).toBe(tc.type);
      expect(err.upgradeUrl).toBe(tc.upgradeUrl);
      expect(err.details).toEqual(tc.details);
      if (tc.allowedModes) expect((err as PermissionDeniedError).allowedModes).toEqual(tc.allowedModes);
      if (tc.type === SmallPictError) {
        expect(err.code).toBe(tc.code);
        expect(err.status).toBe(409);
      }
    });
  }

  it('a non-string upgrade_url is not exposed', () => {
    expect(createErrorFromResponse(402, { error: { code: 'QUOTA_EXCEEDED', message: 'm', details: { upgrade_url: 42 } } }).upgradeUrl).toBeNull();
  });
});
