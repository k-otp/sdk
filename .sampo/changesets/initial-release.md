---
npm/@k-otp/sdk: major
---

Initial public release of `@k-otp/sdk` (1.0.0), the official JavaScript/TypeScript SDK for the K-OTP Korean OTP API (API 1.4.0), as one package with subpath exports:

- `@k-otp/sdk` (same as `@k-otp/sdk/core`): framework-agnostic `issue` / `verify` client for browsers (`pk_` keys), SSR and edge runtimes, over oRPC `OpenAPILink` against `/v1`. Required idempotency keys (validated before any request, sent as header and body, `createIdempotencyKey`), a normalized `OtpApiError` (`code`, `status`, `requestId`, `retryable`, `retryAfterMs`, typed `OtpPaymentRequiredData` / `OtpRateLimitedData` for 402 and the per-key 429 rate limits), per-call `signal` / `timeoutMs`, telemetry hooks and a refusal of `sk_` keys in browsers.
- `@k-otp/sdk/headless`: the `createOtpFlow` / `createOtpOperation` controllers behind every adapter: stale-response protection, abort, idempotency key reuse after ambiguous failures, the resend cooldown and a separate verify cooldown after a rate-limited `verify`.
- `@k-otp/sdk/server`: every public `/v1` operation with an `sk_` secret key for Node.js, Bun, Deno and edge runtimes: issue, verify, status, issue history, organization credit wallet balance (`walletId`, `walletScope`, `organizationId`) and ledger, and templates, with async pagination helpers. Under the `browser` export condition it resolves to a stub that fails the bundle, so the server client never ships to a browser by accident.
- `@k-otp/sdk/react` (`OtpProvider`, `useOtpIssue`, `useOtpVerify`, `useOtpFlow`; React 18 and 19, marked `"use client"`), `@k-otp/sdk/vue` (`createOtpPlugin`, `useOtp`, `useOtpFlow`; Vue 3.3+) and `@k-otp/sdk/svelte` (`createOtpStores`, a flow store and the `otpForm` action; Svelte 4 and 5). React, Vue and Svelte are optional peer dependencies, and each subpath only loads its own framework.
- `@k-otp/sdk/contract`: the oRPC contract and the generated OpenAPI types, for custom oRPC clients.
- `@k-otp/sdk/k-otp.iife.min.js` (and the unminified `k-otp.iife.js`): a `<script>` bundle exposing `window.KOtp`, including `KOtp.createOtpFlow`.
