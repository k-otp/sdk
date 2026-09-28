# @k-otp/sdk-server

Server-side client for the [K-OTP](https://api.k-otp.dev) Korean OTP API. Works
in Node.js (>= 20.19), Bun, Deno and edge runtimes (Cloudflare Workers, Vercel
Edge) with an **`sk_` secret key**.

Covers every public `/v1` operation: issue, verify, status, issue history,
credit ledger, balance and templates. It shares the error model and transport
of [`@k-otp/sdk-core`](../sdk-core) and re-exports its common helpers.

## Install

```bash
npm install @k-otp/sdk-server
```

## Quick start

```ts
import { createIdempotencyKey, createOtpServerClient, isOtpApiError } from "@k-otp/sdk-server";

const otp = createOtpServerClient({ apiKey: process.env.K_OTP_SECRET_KEY! });

// Persist this key with the pending sign-up and reuse it on retries.
const idempotencyKey = createIdempotencyKey("signup");

try {
  const { issueId } = await otp.issue({
    phoneNumber: "01012345678",
    purpose: "signup",
    templateId: "otp_signup_kr",
    idempotencyKey,
  });
  const status = await otp.getStatus({ issueId });
  console.log(status.overallStatus); // in_progress | delivered | delivery_failed | ...
} catch (error) {
  if (isOtpApiError(error) && error.code === "PAYMENT_REQUIRED") {
    // error.data.code: INSUFFICIENT_CREDIT | OVERDRAFT_LIMIT_EXCEEDED
  }
  throw error;
}
```

Cloudflare Workers:

```ts
export default {
  async fetch(request: Request, env: { K_OTP_SECRET_KEY: string }) {
    const otp = createOtpServerClient({ apiKey: env.K_OTP_SECRET_KEY });
    return Response.json(await otp.getBalance());
  },
};
```

## API

`createOtpServerClient(options)` accepts the same options as
`createOtpClient` in sdk-core (`apiKey`, `baseUrl`, `fetch`, `timeoutMs`,
`headers`, `hooks`) plus `dangerouslyAllowBrowser`.

- `pk_` public keys are refused with a `TypeError` (at construction, or before
  the request for lazily resolved keys).
- Constructing the client where `window` and `document` exist throws, because
  an `sk_` key must never reach a browser. `dangerouslyAllowBrowser: true` is
  meant for jsdom-style tests only.

| Method | HTTP | Notes |
| --- | --- | --- |
| `issue(input)` | `POST /v1/issue` | `idempotencyKey` required (validated before the request). |
| `verify(input)` | `POST /v1/verify` | Wrong codes resolve with `verified: false` + `reasonCode`. |
| `getStatus({ issueId })` | `GET /v1/status` | `overallStatus`, delivery + verification state. Recently issued ids may report `pending_lookup` for up to 60 s. |
| `listIssues(query?)` | `GET /v1/issues` | One page (`items`, `nextCursor?`). Filters: `limit` (1-100), `cursor`, `verificationStatus`, `createdFrom`, `createdTo`. |
| `iterateIssues(query?, options?)` | `GET /v1/issues` | `AsyncGenerator` over all items, following `nextCursor`. |
| `getIssue({ issueId })` | `GET /v1/issues/{issueId}` | Billing status and attempt counters. |
| `listCreditLedger(query?)` | `GET /v1/credit-ledger` | One page. Filters: `limit`, `cursor`, `entryType`, `createdFrom`, `createdTo`. |
| `iterateCreditLedger(query?, options?)` | `GET /v1/credit-ledger` | `AsyncGenerator` over all entries. |
| `getBalance()` | `GET /v1/balance` | Credit balance (`currency: "CREDIT"`). |
| `listTemplates()` | `GET /v1/templates` | Whitelisted templates + `defaultTemplateId`. |
| `getTemplate({ templateId })` | `GET /v1/templates/{templateId}` | Includes the `variables` schema for `templateVariables`. |

Every method takes an optional last argument `{ signal?, timeoutMs? }`; the
iterators additionally accept `maxPages`.

### Pagination

```ts
for await (const issue of otp.iterateIssues({ verificationStatus: "verified", limit: 100 })) {
  console.log(issue.issueId, issue.billingStatus);
}

// Or page by page with the generic helpers:
import { paginatePages } from "@k-otp/sdk-server";
for await (const page of paginatePages((q) => otp.listCreditLedger(q), { entryType: "debit" })) {
  console.log(page.items.length);
}
```

Cursors are opaque and bound to the endpoint that issued them; keep the same
filters while paging (the helpers do this for you). Breaking out of a
`for await` loop stops fetching.

### Errors

Rejections are `OtpApiError` with the same codes, `status`, `requestId`,
`data` and `retryAfterMs` as sdk-core. See
[errors and retries](../../docs/errors-and-retries.md).

## Not included

Internal billing (credit/debit), quota maintenance and provider reconciliation
endpoints are private to the K-OTP platform and are intentionally not part of
this SDK.

## License

MIT
