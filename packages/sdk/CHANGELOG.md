# @k-otp/sdk

## 1.0.1 — 2026-10-01

### Patch changes

- [db678ab](https://github.com/k-otp/sdk/commit/db678ab047dbddefefeb286c462f77458b271962) Republish with resolved dependency versions. The 1.0.0 tarball on npm declared its `@orpc/*` dependencies with unresolved `catalog:` ranges and cannot be installed; use 1.0.1 or later. The package now refuses `npm publish` from the package directory when a dependency range is unresolved. — Thanks @imjlk!

## 1.0.0 — 2026-10-01

### Major changes

- [90542d6](https://github.com/k-otp/sdk/commit/90542d65f24cfd3a69f8f870daad0e6864ff2c7d) Initial public release of `@k-otp/sdk` (1.0.0), the official JavaScript/TypeScript SDK for the K-OTP Korean OTP API (API 1.4.0), as one package with subpath exports:
  
  - `@k-otp/sdk` (same as `@k-otp/sdk/core`): framework-agnostic `issue` / `verify` client for browsers (`pk_` keys), SSR and edge runtimes, over oRPC `OpenAPILink` against `/v1`. Required idempotency keys (validated before any request, sent as header and body, `createIdempotencyKey`), a normalized `OtpApiError` (`code`, `status`, `requestId`, `retryable`, `retryAfterMs`, typed `OtpPaymentRequiredData` / `OtpRateLimitedData` for 402 and the per-key 429 rate limits), per-call `signal` / `timeoutMs`, telemetry hooks and a refusal of `sk_` keys in browsers.
  - `@k-otp/sdk/headless`: the `createOtpFlow` / `createOtpOperation` controllers behind every adapter: stale-response protection, abort, idempotency key reuse after ambiguous failures, the resend cooldown and a separate verify cooldown after a rate-limited `verify`.
  - `@k-otp/sdk/server`: every public `/v1` operation with an `sk_` secret key for Node.js, Bun, Deno and edge runtimes: issue, verify, status, issue history, organization credit wallet balance (`walletId`, `walletScope`, `organizationId`) and ledger, and templates, with async pagination helpers. Under the `browser` export condition it resolves to a stub with the same exports whose functions throw when called, so the server client never ships to a browser by accident.
  - `@k-otp/sdk/react` (`OtpProvider`, `useOtpIssue`, `useOtpVerify`, `useOtpFlow`; React 18 and 19, marked `"use client"`), `@k-otp/sdk/vue` (`createOtpPlugin`, `useOtp`, `useOtpFlow`; Vue 3.3+) and `@k-otp/sdk/svelte` (`createOtpStores`, a flow store and the `otpForm` action; Svelte 4 and 5). React, Vue and Svelte are optional peer dependencies, and each subpath only loads its own framework.
  - `@k-otp/sdk/contract`: the oRPC contract and the generated OpenAPI types, for custom oRPC clients.
  - `@k-otp/sdk/k-otp.iife.min.js` (and the unminified `k-otp.iife.js`): a `<script>` bundle exposing `window.KOtp`, including `KOtp.createOtpFlow`. — Thanks @imjlk!

### Minor changes

- [ebccd84](https://github.com/k-otp/sdk/commit/ebccd84a849002efc8e1ed5bf517b9ffda4631df) Add headless UI components with an optional default theme, as new subpaths:
  
  - `@k-otp/sdk/ui`: the framework-agnostic UI model. Korean mobile parsing, formatting and masking, canonicalized before sending (`+82 10-...`, `82 10...`, `0082 10...` and `+82 010...` are sent as `010...`; E.164 for other countries with `allowInternational`), the segmented code input model (paste, full-width digits, IME composition, a single tab stop with arrow-key navigation), the `createOtpForm` state machine over `createOtpFlow` (phases `phone`/`sending`/`code`/`verifying`/`verified`/`failed`, resend and 429/503 retry countdowns, code expiry, focus requests), a Korean/English message catalog for every error code, verify reason and skip reason (overridable; Korean by default, `locale: "auto"` follows `<html lang>` after mount), countdown formatting and an SSR-safe, abortable WebOTP helper.
  - `@k-otp/sdk/ui/react` (React 18/19, `"use client"`), `@k-otp/sdk/ui/vue` (Vue 3.3+) and `@k-otp/sdk/ui/svelte` (Svelte 4 and 5, shipped as `.svelte` sources under the `svelte` export condition): a one-line `<OtpForm />` preset and the headless parts `OtpForm.Root` (`OtpFormRoot`), `PhoneField`, `SendButton`, `CodeField`, `VerifyButton`, `Countdown`, `Message`, `EditPhoneButton`, plus a standalone `OtpCodeInput` (`autocomplete="one-time-code"`, `inputmode="numeric"`). Unstyled, with `data-k-otp`/`data-state`/`data-invalid`/`data-disabled` on every part, render props / slots / snippets, labels and live regions, focus that follows the flow, and `sent`/`verified`/`error`/`phaseChange` events. The three frameworks render the same state.
  - `@k-otp/sdk/ui/theme.css`: a minimal default theme scoped to `[data-k-otp]` with zero-specificity selectors, `--k-otp-*` tokens, light/dark via `prefers-color-scheme` or `data-k-otp-theme`, and reduced-motion support. CSS is the package's only side effect (`"sideEffects": ["**/*.css"]`).
  
  The hooks subpaths (`@k-otp/sdk/react`, `/vue`, `/svelte`), the core, `/headless` and `/server` never load UI code. — Thanks @imjlk!

