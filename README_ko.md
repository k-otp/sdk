# K-OTP SDK

[English](./README.md) | [한국어](./README_ko.md)

[K-OTP](https://api.k-otp.dev) 한국형 OTP API의 공식 JavaScript/TypeScript SDK입니다.
일회용 인증번호를 발급(issue)하고 검증(verify)합니다. 인증번호는 기본적으로 카카오 알림톡으로 보내며,
알림톡을 받을 수 없으면 자동으로 문자(SMS)로 대체 발송합니다.
npm 패키지는 [`@k-otp/sdk`](./packages/sdk) 하나이며, 용도별 서브패스로 나뉩니다.

| 임포트 | 용도 |
| --- | --- |
| [`@k-otp/sdk`](./packages/sdk/README.md) (= `@k-otp/sdk/core`) | 브라우저(`pk_` 키)·SSR·엣지에서 `issue` / `verify`. 프레임워크 무관. |
| [`@k-otp/sdk/server`](./docs/reference/server.md) | Node.js, Bun, Deno, Workers에서 `sk_` 키로 모든 공개 `/v1` 기능(상태, 발급 이력, 원장, 잔액, 템플릿) 호출. 크레딧은 조직 단위 지갑 하나입니다(API 1.4.0). 브라우저 번들에는 포함되지 않습니다. |
| [`@k-otp/sdk/react`](./docs/reference/react.md) | React 18/19 훅: `OtpProvider`, `useOtpIssue`, `useOtpVerify`, `useOtpFlow`(재발송 쿨다운 + 멱등키 관리). |
| [`@k-otp/sdk/vue`](./docs/reference/vue.md) | Vue 3 플러그인·컴포저블: `createOtpPlugin`, `useOtp`, `useOtpFlow`. |
| [`@k-otp/sdk/svelte`](./docs/reference/svelte.md) | Svelte 4/5 스토어: `createOtpStores`, 플로우 스토어, `use:otpForm`. |
| [`@k-otp/sdk/ui/react`, `/ui/vue`, `/ui/svelte`](./docs/ui.md#ui-컴포넌트-한국어) | 헤드리스 UI 컴포넌트: 한 줄짜리 `<OtpForm />` 과 조합 가능한 파트(번호 입력, 인증번호 받기/재전송, 인증번호 자동 입력을 지원하는 분할 인증번호 입력, 확인, 카운트다운, 메시지), 한국어/영어. |
| [`@k-otp/sdk/ui/theme.css`](./docs/ui.md#테마) | UI 컴포넌트용 선택적 기본 테마(라이트/다크, 토큰). |
| [`@k-otp/sdk/ui`](./docs/reference/ui.md#k-otpsdkui) | 프레임워크 무관 UI 모델: 번호 정규화, 인증번호 입력, 폼 상태 머신, 메시지, WebOTP. |
| [`@k-otp/sdk/headless`](./packages/sdk/README.md#headless-flow-k-otpsdkheadless) | 어댑터들이 공유하는 프레임워크 무관 발급 -> 검증 플로우. |
| [`@k-otp/sdk/contract`](./packages/sdk/README.md#advanced-entry-points) | oRPC 계약과 생성된 OpenAPI 타입. |
| [`@k-otp/sdk/k-otp.iife.min.js`](./packages/sdk/README.md#cdn--static-sites) | 정적 사이트용 `<script>` 번들(`window.KOtp`), jsDelivr 또는 unpkg. |

프레임워크 서브패스는 코어 위의 얇은 계층(각각 gzip 약 1 kB)이며 동작과 정규화된 `OtpApiError`가 모두
동일하고, 모듈 포맷(ESM/CJS)별로 하나의 공유 코어를 사용합니다(`instanceof OtpApiError`는 포맷 간에도 동작). React, Vue, Svelte는 선택적(optional) peer dependency이며,
`@k-otp/sdk/react`를 임포트해도 Vue, Svelte, 서버 클라이언트는 로드되지 않습니다.

## 빠른 시작

```bash
npm install @k-otp/sdk
# 어댑터를 쓰면 프레임워크도 함께: react, vue 또는 svelte (선택적 peer)
```

```ts
import { createIdempotencyKey, createOtpServerClient } from "@k-otp/sdk/server";

const otp = createOtpServerClient({ apiKey: process.env.K_OTP_SECRET_KEY! });

const idempotencyKey = createIdempotencyKey("signup"); // 저장해 두고 재시도 시 그대로 재사용
const { issueId } = await otp.issue({ phoneNumber: "01012345678", purpose: "signup", idempotencyKey });

const { verified, reasonCode } = await otp.verify({ issueId, code: "123456" });
```

정적 사이트:

```html
<script src="https://cdn.jsdelivr.net/npm/@k-otp/sdk@1.0.1/dist/k-otp.iife.min.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
<script>
  const otp = KOtp.createOtpClient({ apiKey: "pk_live_..." }); // Origin 정확히 일치 필요
</script>
```

## UI 컴포넌트

접근성을 갖춘 휴대폰 인증 폼을 한 줄로 쓸 수 있습니다(React 예시, Vue와
Svelte도 같은 방식). 테마를 임포트하지 않으면 스타일이 없습니다.

```tsx
import { OtpForm } from "@k-otp/sdk/ui/react";
import "@k-otp/sdk/ui/theme.css"; // 선택: 기본 테마

<OtpForm options={{ apiKey: "pk_live_..." }} purpose="signup" onVerified={(r) => console.log(r.issueId)} />;
```

휴대폰 번호는 전송 전에 정규화되고(`+82 10-...` -> `010...`),
인증번호 입력은 붙여넣기, 자동 입력(`one-time-code`, WebOTP), 키보드 이동을
지원하며, 포커스가 흐름을 따라 이동합니다. 모든 파트가 `data-*` 상태를
노출하므로 직접 스타일을 입히거나 `OtpForm.Root`, `OtpForm.PhoneField` 등으로
완전히 헤드리스하게 조합할 수 있습니다. [UI 가이드](./docs/ui.md#ui-컴포넌트-한국어)를
참고하세요.

## 핵심 규칙

- **`sk_` 비밀 키는 절대 브라우저/앱에 포함하지 마세요.** `@k-otp/sdk`는 브라우저에서 `sk_` 키를,
  `@k-otp/sdk/server`는 `sk_`로 시작하지 않는 키(`pk_` 포함)와 브라우저 실행을 거부합니다. 브라우저용
  번들러는 `browser` export condition으로 `@k-otp/sdk/server`를 호출 시 오류를 던지는 스텁으로 해석합니다.
- **`pk_` 공개 키**는 `issue`/`verify`만 가능하며, 요청의 `Origin`이 키의 `allowedOrigins` 중
  하나와 정확히 일치해야 합니다(스킴·호스트·포트, 와일드카드 없음). 불일치 시 `403 FORBIDDEN`이며,
  브라우저에서는 API가 CORS 헤더를 보내지 않으므로 SDK에는 `NETWORK_ERROR`(status 0, requestId 없음)로
  나타납니다. **curl로는 되는데 브라우저에서 네트워크 오류가 나면 키의 allowedOrigins를 확인하세요.**
- **`issue`에는 멱등키가 필수입니다.** 한 번의 "인증번호 보내기" 동작마다 키를 하나 만들고 저장한 뒤,
  타임아웃·네트워크 오류·503 등으로 재시도할 때는 **반드시 같은 키**를 사용하세요. 새 키로 재시도하면
  인증 메시지가 중복 발송되고 이중 차감될 수 있습니다. 같은 키에 다른 내용을 보내면 `409 CONFLICT`입니다.
- 잘못된 코드는 예외가 아니라 `verified: false` + `reasonCode`(`MISMATCH`, `MAX_ATTEMPTS`,
  `EXPIRED`, `ALREADY_VERIFIED`, `REPLACED`, `NOT_FOUND`)로 반환됩니다.
- 어댑터의 `useOtpFlow`/플로우 스토어는 발송 시도마다 멱등키를 만들고, 모호한 실패(타임아웃, 네트워크,
  5xx, 429) 후 같은 입력으로 다시 보내면 같은 키를 재사용합니다. 429의 `retryAfterMs`와 로컬
  `resendCooldownMs`로 재발송 쿨다운을 관리하고, `verify`가 429를 받으면 별도의 검증 쿨다운
  (`verifyCooldownRemainingMs`, 그동안 `canVerify: false`)을 적용합니다.
- 그 밖의 실패는 모두 `OtpApiError`(`code`, `status`, `requestId`, `data`, `retryAfterMs`,
  `retryable`)로 정규화됩니다. 잔액 부족은 `PAYMENT_REQUIRED`(402, `data.code`)입니다.
- 크레딧은 조직 단위 지갑 하나를 조직의 모든 앱이 함께 씁니다(API 1.4.0). `getBalance()`는 조직 전체 잔액을
  돌려주며 `walletId`, `walletScope`(`organization`), `organizationId`가 함께 옵니다. `appId`는 호출한 앱입니다.
  `listCreditLedger`는 지갑의 `credit`/`clawback`과 **호출한 앱의** `debit`/`refund`만 돌려주므로, 다른 앱의
  차감은 보이지 않아 `balanceAfter`(지갑 잔액) 차이가 `amountDelta`와 다를 수 있습니다. 1.4.0 이전 API는
  `walletId`/`walletScope`를 보내지 않으므로 타입에서 선택값이며, 없으면 `app`(앱 지갑)으로 보세요.
- `issue`/`verify`는 API 키별 레이트 리밋이 적용됩니다(API 1.3.1). 초과하면 재시도 가능한
  `TOO_MANY_REQUESTS`(429)로 거절되며, `retryAfterMs`(본문 `data.retryAfterMs`, 없으면
  `Retry-After` 헤더)만큼 기다린 뒤 같은 멱등키로 재시도하세요. `data.limit`(`perKey`, `perIp`,
  `perPhone`)과 `data.policy`(`key`: 키 자체 정책, `platform`: 플랫폼 기본값 또는 상한)로 어떤
  제한인지 알 수 있습니다. 거절된 요청은 한도나 검증 시도 횟수를 소모하지 않습니다.

## 문서

- [시작하기](./docs/getting-started.md)
- [발급 -> 검증 UX(쿨다운, 재발송, 재시도, 402/429)](./docs/issue-verify-ux.md)
- 프레임워크 가이드: [React](./docs/react.md), [Vue](./docs/vue.md), [Svelte](./docs/svelte.md)
- [UI 컴포넌트와 테마](./docs/ui.md#ui-컴포넌트-한국어) (한국어 섹션 포함)
- [예제](./examples) (vanilla/CDN, React, Vue, Svelte, Node 서버)
- [오류, 재시도, 레이트 리밋(429), 멱등성](./docs/errors-and-retries.md)
- [보안: 키 종류와 Origin 허용 목록](./docs/security.md)
- [릴리스](./docs/releasing.md)
- API 레퍼런스: [`@k-otp/sdk`](./packages/sdk/README.md)(core, headless, contract, CDN), [`/server`](./docs/reference/server.md), [`/react`](./docs/reference/react.md), [`/vue`](./docs/reference/vue.md), [`/svelte`](./docs/reference/svelte.md), [`/ui*`](./docs/reference/ui.md)

상세 문서는 현재 영어로 제공됩니다.

## API 스펙 동기화

공개 OpenAPI 문서를 [`spec/openapi.json`](./spec/openapi.json)에 벤더링하고, 여기서 TypeScript 타입을
생성합니다(`bun run gen:types`). `packages/sdk/src/core/contract.ts`의 oRPC 계약이 스펙과 어긋나면
드리프트 테스트가 CI를 실패시킵니다. 스펙 갱신은 `bun run sync:openapi`로 합니다.

## 개발

```bash
bun install
bun run check
```

[CONTRIBUTING.md](./CONTRIBUTING.md)를 참고하세요.

## 라이선스

[MIT](./LICENSE) © 2026 1990Company
