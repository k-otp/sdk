# `@k-otp/sdk/ui*` reference

The UI subpaths of [`@k-otp/sdk`](../../packages/sdk/README.md). Guide,
theming, accessibility and WebOTP: [docs/ui.md](../ui.md).

- [`@k-otp/sdk/ui`](#k-otpsdkui): the framework-agnostic model
- [`@k-otp/sdk/ui/react`](#k-otpsdkuireact)
- [`@k-otp/sdk/ui/vue`](#k-otpsdkuivue)
- [`@k-otp/sdk/ui/svelte`](#k-otpsdkuisvelte)
- [`@k-otp/sdk/ui/theme.css`](#k-otpsdkuithemecss)

All of them are SSR-safe: no `window`/`document` access at import or render,
no request and no timer until the user acts.

## `@k-otp/sdk/ui`

No framework, ESM + CJS. Everything the components use, for custom-element or
plain-JS UIs, or to build your own components.

### `createOtpForm(client, options): OtpFormController`

The form state machine over `createOtpFlow` (which keeps owning idempotency
keys, the resend cooldown and the 429/503 retry hints).

| Option | Default | |
| --- | --- | --- |
| `purpose` | required | `issue` purpose label |
| `issue` | | other `issue` fields (`templateId`, `templateVariables`, `messageType`, `metadata`, `expiresInSec`, `maxAttempts`, `from`); delivery is KakaoTalk AlimTalk by default with automatic SMS fallback |
| `codeLength` | `6` | digits per code |
| `autoSubmit` | `true` | verify once every digit is entered |
| `webOtp` | `true` | WebOTP after a send, when supported |
| `clearCodeOnMismatch` | `true` | clear the code after `MISMATCH` |
| `allowInternational` | `false` | accept non-Korean E.164 numbers |
| `defaultPhoneNumber` | | initial phone input |
| `resendCooldownMs` | `30000` | local cooldown after a send, for the number it was sent to (UX only; server limits are the enforcement): a different number is not held by it, the same number is, also after `editPhoneNumber()`/`reset()`; a server `Retry-After` wait applies to every send |
| `idempotencyKeyPrefix`, `createIdempotencyKey`, `now` | | as `createOtpFlow` |
| `flow` | | use an existing `OtpFlowController`; its own `resendCooldownMs` then applies, the form adds none, and dropped sends do not keep their idempotency key |
| `onSent(result)`, `onVerified(result)`, `onError(error, "send" \| "verify")`, `onPhaseChange(phase, previous)` | | callbacks |

Controller: `getState()`, `subscribe(listener)`, `setPhoneNumber(value,
{ format? })` (formats as you type; ignored while a code is out),
`setCode(value)` (sanitized; auto-verifies), `send()`, `verify()`,
`submit()` (send in the phone step, verify in the code step),
`editPhoneNumber()`, `reset()`, `abort()`, `configure(partialConfig)`
(callbacks and settings; notifies subscribers only when
`allowInternational` changes, the React root applies it in a layout effect)
and `flow` (read its state; send and verify through the form, since a flow
the form created has `resendCooldownMs: 0` and the form keeps the
cooldown). A request that is in flight when `abort()`, `reset()` or
`editPhoneNumber()` is called, or that a newer send supersedes, is dropped:
no `onError` (`ABORTED`), `onSent`, `onVerified` or WebOTP for it, and the
next send of the same input reuses its idempotency key. `getState()`
returns the same object until something visible changes, also while nobody
is subscribed.
Actions resolve the flow
result, or `{ skipped: "invalid" }` when the phone number or code is not
valid (the matching error is then shown); they never reject for API errors.

`OtpFormState` (immutable, cached between changes):

| Field | |
| --- | --- |
| `phase` | `phone`, `sending`, `code`, `verifying`, `verified`, `failed` |
| `phoneNumber`, `phone` | the input as displayed, and its parse (`phone.value` is sent) |
| `phoneError`, `codeError` | message keys of validation errors (after a send/verify attempt) |
| `phoneLocked`, `issued`, `sentTo` | the number is locked because a code was sent to it (masked as `sentTo`) |
| `code`, `codeLength`, `codeComplete` | |
| `canSend`, `canVerify` | an action would start a request now |
| `sendDisabled` | the send button does nothing now: in flight, a cooldown runs, or verified (a terminal verify outcome keeps it enabled) |
| `verifyDisabled` | the verify button does nothing now: no usable code (terminal, expired), in flight, a retry wait runs, or verified |
| `resendIn`, `retryIn` | seconds until send / verify may run again (local cooldown and server `retryAfterMs`) |
| `expiresIn`, `expired` | seconds left on the current code, anchored on the server's `expiresAt - queuedAt` |
| `attemptsRemaining`, `verified`, `reasonCode`, `error`, `errorOperation`, `retryPending`, `isLoading` | |
| `message` | `{ key, params, tone }` for the live region |
| `focus` | `{ target: "phone" \| "code" \| "message", seq }`: apply when `seq` changes |
| `flow` | the underlying `OtpFlowState` |

### Phone

- `parseOtpPhoneNumber(input, { allowInternational? }): OtpPhoneNumber`:
  `{ input, valid, kind, error, value, national, e164, display }`, `error`
  is `empty`, `invalid`, `not-mobile` or `international`.
- `isValidOtpPhoneNumber(input, options?)`, `formatOtpPhoneInput(input)`
  (as-you-type), `maskOtpPhoneNumber(input, options?)` (`010-****-5678`),
  `OTP_PHONE_NUMBER_MAX_LENGTH` (32).

### Code input

- `sanitizeOtpCode(text, length = 6)`: NFKC (full-width digits), then the
  standalone run of `length` digits (spaces/hyphens allowed), else all digits.
- `applyOtpCodeInput(value, index, text, length)`, `applyOtpCodePaste(...)`,
  `applyOtpCodeKey(value, index, key, length)` -> `{ value, focus }`
  (or `undefined` for keys handled natively).
- `otpCodeSegments`, `isOtpCodeComplete`, `otpCodeFocusIndex`,
  `DEFAULT_OTP_CODE_LENGTH`.

### Messages

- `OTP_MESSAGES` (`ko`, `en`), `DEFAULT_OTP_LOCALE` (`"ko"`),
  `createOtpTranslator({ locale, messages })` -> `t(key, params)`,
  `resolveOtpLocale(locale?)` (`"ko"`/`"en"` as given, else `"ko"`; the same
  on server and client), `detectOtpDocumentLocale()` (`<html lang>`: `ko*`
  or none -> `"ko"`, other languages -> `"en"`) and
  `watchOtpDocumentLocale(onChange)` (for `locale: "auto"`, after mount),
  `formatOtpMessage(template, params)`.
- `otpErrorMessageKey(error, operation?)`, `otpReasonMessageKey(reason)`,
  `otpSkipMessageKey(skip)`, `otpPhoneErrorMessageKey(error)`.
- Types: `OtpLocale`, `OtpMessageKey`, `OtpMessageOverrides`,
  `OtpTranslator`.

### Countdown and WebOTP

- `formatOtpCountdown(ms)` (`m:ss`, `h:mm:ss` from one hour, rounds up),
  `otpSecondsLeft(ms)`.
- `isWebOtpSupported()`, `receiveWebOtp({ signal, length })`: resolves the
  code or `undefined`, never rejects.

### Parts

- `getOtpFormParts(state, { id, t })`: the attributes (DOM names) and copy
  of every part; `otpFormIds(id)`, `otpCodeSegmentId(id, index)`.
- `getOtpCodeInputParts(options)`: group and segment attributes of a
  standalone code input (one tab stop: `otpCodeTabIndex(value, length)`).
- `createOtpCodeInputHandlers({ getValue, getLength, isReadOnly, onChange,
  getContainer })`: `input`, `keydown` (Tab/Shift+Tab leave the group),
  `paste`, `focus`, `compositionstart` and `compositionend` (IME) handlers
  for the segments, and `isComposing()`.
- `focusOtpFormTarget(root, target, state)`, `focusOtpCodeSegment(container,
  index)`.

## `@k-otp/sdk/ui/react`

React 18 and 19, marked `"use client"`, ESM + CJS.

- `OtpForm`: the preset. Takes every `OtpFormRoot` prop; `children` render
  between the fields and the message. `OtpForm.Root`, `OtpForm.PhoneField`,
  `OtpForm.SendButton`, `OtpForm.CodeField`, `OtpForm.VerifyButton`,
  `OtpForm.Countdown`, `OtpForm.Message`, `OtpForm.EditPhoneButton` are the
  parts (also exported as `OtpFormRoot`, `OtpFormPhoneField`, ...).
- `OtpFormRoot` props: the `createOtpForm` options above (callbacks as
  `onSent`, `onVerified`, `onError`, `onPhaseChange`), `client` or `options`
  (else the nearest `OtpProvider` from `@k-otp/sdk/react`), `id` (default
  `useId()`), `locale`, `messages`, `<form>` attributes, and `children` (nodes,
  or a function of `{ form, state, parts, t }`). Settings that create the
  flow are read once; callbacks, `purpose`, `issue`, `locale` and `messages`
  follow re-renders.
- `OtpFormPhoneField`: `label`, `description` (`null` hides it),
  `placeholder`, `<div>` attributes; `children` render function receives
  `{ labelProps, inputProps, descriptionProps, errorProps, ...context }`.
- `OtpFormCodeField`: `label`, `description`; `children` render function
  receives `{ labelProps, descriptionProps, errorProps, input, ...context }`.
- `OtpFormSendButton`, `OtpFormVerifyButton`, `OtpFormEditPhoneButton`,
  `OtpFormCountdown`, `OtpFormMessage`: element attributes, and `children`
  (nodes or a function of the context) to replace the default copy.
- Dot-notation parts (`OtpForm.Root`) need a client component; a Server
  Component can render the named exports with serializable props.
- `OtpCodeInput`: `value` / `defaultValue`, `onValueChange`, `onComplete`,
  `length`, `readOnly`, `invalid`, `id`, `autoFocus`, `webOtp`, `name`
  (hidden input), `locale`, `messages`, `aria-labelledby` /
  `aria-describedby` and `<div>` attributes.
- `useOtpFormContext()`: `{ form, state, parts, t }` inside a root.

## `@k-otp/sdk/ui/vue`

Vue 3.3+, render-function components, ESM + CJS.

- `OtpForm` (preset; attributes and listeners fall through to the root, the
  default slot renders between the fields and the message) with
  `OtpForm.Root`, `OtpForm.PhoneField`, ... and the named exports
  `OtpFormRoot`, `OtpFormPhoneField`, `OtpFormSendButton`,
  `OtpFormCodeField`, `OtpFormVerifyButton`, `OtpFormCountdown`,
  `OtpFormMessage`, `OtpFormEditPhoneButton`.
- `OtpFormRoot` props: as in React (kebab-case in templates); events `sent`,
  `verified`, `error`, `phaseChange` (`@phase-change`). The client is
  `client`, `options`, or the one from `createOtpPlugin` /
  `provideOtpClient`. Default scoped slot: `{ form, state, parts, t }`.
- `OtpFormPhoneField` (`label`, `description` (`""` hides it),
  `placeholder`; slot adds `labelProps`, `inputProps` (with `onInput` /
  `onBlur`), `descriptionProps`, `errorProps`), `OtpFormCodeField` (`label`,
  `description`; slot adds `input`), buttons, countdown and message (slots
  replace the default copy).
- `OtpCodeInput`: `v-model`, `@complete`, `length`, `read-only`, `invalid`,
  `id`, `auto-focus`, `web-otp`, `name`, `locale`, `messages`.
- `useOtpFormContext()`, `OTP_FORM_KEY`.

## `@k-otp/sdk/ui/svelte`

Svelte 4 and 5. ESM only. The components are `.svelte` sources resolved
through the `svelte` export condition (Vite with `@sveltejs/vite-plugin-svelte`,
SvelteKit) and compiled by your Svelte, over a compiled runtime.

- `OtpForm` (preset; default slot between the fields and the message),
  `OtpFormRoot`, `OtpFormPhoneField`, `OtpFormSendButton`,
  `OtpFormCodeField`, `OtpFormVerifyButton`, `OtpFormCountdown`,
  `OtpFormMessage`, `OtpFormEditPhoneButton`, `OtpCodeInput`.
- `OtpFormRoot` props: as in React, including the callback props `onSent`,
  `onVerified`, `onError`, `onPhaseChange`; it also dispatches `sent`,
  `verified`, `error` (`{ error, operation }`) and `phaseChange`
  (`{ phase, previous }`). The client is `client`, `options`, or the stores
  of `setOtpContext` from `@k-otp/sdk/svelte`. Slot props / snippet argument:
  `{ form, state, parts, t }`.
- `OtpFormPhoneField` slot adds `labelProps`, `inputProps`,
  `descriptionProps`, `errorProps`, `onInput`, `onBlur`; a custom input also
  uses the `phoneInput` action (`<input {...inputProps} use:phoneInput />`),
  which wires the handlers and keeps `readonly` in sync.
- `OtpCodeInput`: `bind:value`, `onValueChange`, `onComplete` /
  `on:complete`, `length`, `readOnly`, `invalid`, `id`, `autoFocus`,
  `webOtp`, `name`, `locale`, `messages`.
- Runtime helpers for custom components: `createOtpFormRoot`,
  `getOtpFormContext`, `createOtpCodeInputModel`, `attrs`.

## `@k-otp/sdk/ui/theme.css`

The optional default theme: see [theme](../ui.md#theme) for the tokens and
`data-k-otp-theme`.
