# UI components

[English](#ui-components) | [한국어](#ui-컴포넌트-한국어)

Ready-to-use phone verification forms for React, Vue and Svelte: phone input,
send/resend with the cooldown, a segmented code input with SMS autofill,
verify, an expiry countdown and status messages, in Korean or English.

They are **headless first**: every part renders plain, unstyled elements and
exposes its state as `data-*` attributes, with render props / slots for full
control. A clean default theme is an optional stylesheet.

| Import | What |
| --- | --- |
| `@k-otp/sdk/ui` | The framework-agnostic model: phone parsing and canonicalization, the code input model, the form state machine (`createOtpForm`), the KO/EN messages, countdown formatting, WebOTP. |
| `@k-otp/sdk/ui/react` | React 18/19 components (`"use client"`). |
| `@k-otp/sdk/ui/vue` | Vue 3.3+ components. |
| `@k-otp/sdk/ui/svelte` | Svelte 4 and 5 components. |
| `@k-otp/sdk/ui/theme.css` | The optional default theme. |

The hooks subpaths (`@k-otp/sdk/react`, `/vue`, `/svelte`) never load UI code,
and each UI subpath only loads its own framework. API details:
[reference](./reference/ui.md).

## One line

React:

```tsx
import { OtpForm } from "@k-otp/sdk/ui/react";
import "@k-otp/sdk/ui/theme.css"; // optional

<OtpForm
  options={{ apiKey: "pk_live_..." }} // or inside <OtpProvider>, or client={...}
  purpose="signup"
  onVerified={(result) => console.log(result.issueId)}
/>;
```

Vue (with `app.use(createOtpPlugin({ apiKey: "pk_live_..." }))`, or pass
`client` / `options`):

```vue
<script setup lang="ts">
import { OtpForm } from "@k-otp/sdk/ui/vue";
import "@k-otp/sdk/ui/theme.css";
</script>

<template>
  <OtpForm purpose="signup" @verified="(result) => console.log(result.issueId)" />
</template>
```

Svelte 4 or 5 (pass `client` / `options`, or call `setOtpContext` from
`@k-otp/sdk/svelte` in a parent):

```svelte
<script>
  import { OtpForm } from "@k-otp/sdk/ui/svelte";
  import "@k-otp/sdk/ui/theme.css";
</script>

<OtpForm options={{ apiKey: "pk_live_..." }} purpose="signup" onVerified={(r) => console.log(r.issueId)} />
```

A `pk_` key only works from the origins listed exactly in its
`allowedOrigins` ([security](./security.md)). Browser verification only proves
to the browser that the code matched: if your backend grants access, confirm
server-side with `getStatus` and an `sk_` key.

Every form takes the same settings: `purpose` (required), `issue` (other
`issue` fields: `channel`, `templateId`, `templateVariables`, `metadata`, ...),
`codeLength` (6), `resendCooldownMs` (30 s), `idempotencyKeyPrefix`,
`autoSubmit` (verify once all digits are in, `true`), `webOtp` (`true`),
`clearCodeOnMismatch` (`true`), `allowInternational` (`false`),
`defaultPhoneNumber`, `locale` (`"ko"` or `"en"`, default `"ko"`),
`messages` (overrides) and `id` (root id; part ids derive from it). Events:
`sent`, `verified`, `error` and `phaseChange` (React and Svelte: `onSent`,
`onVerified`, `onError`, `onPhaseChange` props; Vue: `@sent`, `@verified`,
`@error`, `@phase-change`; Svelte also dispatches `on:sent` etc.).

## Headless composition

The preset is built from these parts, which you can arrange and style
yourself:

| Part | Renders | `data-k-otp` |
| --- | --- | --- |
| `OtpForm.Root` (`OtpFormRoot`) | `<form>`, owns the flow | `root` |
| `OtpForm.PhoneField` | label + `<input type="tel">` + description/error | `phone-field`, `phone-label`, `phone-input`, `phone-description`, `phone-error` |
| `OtpForm.SendButton` | send / "resend in 0:27" / "try again" | `send-button` |
| `OtpForm.CodeField` | label + segmented input + description/error | `code-field`, `code-label`, `code-input`, `code-segment`, `code-description`, `code-error` |
| `OtpForm.VerifyButton` | verify / "try again in 0:05" | `verify-button` |
| `OtpForm.Countdown` | code expiry, `role="timer"`, `aria-live="off"` | `countdown` |
| `OtpForm.Message` | status/error, `role="status"` (polite live region) | `message` |
| `OtpForm.EditPhoneButton` | back to the phone step | `edit-phone` |
| `OtpCodeInput` | standalone segmented code input | `code-input`, `code-segment` |

Svelte has no namespaces: `OtpFormRoot`, `OtpFormPhoneField`, ...

React (render props):

```tsx
<OtpForm.Root purpose="login" className="my-form" onVerified={done}>
  {({ state }) => (
    <>
      <OtpForm.PhoneField>
        {({ labelProps, inputProps, errorProps, parts }) => (
          <>
            <label {...labelProps}>Mobile</label>
            <input {...inputProps} className="my-input" />
            {parts.text.phoneError && <p {...errorProps}>{parts.text.phoneError}</p>}
          </>
        )}
      </OtpForm.PhoneField>
      {state.issued && <OtpForm.CodeField />}
      {state.issued && <OtpForm.VerifyButton />}
      <OtpForm.SendButton>{({ state }) => (state.resendIn ? `${state.resendIn}s` : "Send")}</OtpForm.SendButton>
      <OtpForm.Message />
    </>
  )}
</OtpForm.Root>
```

Vue (scoped slots, same values):

```vue
<OtpForm.Root v-slot="{ state }" purpose="login" class="my-form" @verified="done">
  <OtpForm.PhoneField v-slot="{ labelProps, inputProps }">
    <label v-bind="labelProps">Mobile</label>
    <input v-bind="inputProps" />
  </OtpForm.PhoneField>
  <template v-if="state.issued">
    <OtpForm.CodeField />
    <OtpForm.VerifyButton />
  </template>
  <OtpForm.SendButton />
  <OtpForm.Message />
</OtpForm.Root>
```

Svelte (slot props with `let:` in Svelte 4 and 5, or snippets in Svelte 5):

```svelte
<OtpFormRoot {client} purpose="login" class="my-form" let:state>
  <OtpFormPhoneField let:labelProps let:inputProps let:onInput let:onBlur>
    <label {...labelProps}>Mobile</label>
    <input {...inputProps} readonly={state.phoneLocked} on:input={onInput} on:blur={onBlur} />
  </OtpFormPhoneField>
  {#if state.issued}
    <OtpFormCodeField />
    <OtpFormVerifyButton />
  {/if}
  <OtpFormSendButton />
  <OtpFormMessage />
</OtpFormRoot>
```

With snippets: `{#snippet children({ state })} ... {/snippet}` inside
`OtpFormRoot`, and `{#snippet children({ inputProps, onInput })}` inside
`OtpFormPhoneField` (use `oninput={onInput}`).

### State attributes

Every part carries `data-k-otp="<part>"`, and:

| Attribute | On | Values |
| --- | --- | --- |
| `data-state` | `root`, `phone-field`, `phone-input`, `code-field`, `code-input`, `edit-phone` | the phase: `phone`, `sending`, `code`, `verifying`, `verified`, `failed` |
| `data-state` | `send-button`, `verify-button` | `idle`, `loading`, `cooldown` |
| `data-state` | `code-segment` | `filled`, `empty` |
| `data-state` | `countdown` | `running`, `expired`, `idle` |
| `data-state` | `message` | `info`, `success`, `error`, `idle` |
| `data-invalid` | fields, inputs, segments | present when invalid (also `aria-invalid="true"`) |
| `data-disabled` | fields, inputs, buttons | present when locked / not actionable (buttons also `aria-disabled="true"`) |
| `data-issued`, `data-busy` | `root` | a code was sent / a request is in flight |
| `data-empty` | `message` | no message (the live region stays in the DOM) |

Phases: `phone` (entering the number) -> `sending` -> `code` -> `verifying`
-> `verified`, or `failed` when the current code can no longer be used
(expired, too many attempts, replaced): sending again starts over.

## Accessibility

- Labels are real `<label for>`; descriptions and errors are linked with
  `aria-describedby`; invalid inputs get `aria-invalid="true"`.
- The code input is a `role="group"` labelled by the code label; each segment
  is named "Digit 1 of 6" and the first one has `autocomplete="one-time-code"`
  (iOS/Android SMS autofill), all have `inputmode="numeric"`.
- Keyboard: Enter sends in the phone step and verifies in the code step;
  Backspace/Delete/Arrow keys/Home/End move between segments; paste fills
  across segments (spaces, hyphens, full-width digits are normalized).
- Focus moves with the flow: to the first code segment after a send, back to
  it after a wrong code, to the result message after a verification (or a
  terminal failure), and to the phone input after "change number".
- Buttons use `aria-disabled` rather than `disabled` while a request is in
  flight or a cooldown runs, so they keep focus. The countdown is
  `role="timer"` with `aria-live="off"` (not announced every second); the
  message is a polite live region.

## Theme

`@k-otp/sdk/ui/theme.css` styles only `[data-k-otp]` elements, with
zero-specificity selectors (`:where()`), so any class of yours wins. Light and
dark follow `prefers-color-scheme`; force one with
`data-k-otp-theme="light"` or `"dark"` on the form or any ancestor. Tune it
with custom properties (on the form, or `:root`):

```css
:root {
  --k-otp-accent: #0f766e;
  --k-otp-radius: 0.5rem;
  --k-otp-font: inherit;
}
```

Tokens: `--k-otp-accent`, `--k-otp-accent-contrast`, `--k-otp-radius`,
`--k-otp-font`, `--k-otp-font-mono`, `--k-otp-space`, `--k-otp-surface`,
`--k-otp-text`, `--k-otp-muted`, `--k-otp-border`, `--k-otp-border-strong`,
`--k-otp-field`, `--k-otp-field-locked`, `--k-otp-danger`,
`--k-otp-success`, `--k-otp-focus-ring`, `--k-otp-focus-width`,
`--k-otp-shadow`, `--k-otp-max-width`, `--k-otp-segment-size`. Motion is
removed under `prefers-reduced-motion: reduce`. The package marks only CSS as
a side effect (`"sideEffects": ["**/*.css"]`).

Without the theme the parts are unstyled; the
[examples](../examples) show both.

## Messages and locale

`locale` is `"ko"` (default) or `"en"`. `messages` overrides any key, with a
template (`{name}` placeholders) or a function:

```tsx
<OtpForm
  purpose="signup"
  locale="en"
  messages={{
    "send.idle": "Text me a code",
    "reason.MISMATCH": ({ attempts }) => `Wrong code (${attempts} left)`,
  }}
/>
```

Every SDK error code (`error.TOO_MANY_REQUESTS`, ...), verify reason
(`reason.EXPIRED`, ...) and flow skip reason (`skip.cooldown`, ...) has a
message; an ambiguous send failure (timeout, network, 5xx) shows
`error.sendUncertain` ("trying again is safe": the same idempotency key is
reused). The full catalog is `OTP_MESSAGES` in `@k-otp/sdk/ui`.

## Phone numbers

`parseOtpPhoneNumber` accepts Korean mobiles in any common spelling and
canonicalizes them like the API's per-phone rate limit: `010-1234-5678`,
`010 1234 5678`, `+82 10-1234-5678`, `82 1012345678`, `0082 10 1234 5678` and
the mis-dial `+82 010-1234-5678` are all sent as `01012345678` (`010` + 8
digits, or `011`/`016`-`019` + 7 or 8 digits). Full-width digits are
normalized. Landlines are rejected (`not-mobile`). Other countries are
accepted as E.164 (`+14155550123`) only with `allowInternational`.

The API hashes the number exactly as received, so sending one canonical
spelling keeps "a new code for the same number and purpose replaces the
previous one" reliable. The input formats as you type (`010-1234-5678`).

## WebOTP (SMS autofill on Android Chrome)

After a send, the form calls `navigator.credentials.get({ otp: { transport:
["sms"] } })` when the browser supports it (feature-detected, aborted on
verify, "change number" and unmount; nothing runs on the server). Chrome
fills the code after a one-tap consent **only if the SMS ends with an
origin-bound line**:

```text
[K-OTP] 인증번호는 123456입니다.

@www.example.com #123456
```

The last line must be `@<host of the page> #<code>`. The current K-OTP SMS
templates (`otp_default_kr`, `otp_login_kr`, `otp_signup_kr`,
`otp_payment_kr`) do not include it, and their variables only allow `code`,
so WebOTP will not trigger until the API adds such a line for your domain.
Until then, iOS/macOS Safari and Android keyboards still offer the code
through `autocomplete="one-time-code"`. Turn WebOTP off with `webOtp={false}`.

## SSR

Importing any UI subpath and rendering the components on the server performs
no request, starts no timer and never touches `window`. Pass `id` when you
server-render, so that the server and client ids match (React uses `useId`,
Vue 3.5 `useId`; Svelte and older Vue generate one).

## Svelte 4 and 5

`@k-otp/sdk/ui/svelte` ships the components as `.svelte` **sources** (through
the `svelte` export condition) next to a compiled runtime, written in syntax
both compilers accept (no runes, plain JavaScript): your own Svelte 4 or 5
compiles them, so they always match your runtime. Svelte 5 apps can mix them
with runes components and pass snippets. If you force
`compilerOptions.runes: true` globally, exclude `node_modules` (e.g. with
`vitePlugin.dynamicCompileOptions`), as for any library written in Svelte 4
syntax.

---

# UI 컴포넌트 (한국어)

React, Vue, Svelte용 휴대폰 인증 폼입니다. 휴대폰 번호 입력, 재전송
쿨다운이 있는 인증번호 받기, SMS 자동 입력을 지원하는 분할 인증번호 입력,
확인, 만료 카운트다운, 상태 메시지를 한국어 또는 영어로 제공합니다.

**헤드리스가 기본**입니다. 모든 파트는 스타일 없는 기본 요소를 렌더링하고
상태를 `data-*` 속성으로 노출하며, render prop / slot 으로 전부 바꿀 수
있습니다. 기본 테마는 선택적인 CSS 파일입니다.

| 임포트 | 내용 |
| --- | --- |
| `@k-otp/sdk/ui` | 프레임워크 독립 모델: 번호 파싱/정규화, 인증번호 입력 모델, 폼 상태 머신(`createOtpForm`), 한국어/영어 메시지, 카운트다운, WebOTP |
| `@k-otp/sdk/ui/react` | React 18/19 컴포넌트 (`"use client"`) |
| `@k-otp/sdk/ui/vue` | Vue 3.3+ 컴포넌트 |
| `@k-otp/sdk/ui/svelte` | Svelte 4, 5 컴포넌트 |
| `@k-otp/sdk/ui/theme.css` | 선택적 기본 테마 |

훅 서브패스(`@k-otp/sdk/react`, `/vue`, `/svelte`)는 UI 코드를 불러오지
않고, 각 UI 서브패스는 자기 프레임워크만 불러옵니다.

## 한 줄 사용

```tsx
import { OtpForm } from "@k-otp/sdk/ui/react";
import "@k-otp/sdk/ui/theme.css"; // 선택

<OtpForm options={{ apiKey: "pk_live_..." }} purpose="signup" onVerified={(r) => console.log(r.issueId)} />;
```

Vue는 `<OtpForm purpose="signup" @verified="..." />`, Svelte는
`<OtpForm {client} purpose="signup" onVerified={...} />` 입니다. 기본
언어는 `locale="ko"` 이고 `locale="en"` 으로 영어, `messages` 로 문구를
바꿀 수 있습니다. `pk_` 키는 `allowedOrigins` 에 정확히 등록된 출처에서만
동작합니다. 브라우저 인증 결과로 서버 권한을 주려면 서버에서 `sk_` 키로
`getStatus` 를 확인하세요.

## 헤드리스 조합

`OtpForm.Root`(Svelte는 `OtpFormRoot`), `PhoneField`, `SendButton`,
`CodeField`, `VerifyButton`, `Countdown`, `Message`, `EditPhoneButton` 을
원하는 배치로 조합하고 `data-k-otp`, `data-state`, `data-invalid`,
`data-disabled` 속성으로 스타일을 입힙니다. 단계(`data-state`)는
`phone` -> `sending` -> `code` -> `verifying` -> `verified` 이며, 현재
인증번호를 더 쓸 수 없으면(만료, 시도 초과, 교체) `failed` 입니다.
`OtpCodeInput` 은 단독으로도 쓸 수 있습니다.

## 접근성

- `<label for>`, `aria-describedby`, `aria-invalid` 로 연결됩니다.
- 인증번호 입력은 `role="group"` 이고 각 칸은 "6자리 중 1번째 숫자" 처럼
  이름이 붙으며, 첫 칸에 `autocomplete="one-time-code"`, 모든 칸에
  `inputmode="numeric"` 이 있습니다.
- Enter 로 전송/확인, Backspace/Delete/방향키/Home/End 로 칸 이동, 붙여넣기는
  여러 칸에 나뉘어 들어갑니다(공백, 하이픈, 전각 숫자 정리).
- 포커스 이동: 전송 후 첫 칸, 틀린 인증번호 후 다시 첫 칸, 인증 완료 후 결과
  메시지, 번호 변경 후 번호 입력.
- 카운트다운은 `role="timer"`, `aria-live="off"`, 메시지는 polite 라이브
  리전입니다.

## 테마

`@k-otp/sdk/ui/theme.css` 는 `[data-k-otp]` 요소만, 명시도 0(`:where()`)
선택자로 꾸미므로 직접 지정한 클래스가 항상 이깁니다. 라이트/다크는
`prefers-color-scheme` 을 따르고 `data-k-otp-theme="light" | "dark"` 로
고정할 수 있습니다. `--k-otp-accent`, `--k-otp-radius`, `--k-otp-font` 등의
변수로 조정합니다.

## 휴대폰 번호

`010-1234-5678`, `+82 10-1234-5678`, `82 1012345678`, `0082 10 1234 5678`,
`+82 010-1234-5678` 은 모두 API의 번호별 정규화와 같은 `01012345678` 로
전송됩니다(`010` + 8자리, `011`/`016`-`019` + 7-8자리). 유선 번호는
거부되고, 해외 번호(E.164)는 `allowInternational` 일 때만 허용됩니다. API는
받은 문자열 그대로 해시하므로, 한 가지 표기로 보내야 "같은 번호와 목적의 새
인증번호가 이전 것을 대체" 하는 동작이 안정적입니다.

## WebOTP

전송 후 브라우저가 지원하면 `navigator.credentials.get({ otp })` 를
호출합니다(기능 감지, 서버에서는 실행되지 않음). Android Chrome 은 SMS
마지막 줄이 `@<페이지 도메인> #<인증번호>` 형식일 때만 자동 입력합니다.
현재 K-OTP SMS 템플릿에는 이 줄이 없고 변수도 `code` 만 허용하므로, API가
도메인 줄을 지원하기 전까지 WebOTP 는 동작하지 않습니다. iOS/Android 키보드의
`autocomplete="one-time-code"` 자동 입력은 그대로 동작합니다.

## SSR, Svelte 4/5

모든 UI 서브패스는 서버에서 불러오고 렌더링해도 요청, 타이머, `window`
접근이 없습니다. SSR 에서는 `id` 를 넘겨 서버와 클라이언트 id 를 맞추세요.
Svelte 컴포넌트는 Svelte 4/5 가 모두 컴파일할 수 있는 `.svelte` 소스로
배포되어 앱의 Svelte 가 직접 컴파일합니다.
