# K-OTP SDK

[English](./README.md) | [한국어](./README_ko.md)

[K-OTP](https://api.k-otp.dev) 한국형 OTP API의 공식 JavaScript/TypeScript SDK입니다.
SMS 또는 카카오 알림톡으로 일회용 인증번호를 발급(issue)하고 검증(verify)합니다.

| 패키지 | 용도 |
| --- | --- |
| [`@k-otp/sdk-core`](./packages/sdk-core) | 브라우저(`pk_` 키)·SSR·엣지에서 `issue` / `verify`. 프레임워크 무관, `<script>` 번들(`window.KOtp`) 제공. |
| [`@k-otp/sdk-server`](./packages/sdk-server) | Node.js, Bun, Deno, Workers에서 `sk_` 키로 모든 공개 `/v1` 기능(상태, 발급 이력, 원장, 잔액, 템플릿) 호출. |

`sdk-core` 기반의 React, Vue, Svelte 어댑터는 다음 단계에서 제공됩니다.

## 빠른 시작

```bash
npm install @k-otp/sdk-server   # 백엔드
npm install @k-otp/sdk-core     # 브라우저 / SSR
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
  `sdk-server`는 `pk_` 키와 브라우저 실행을 거부합니다.
- **`pk_` 공개 키**는 `issue`/`verify`만 가능하며, 요청의 `Origin`이 키의 `allowedOrigins` 중
  하나와 정확히 일치해야 합니다(스킴·호스트·포트, 와일드카드 없음). 불일치 시 `403 FORBIDDEN`.
- **`issue`에는 멱등키가 필수입니다.** 한 번의 "인증번호 보내기" 동작마다 키를 하나 만들고 저장한 뒤,
  타임아웃·네트워크 오류·503 등으로 재시도할 때는 **반드시 같은 키**를 사용하세요. 새 키로 재시도하면
  문자가 중복 발송되고 이중 차감될 수 있습니다. 같은 키에 다른 내용을 보내면 `409 CONFLICT`입니다.
- 잘못된 코드는 예외가 아니라 `verified: false` + `reasonCode`(`MISMATCH`, `MAX_ATTEMPTS`,
  `EXPIRED`, `ALREADY_VERIFIED`, `REPLACED`, `NOT_FOUND`)로 반환됩니다.
- 그 밖의 실패는 모두 `OtpApiError`(`code`, `status`, `requestId`, `data`, `retryAfterMs`,
  `retryable`)로 정규화됩니다. 잔액 부족은 `PAYMENT_REQUIRED`(402, `data.code`)입니다.

## 문서

- [시작하기](./docs/getting-started.md)
- [오류, 재시도, 멱등성](./docs/errors-and-retries.md)
- [보안: 키 종류와 Origin 허용 목록](./docs/security.md)
- [릴리스](./docs/releasing.md)
- API 레퍼런스: [`sdk-core`](./packages/sdk-core/README.md), [`sdk-server`](./packages/sdk-server/README.md)

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
