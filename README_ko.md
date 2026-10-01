# K-OTP SDK

[English](./README.md) | [한국어](./README_ko.md)

[K-OTP](https://api.k-otp.dev) 한국형 OTP API의 공식 JavaScript/TypeScript SDK입니다.
SMS 또는 카카오 알림톡으로 일회용 인증번호를 발급(issue)하고 검증(verify)합니다.

| 패키지 | 용도 |
| --- | --- |
| [`@k-otp/sdk-core`](./packages/sdk-core) | 브라우저(`pk_` 키)·SSR·엣지에서 `issue` / `verify`. 프레임워크 무관, `<script>` 번들(`window.KOtp`) 제공. |
| [`@k-otp/sdk-server`](./packages/sdk-server) | Node.js, Bun, Deno, Workers에서 `sk_` 키로 모든 공개 `/v1` 기능(상태, 발급 이력, 원장, 잔액, 템플릿) 호출. 크레딧은 조직 단위 지갑 하나입니다(API 1.4.0). |
| [`@k-otp/sdk-react`](./packages/sdk-react) | React 18/19 훅: `OtpProvider`, `useOtpIssue`, `useOtpVerify`, `useOtpFlow`(재발송 쿨다운 + 멱등키 관리). |
| [`@k-otp/sdk-vue`](./packages/sdk-vue) | Vue 3 플러그인·컴포저블: `createOtpPlugin`, `useOtp`, `useOtpFlow`. |
| [`@k-otp/sdk-svelte`](./packages/sdk-svelte) | Svelte 4/5 스토어: `createOtpStores`, 플로우 스토어, `use:otpForm`. |

어댑터는 `sdk-core` 위의 얇은 계층(각각 gzip 1 kB 미만)이며 동작과 정규화된 `OtpApiError`가 모두
동일합니다. 각 어댑터는 같은 버전의 `sdk-core`에 의존하고(락스텝 릴리스), 프레임워크는 peer dependency입니다.

## 빠른 시작

```bash
npm install @k-otp/sdk-server   # 백엔드
npm install @k-otp/sdk-core     # 브라우저 / SSR, 프레임워크 무관
npm install @k-otp/sdk-react    # 또는 @k-otp/sdk-vue, @k-otp/sdk-svelte
```

```ts
import { createIdempotencyKey, createOtpServerClient } from "@k-otp/sdk-server";

const otp = createOtpServerClient({ apiKey: process.env.K_OTP_SECRET_KEY! });

const idempotencyKey = createIdempotencyKey("signup"); // 저장해 두고 재시도 시 그대로 재사용
const { issueId } = await otp.issue({ phoneNumber: "01012345678", purpose: "signup", idempotencyKey });

const { verified, reasonCode } = await otp.verify({ issueId, code: "123456" });
```

정적 사이트:

```html
<script src="https://cdn.jsdelivr.net/npm/@k-otp/sdk-core@0.1.0/dist/k-otp.iife.min.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
<script>
  const otp = KOtp.createOtpClient({ apiKey: "pk_live_..." }); // Origin 정확히 일치 필요
</script>
```

## 핵심 규칙

- **`sk_` 비밀 키는 절대 브라우저/앱에 포함하지 마세요.** `sdk-core`는 브라우저에서 `sk_` 키를,
  `sdk-server`는 `sk_`로 시작하지 않는 키(`pk_` 포함)와 브라우저 실행을 거부합니다.
- **`pk_` 공개 키**는 `issue`/`verify`만 가능하며, 요청의 `Origin`이 키의 `allowedOrigins` 중
  하나와 정확히 일치해야 합니다(스킴·호스트·포트, 와일드카드 없음). 불일치 시 `403 FORBIDDEN`이며,
  브라우저에서는 API가 CORS 헤더를 보내지 않으므로 SDK에는 `NETWORK_ERROR`(status 0, requestId 없음)로
  나타납니다. **curl로는 되는데 브라우저에서 네트워크 오류가 나면 키의 allowedOrigins를 확인하세요.**
- **`issue`에는 멱등키가 필수입니다.** 한 번의 "인증번호 보내기" 동작마다 키를 하나 만들고 저장한 뒤,
  타임아웃·네트워크 오류·503 등으로 재시도할 때는 **반드시 같은 키**를 사용하세요. 새 키로 재시도하면
  문자가 중복 발송되고 이중 차감될 수 있습니다. 같은 키에 다른 내용을 보내면 `409 CONFLICT`입니다.
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
- [예제](./examples) (vanilla/CDN, React, Vue, Svelte, Node 서버)
- [오류, 재시도, 레이트 리밋(429), 멱등성](./docs/errors-and-retries.md)
- [보안: 키 종류와 Origin 허용 목록](./docs/security.md)
- [릴리스](./docs/releasing.md)
- API 레퍼런스: [`sdk-core`](./packages/sdk-core/README.md), [`sdk-server`](./packages/sdk-server/README.md), [`sdk-react`](./packages/sdk-react/README.md), [`sdk-vue`](./packages/sdk-vue/README.md), [`sdk-svelte`](./packages/sdk-svelte/README.md)

상세 문서는 현재 영어로 제공됩니다.

## API 스펙 동기화

공개 OpenAPI 문서를 [`spec/openapi.json`](./spec/openapi.json)에 벤더링하고, 여기서 TypeScript 타입을
생성합니다(`bun run gen:types`). `packages/sdk-core/src/contract.ts`의 oRPC 계약이 스펙과 어긋나면
드리프트 테스트가 CI를 실패시킵니다. 스펙 갱신은 `bun run sync:openapi`로 합니다.

## 개발

```bash
bun install
bun run check
```

[CONTRIBUTING.md](./CONTRIBUTING.md)를 참고하세요.

## 라이선스

[MIT](./LICENSE) © 2026 1990Company
