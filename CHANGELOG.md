# Changelog

All notable changes to the `@smallpict/sdk` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `mode` option on `optimize()`: `'lossy'` (default), `'extreme'` or `'lossless'`, typed as `CompressionMode`; `COMPRESSION_MODES` lists them. The server checks the mode against the plan and answers `403 mode_not_in_plan` (`PermissionDeniedError`, `details.allowed_modes`).
- `getJobStatus()` returns `modeApplied` and `qualityApplied`, the mode and quality the server's encoder used (absent for older jobs).
- `ErrorCode` includes `invalid_mode` and `mode_not_in_plan`.

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
