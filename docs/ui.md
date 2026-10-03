# UI components

[English](#ui-components) | [한국어](#ui-컴포넌트-한국어)

Ready-to-use phone verification forms for React, Vue and Svelte: phone input,
send/resend with the cooldown, a segmented code input with one-time-code autofill,
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
`issue` fields: `templateId`, `templateVariables`, `metadata`, ...),
`codeLength` (6), `resendCooldownMs` (30 s, see [cooldowns](#cooldowns)),
`idempotencyKeyPrefix`,
`autoSubmit` (verify once all digits are in, `true`), `webOtp` (`true`, see
[WebOTP](#webotp-sms-autofill-on-android-chrome)), `clearCodeOnMismatch`
(`true`), `allowInternational` (`false`), `defaultPhoneNumber`, `locale`
(`"ko"` (default), `"en"` or `"auto"`, see [locale](#messages-and-locale)),
`messages` (overrides) and `id` (root id; part ids derive from it).
Requests in flight when the form is unmounted, reset or sent back to the
phone step, or superseded by a newer send, are dropped silently: no `error`
(`ABORTED`), `sent` or `verified` for them, and the next send of the same
number reuses the dropped request's idempotency key (no second message if it had
reached the server). Events:
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

React (render props). `@k-otp/sdk/ui/react` is a `"use client"` module: use
`OtpForm.Root` and the other dot-notation parts, and function props such as
render props or `onVerified`, inside a client component. A Server Component
can render the named exports (`OtpForm`, `OtpFormRoot`, `OtpFormPhoneField`,
...) with serializable props only.

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
  <OtpFormPhoneField let:labelProps let:inputProps let:phoneInput>
    <label {...labelProps}>Mobile</label>
    <input {...inputProps} use:phoneInput />
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
`OtpFormRoot`, and `{#snippet children({ inputProps, phoneInput })}` inside
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
- The code input is a `role="group"` labelled by the code label (the
  standalone `OtpCodeInput` defaults to the "Verification code" message
  unless you pass `aria-label`/`aria-labelledby`) and described once; each
  segment is named "Digit 1 of 6", the first one has
  `autocomplete="one-time-code"` (iOS/Android autofill of a code that
  arrives by SMS), all have
  `inputmode="numeric"`. It is always laid out left to right (`dir="ltr"`).
- Keyboard: the code input is **one tab stop** (roving tabindex: the first
  empty segment); Tab and Shift+Tab leave it from any segment, and
  ArrowLeft/ArrowRight/Home/End move between segments. Enter sends in the
  phone step and verifies in the code step; Backspace/Delete edit; paste fills
  across segments (spaces, hyphens, full-width digits are normalized); digits
  composed with an input method (IME) are applied once, when the composition
  ends.
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
`--k-otp-text`, `--k-otp-muted`, `--k-otp-border` (the card),
`--k-otp-field-border`, `--k-otp-border-strong`, `--k-otp-field`,
`--k-otp-field-locked`, `--k-otp-danger`, `--k-otp-success`,
`--k-otp-focus-ring`, `--k-otp-focus-width`, `--k-otp-shadow`,
`--k-otp-max-width`, `--k-otp-segment-size`. The defaults keep field borders
and the focus outline (a solid accent outline) at 3:1 or more against their
surroundings and the text at 4.5:1 or more, in light and dark; keep that in
mind when you override them. In forced-colors mode (Windows High Contrast)
borders, outlines and disabled states use system colors. Motion is removed
under `prefers-reduced-motion: reduce`. The package marks only CSS as
a side effect (`"sideEffects": ["**/*.css"]`).

Without the theme the parts are unstyled; the
[examples](../examples) show both.

## Messages and locale

`locale` is `"ko"` (the default, on the server and in the browser) or
`"en"`. `"auto"` follows the page's `<html lang>`: Korean for `ko*` (or no
`lang`), English for any other language. It renders Korean on the server and
on the first client render, so hydration always matches, then switches
right after mount and follows later `lang` changes (an SPA language switch).
`messages` overrides any key, with a template (`{name}` placeholders) or a
function:

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

`parseOtpPhoneNumber` accepts Korean mobiles in any common spelling and the
SDK canonicalizes them before sending: `010-1234-5678`,
`010 1234 5678`, `+82 10-1234-5678`, `82 1012345678`, `0082 10 1234 5678` and
the mis-dial `+82 010-1234-5678` are all sent as `01012345678` (`010` + 8
digits, or `011`/`016`-`019` + 7 or 8 digits). Full-width digits are
normalized. Landlines are rejected (`not-mobile`). Other countries are
accepted as E.164 (`+14155550123`) only with `allowInternational`.

The same number is therefore always sent the same way, whatever the user
typed (from API 1.4.0 the server also canonicalizes the key of its per-phone
rate limit). The input formats as you type (`010-1234-5678`).

## WebOTP (SMS autofill on Android Chrome)

K-OTP delivers codes by KakaoTalk AlimTalk by default; WebOTP and
`one-time-code` autofill only apply when the code arrives by SMS, the
automatic fallback when AlimTalk cannot be delivered. After a send, the form
calls `navigator.credentials.get({ otp: { transport: ["sms"] } })` when the
browser supports it (feature-detected, aborted on
verify, "change number" and unmount; nothing runs on the server). Chrome
fills the code after a one-tap consent **only if the SMS ends with an
origin-bound line**:

```text
[K-OTP] 인증번호는 123456입니다.

@www.example.com #123456
```

The last line must be `@<host of the page> #<code>`. Check whether the SMS
your users receive (the template of `templateId`) ends with such a line for
your domain; the default K-OTP templates do not. Without it the request
simply never resolves, so leaving `webOtp` on is harmless: it is aborted on
verify, "change number" and unmount. iOS/macOS Safari and Android keyboards
offer the code through `autocomplete="one-time-code"` either way. Turn
WebOTP off with `webOtp={false}`.

## SSR

Importing any UI subpath and rendering the components on the server performs
no request, starts no timer and never touches `window`. When you
server-render, pass `id` (React uses `useId` and Vue 3.5 `useId`, but
Svelte and older Vue generate a random id, which would differ on the client)
and keep `locale` the same on both sides (the default `"ko"`, an explicit
locale, or `"auto"`, which switches only after hydration). The hydration of
the three presets with an explicit `id` is covered by the tests.

## Cooldowns

After a send, the button waits `resendCooldownMs` (30 s) before the same
number can get another code. This local cooldown is a UX guard against
double taps and impatient resends, not a limit: a reload resets it, and the
API's rate limits are the enforcement. It belongs to the number it was
started for: after "change number", a **different** number can be sent to
at once, and coming back to the **same** number waits for the rest of it. A
wait imposed by the server (429/503 `Retry-After`) applies to every send
until it ends.

The form keeps this cooldown itself (`state.resendIn`); send through the
form (`form.send()`), not through `form.flow`, whose own
`resendCooldownMs` is 0. A form created with your own `flow` uses that
flow's cooldown instead.

## Svelte 4 and 5

`@k-otp/sdk/ui/svelte` ships the components as `.svelte` **sources** (through
the `svelte` export condition) next to a compiled runtime, written in syntax
both compilers accept (no runes, plain JavaScript): your own Svelte 4 or 5
compiles them, so they always match your runtime. Svelte 5 apps can mix them
with runes components and pass snippets. If you force
`compilerOptions.runes: true` globally, exclude `node_modules` (e.g. with
`vitePlugin.dynamicCompileOptions`), as for any library written in Svelte 4
syntax. A
future Svelte major that drops this syntax would need new component sources.

---

# UI 컴포넌트 (한국어)

React, Vue, Svelte용 휴대폰 인증 폼입니다. 휴대폰 번호 입력, 재전송
쿨다운이 있는 인증번호 받기, 인증번호 자동 입력을 지원하는 분할 인증번호 입력,
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
언어는 `locale="ko"` 이고 `locale="en"` 으로 영어, `locale="auto"` 로 페이지의
`<html lang>`(마운트 후), `messages` 로 문구를 바꿀 수 있습니다. `pk_` 키는 `allowedOrigins` 에 정확히 등록된 출처에서만
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
- 인증번호 입력은 **탭 정지점 하나**입니다(첫 빈 칸). 어느 칸에서든 Tab /
  Shift+Tab 으로 빠져나가고, 방향키/Home/End 로 칸을 옮깁니다. Enter 로
  전송/확인, 붙여넣기는 여러 칸에 나뉘어 들어가며(공백, 하이픈, 전각 숫자
  정리), 입력기(IME)로 조합한 숫자는 조합이 끝날 때 한 번만 들어갑니다.
- 포커스 이동: 전송 후 첫 칸, 틀린 인증번호 후 다시 첫 칸, 인증 완료 후 결과
  메시지, 번호 변경 후 번호 입력.
- 카운트다운은 `role="timer"`, `aria-live="off"`, 메시지는 polite 라이브
  리전입니다.

## 테마

`@k-otp/sdk/ui/theme.css` 는 `[data-k-otp]` 요소만, 명시도 0(`:where()`)
선택자로 꾸미므로 직접 지정한 클래스가 항상 이깁니다. 라이트/다크는
`prefers-color-scheme` 을 따르고 `data-k-otp-theme="light" | "dark"` 로
고정할 수 있습니다. `--k-otp-accent`, `--k-otp-radius`, `--k-otp-font` 등의
변수로 조정합니다. 기본값은 입력란 테두리와 포커스 표시를 주변 대비 3:1
이상으로 유지하고, 고대비(forced-colors) 모드에서는 시스템 색을 씁니다.

## 휴대폰 번호

`010-1234-5678`, `+82 10-1234-5678`, `82 1012345678`, `0082 10 1234 5678`,
`+82 010-1234-5678` 은 SDK가 전송 전에 모두 `01012345678` 로 정규화합니다
(`010` + 8자리, `011`/`016`-`019` + 7-8자리). 따라서 같은 번호는 입력
형태와 관계없이 항상 같은 값으로 전송됩니다(API 1.4.0부터는 서버도 번호별
레이트 리밋 키를 정규화합니다). 유선 번호는 거부되고, 해외 번호(E.164)는
`allowInternational` 일 때만 허용됩니다.

## WebOTP

K-OTP 는 인증번호를 기본적으로 카카오 알림톡으로 보내며, WebOTP 와
`one-time-code` 자동 입력은 알림톡을 받을 수 없어 자동으로 문자(SMS)로 대체
발송된 경우에만 동작합니다. 전송 후 브라우저가 지원하면 `navigator.credentials.get({ otp })` 를
호출합니다(기능 감지, 서버에서는 실행되지 않음). Android Chrome 은 SMS
마지막 줄이 `@<페이지 도메인> #<인증번호>` 형식일 때만 자동 입력합니다.
사용하는 템플릿의 SMS 가 도메인 줄로 끝나는지 확인하세요(기본 K-OTP 템플릿에는
없습니다). 이 줄이 없으면 요청이 그냥 완료되지 않을 뿐이므로 `webOtp` 를 켜
두어도 무해합니다(확인, 번호 변경, 언마운트 시 중단). iOS/Android 키보드의
`autocomplete="one-time-code"` 자동 입력은 그대로 동작합니다.

## SSR, Svelte 4/5

모든 UI 서브패스는 서버에서 불러오고 렌더링해도 요청, 타이머, `window`
접근이 없습니다. SSR 에서는 `id` 를 넘겨 서버와 클라이언트 id 를 맞추세요.
기본 언어는 서버와 브라우저 모두 `"ko"` 이고, `locale="auto"` 는 서버와 첫
렌더링에서는 `"ko"` 로 그린 뒤 마운트 후 `<html lang>` 을 따릅니다(`ko*` 또는
`lang` 없음은 한국어, 그 밖의 언어는 영어). 따라서 하이드레이션 불일치가
생기지 않습니다.

재전송 쿨다운(`resendCooldownMs`, 30초)은 중복 탭을 막는 UX 장치일 뿐 제한이
아니며, 실제 제한은 API 레이트 리밋입니다. 쿨다운은 시작한 번호에 묶여 있어
번호 변경 후 **다른** 번호는 바로 받을 수 있고, **같은** 번호로 돌아오면 남은
시간을 기다립니다.
Svelte 컴포넌트는 Svelte 4/5 가 모두 컴파일할 수 있는 `.svelte` 소스로
배포되어 앱의 Svelte 가 직접 컴파일합니다.
