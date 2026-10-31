# SmallPict Node.js & TypeScript SDK

Official TypeScript and Node.js SDK for the [SmallPict Image Optimization API](https://smallpict.app) — high-performance next-gen image transcoding (AVIF, WebP), smart compression, Edge CDN delivery, and cache purging.

[![npm version](https://img.shields.io/npm/v/@smallpict/sdk.svg)](https://www.npmjs.com/package/@smallpict/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## ⚡ Features

- **🚀 Universal Runtime Support:** Compatible with **Node.js 18+**, **Bun**, **Next.js (App & Pages Router)**, and **Cloudflare Workers** with **zero external HTTP dependencies** (native Web Fetch & Web Crypto).
- **🛡️ HMAC-SHA256 & Bearer Auth:** Secure request signing and tamper protection.
- **✨ 4 Core Unified Methods:** `optimize()`, `getQuota()`, `purgeCdn()`, and `validateKey()`.
- **🔄 Resilience & Fault Tolerance:** Automatic `Idempotency-Key` injection, 30s request timeouts, and exponential backoff with jitter on HTTP 429/5xx.
- **🔒 Zero-Leak Privacy:** API keys and credentials are automatically redacted from error traces and logs.
- **📦 Dual ESM & CJS:** Full TypeScript definitions and source maps included.

---

## 📥 Installation

```bash
# npm
npm install @smallpict/sdk

# pnpm
pnpm add @smallpict/sdk

# yarn
yarn add @smallpict/sdk

# bun
bun add @smallpict/sdk
```

---

## 🚀 Quick Start

### 1. Minimal Example

```typescript
import { SmallPictClient } from '@smallpict/sdk';
import { readFileSync } from 'node:fs';

const client = new SmallPictClient({
  apiKey: process.env.SMALLPICT_API_KEY!, // or 'sp_sdk_...' / 'sp_test_...'
  secretKey: process.env.SMALLPICT_SECRET_KEY, // Optional HMAC secret key
});

const imageBuffer = readFileSync('./hero-banner.png');

const result = await client.optimize(imageBuffer, {
  format: 'avif',
  mode: 'lossy', // 'lossy' (default) | 'extreme' | 'lossless'; checked against your plan
  quality: 80,
  maxWidth: 1920,
});

console.log(`Optimized CDN URL: ${result.url}`);
console.log(`Original: ${result.originalSize} bytes ➔ Compressed: ${result.compressedSize} bytes`);
console.log(`Saved: ${result.savingsPercentage}% (${result.bytesSaved} bytes)`);
```

### Compression mode

`mode` is `lossy` (default), `extreme` or `lossless`. The server checks it against your plan: a mode the plan does not include throws `PermissionDeniedError` whose `details.allowed_modes` lists the modes you can use. The job status reports what the encoder really used as `modeApplied` and `qualityApplied`. The old `lossless: true` option still works but is deprecated; use `mode: 'lossless'`.

`extreme` gives the smallest files on every plan. Leave `quality` out so the server uses its default for the output format; a `quality` you set is kept or raised to the format floor. Mode comparison: https://smallpict.app/en/docs/image-settings

```ts
const smallest = await client.optimize(imageBuffer, {
  format: 'webp',
  mode: 'extreme', // no quality: the server picks the default for WebP
});
```

### Upload folder

`folder` (e.g. `'blog/2026'`) stores the optimized file in that folder under your account. It has 1-3 segments separated by `/`; the server lower-cases it and returns it as `folder` in the result and the job status. The SDK rejects empty segments, `..` and more than 3 segments with `ValidationError` before any request; any other malformed value comes back from the server as `ValidationError` (`invalid_folder`).

---

## 🏭 Production Examples

### Next.js Server Action / Route Handler with Fallback Mode

```typescript
import { SmallPictClient, QuotaExceededError } from '@smallpict/sdk';
import { NextResponse } from 'next/server';

const client = new SmallPictClient({
  apiKey: process.env.SMALLPICT_API_KEY!,
  secretKey: process.env.SMALLPICT_SECRET_KEY,
  // If quota is exhausted, passthrough original image without throwing
  fallbackMode: 'passthrough',
});

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await client.optimize(arrayBuffer, {
      filename: file.name,
      mimeType: file.type,
      format: 'auto', // Intelligently selects best format (AVIF/WebP)
      quality: 85,
    });

    return NextResponse.json({
      url: result.url,
      format: result.format,
      saved: `${result.savingsPercentage}%`,
    });
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return NextResponse.json({ error: 'Monthly quota exhausted' }, { status: 402 });
    }
    return NextResponse.json({ error: 'Image optimization failed' }, { status: 500 });
  }
}
```

### Checking Account Quota & Purging CDN Cache

```typescript
import { SmallPictClient } from '@smallpict/sdk';

const client = new SmallPictClient({
  apiKey: process.env.SMALLPICT_API_KEY!,
});

// 1. Check real-time quota usage
const quota = await client.getQuota();
console.log(`Plan: ${quota.plan}`);
console.log(`Quota Used: ${quota.quotaPercentage}% (${quota.bytesUsed} / ${quota.quotaLimit} bytes)`);

// 2. Invalidate CDN cache for modified images
await client.purgeCdn([
  'https://cdn.smallpict.app/opt/hero-banner.avif',
  'https://cdn.smallpict.app/opt/logo.webp',
]);
console.log('CDN cache purged successfully!');

// 3. Purge every file delivered under one upload folder
await client.purgeCdn({ purgeType: 'folder', folder: 'blog/2026' });
```

The result's `deliveryModes` says where the purge ran: `['managed']` (smallPict's CDN) or `['byo']` (your own CDN while BYO delivery is active).

`folder` and `all` purges are limited per hour (10 and 2). One more throws `RateLimitError`, which the SDK does not retry automatically: the limit resets within the hour, not in seconds.

### Capacity and upgrade links

`getQuota()` returns `capacity` for the product of your API key: storage (`limitBytes`, `usedBytes`, `baseBytes`, `addonBlocks`), CDN (`limitBytes`, `usedBytes`, `status`), booster balances (`active`, `wpQuotaBytes`, `apiTransforms`, `cdnBytes`, `nextExpiry`), the unpaid-account state (`lapse`), `periodEnd` and `manageUrl`. A member that does not apply to your plan is `null`; `capacity` is `null` when the server could not read it and absent on older servers. Capacity is read-only here: storage add-ons and boosters are bought in the dashboard.

```ts
const { capacity } = await client.getQuota();
if (capacity?.storage) console.log(`Storage: ${capacity.storage.usedBytes} / ${capacity.storage.limitBytes} bytes`);
if (capacity?.booster.nextExpiry) console.log(`Booster lot expires ${capacity.booster.nextExpiry.expiresAt}`);
```

Errors about capacity carry `upgradeUrl`, the dashboard page where you add it (`null` when the error has none). `storage_quota_exceeded` and `account_read_only` throw `QuotaExceededError`; `mode_not_in_plan` throws `PermissionDeniedError` with `allowedModes`. The SDK never opens these links; show them to your user.

```ts
try {
  await client.optimize(imageBuffer);
} catch (err) {
  if (err instanceof QuotaExceededError) console.error(`${err.message} Add capacity: ${err.upgradeUrl ?? 'https://smallpict.app/dashboard/billing'}`);
}
```

---

## 🧪 Testing

```bash
npm run test
npm run typecheck
npm run build
```

---

## 🔒 Security & Schema Compatibility (2026)

- **`mimeType` & `contentType` Dual Support**: `OptimizeOptions` accepts both `mimeType` and `contentType` interchangeably. Payloads sent to the SmallPict API automatically populate both `mime_type` and `content_type`, guaranteeing seamless zero-disruption compatibility across all API versions.

---

## 📄 License

MIT © [SmallPict Engineering](https://smallpict.app)
