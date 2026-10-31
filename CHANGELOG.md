# Changelog

All notable changes to the `@smallpict/sdk` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `'auto'` compression mode (`CompressionMode`, `COMPRESSION_MODES`): the server picks the quality per image from a visual score. Plans: WP Pro and Business, Velocity, Momentum and sandbox; a server without auto enabled answers `400 invalid_mode` (`ValidationError`).
- `mode` option on `optimize()`: `'lossy'` (default), `'extreme'` or `'lossless'`, typed as `CompressionMode`; `COMPRESSION_MODES` lists them. The server checks the mode against the plan and answers `403 mode_not_in_plan` (`PermissionDeniedError`, `details.allowed_modes`).
- `getJobStatus()` returns `modeApplied` and `qualityApplied`, the mode and quality the server's encoder used (absent for older jobs).
- `ErrorCode` includes `invalid_mode` and `mode_not_in_plan`.
- `folder` option on `optimize()`, sent as `options.folder`: the upload folder (1-3 segments) for the optimized file. `optimize()` and `getJobStatus()` return `folder` as the server stored it (lower case). Empty segments, `..` and more than 3 segments throw `ValidationError` before any request; the server answers other malformed values with `400 invalid_folder` (`ValidationError`).
- `purgeCdn({ purgeType: 'folder', folder })` purges every file under one upload folder. `folder` is required for that type and sent only with it.
- `ErrorCode` includes `invalid_folder` and `purge_rate_limited`.
- `getQuota()` returns `capacity`: read-only storage, CDN, booster balances (with the lot that expires first), unpaid-account state, `periodEnd` and `manageUrl` of the key's product, typed as `Capacity`. Members that do not apply are `null`; `capacity` is `null` when the server could not read it and absent on older servers, which still parse.
- Every `SmallPictError` has `upgradeUrl` (from `details.upgrade_url`, otherwise `null`): the dashboard page where the missing capacity is added. The SDK does not open it.
- `PermissionDeniedError.allowedModes` for `mode_not_in_plan` (from `details.allowed_modes`, otherwise `null`).
- `ErrorCode` includes `storage_quota_exceeded`, `account_read_only` (both `QuotaExceededError`) and the 409 capacity codes, which raise the base `SmallPictError` with `status` 409.
- `purgeCdn()` returns `deliveryModes` (`['managed']` or `['byo']`) when the server reports where the purge was sent; absent on older servers.

### Changed
- `optimize()` sends `quality` only when you set it. Before, it always sent `80`, so `mode: 'extreme'` produced lossy-Q80-sized files; now the server default per mode applies (lossy 80, extreme a per-codec default). Results for `lossy` are unchanged.
- README: compression mode section has an `extreme` example without `quality`.
- **`429 purge_rate_limited` is not retried.** `folder` and `all` purges are limited per hour, so the SDK throws `RateLimitError` on the first response instead of retrying within seconds. Other 429 responses are retried as before.

### Deprecated
- `lossless` option. Use `mode: 'lossless'`. It keeps working until the next major version: `lossless: true` is sent as `mode: 'lossless'`, and combined with a different `mode` it throws `ValidationError` before any request.

### Fixed
- **`lossless: true` is honoured.** The SDK sent a `lossless` field the API never read, so every image was compressed lossy. It now sends `mode`.

## [1.0.0] - 2026-08-21

### Added
- Official TypeScript & Node.js SDK implementation for SmallPict OpenAPI 3.1.0 API.
- Zero external runtime HTTP dependencies using standard Web Fetch and Web Crypto APIs.
- 4 unified client methods: `optimize()`, `getQuota()`, `purgeCdn()`, and `validateKey()`.
- Helper `getJobStatus()` for asynchronous image conversion tracking.
- Universal HMAC-SHA256 request signing and Bearer token fallback.
- Support for `Buffer`, `Uint8Array`, `ArrayBuffer`, `Blob`, `File`, `ReadableStream`, and URL image sources.
- Resilient HTTP transport with 30s `AbortController` timeout, exponential backoff, jitter, and automatic `Idempotency-Key` UUID injection.
- Automatic secret masking to prevent credentials leaking in error messages and stack traces.
- Optional `fallbackMode: 'passthrough'` for continuous availability on quota exhaustion.
- Dual ESM and CJS bundle distribution with full TypeScript declarations.
