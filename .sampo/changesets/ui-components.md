---
npm/@k-otp/sdk: minor
---

Add headless UI components with an optional default theme, as new subpaths:

- `@k-otp/sdk/ui`: the framework-agnostic UI model. Korean mobile parsing, formatting and masking, canonicalized before sending (`+82 10-...`, `82 10...`, `0082 10...` and `+82 010...` are sent as `010...`; E.164 for other countries with `allowInternational`), the segmented code input model (paste, full-width digits, IME composition, a single tab stop with arrow-key navigation), the `createOtpForm` state machine over `createOtpFlow` (phases `phone`/`sending`/`code`/`verifying`/`verified`/`failed`, resend and 429/503 retry countdowns, code expiry, focus requests), a Korean/English message catalog for every error code, verify reason and skip reason (overridable; the default locale follows `<html lang>`, else Korean), countdown formatting and an SSR-safe, abortable WebOTP helper.
- `@k-otp/sdk/ui/react` (React 18/19, `"use client"`), `@k-otp/sdk/ui/vue` (Vue 3.3+) and `@k-otp/sdk/ui/svelte` (Svelte 4 and 5, shipped as `.svelte` sources under the `svelte` export condition): a one-line `<OtpForm />` preset and the headless parts `OtpForm.Root` (`OtpFormRoot`), `PhoneField`, `SendButton`, `CodeField`, `VerifyButton`, `Countdown`, `Message`, `EditPhoneButton`, plus a standalone `OtpCodeInput` (`autocomplete="one-time-code"`, `inputmode="numeric"`). Unstyled, with `data-k-otp`/`data-state`/`data-invalid`/`data-disabled` on every part, render props / slots / snippets, labels and live regions, focus that follows the flow, and `sent`/`verified`/`error`/`phaseChange` events. The three frameworks render the same state.
- `@k-otp/sdk/ui/theme.css`: a minimal default theme scoped to `[data-k-otp]` with zero-specificity selectors, `--k-otp-*` tokens, light/dark via `prefers-color-scheme` or `data-k-otp-theme`, and reduced-motion support. CSS is the package's only side effect (`"sideEffects": ["**/*.css"]`).

The hooks subpaths (`@k-otp/sdk/react`, `/vue`, `/svelte`), the core, `/headless` and `/server` never load UI code.
