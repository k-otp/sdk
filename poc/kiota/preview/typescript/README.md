# K-OTP server client for TypeScript

Install the local preview archive with Bun:

```sh
bun add ./kotp-kiota-poc-typescript-0.1.0-preview.1.tgz
```

```ts
import { KotpClient, KotpApiError, KotpTransportError } from "kotp-kiota-poc-typescript";

const client = new KotpClient({ apiKey: process.env.K_OTP_SECRET_KEY! });
const balance = await client.balance();
```

This server client accepts `sk_` keys. Keep keys in server environment variables.
Responses are ordinary JSON values. The client provides `issue(input)`,
`verify(input)`, `status(issueId)`, `issues(query)`, `issueDetail(issueId)`,
`creditLedger(query)`, `balance()`, `templates()` and `templateDetail(templateId)`.
Pass the API's JSON property names in inputs and queries. Preserve phone numbers
and verification codes as strings. Cursor pages are requested with `issues({cursor})`.

`issue` requires a nonempty ASCII `idempotencyKey` of up to 128 characters.
The client trims surrounding whitespace and sends the same key in body and
header. Reuse the key when checking an uncertain operation; do not invent a new
key merely because the first request timed out.

Automatic retries are disabled. To allow exactly one retry after an explicit
HTTP 503 response, pass `{retry503: true}` to `issue`. Verification is never
automatically retried. Optional request settings also accept `origin` and custom
`headers`; authentication and idempotency headers are managed by the client.

`KotpApiError` exposes `status`, `envelope` (`defined`, `code`, `status`, `message`,
`data`), `requestId`, `retryAfterMs` and lowercase `headers`. `KotpTransportError`
has `outcome: "unknown"`: the server may have processed the request. Other
configuration/programming errors retain their original type.

The default request timeout is 10 seconds. Set `timeoutMs` in the constructor.
An HTTPS `baseUrl` may be supplied; loopback HTTP is supported for local tests.
Redirects and requests to another origin are rejected before credentials leave
the configured origin. A supplied `fetch` implementation must honor the signal
and redirect settings. This is a local preview archive; compatibility across
additional runtimes and production network environments remains under evaluation.
