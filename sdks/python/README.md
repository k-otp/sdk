# K-OTP server client for Python

Install the release wheel:

```sh
python -m pip install ./kotp_sdk-0.1.0-py3-none-any.whl
```

```python
import os
from kotp_sdk import KotpClient, KotpApiError, KotpTransportError

async with KotpClient(os.environ["K_OTP_SECRET_KEY"]) as client:
    balance = await client.balance()
```

Use this async client on a server with an `sk_` key. Responses are JSON values.
Methods: `issue(input)`, `verify(input)`, `status(issue_id)`, `issues(query)`,
`issue_detail(issue_id)`, `credit_ledger(query)`, `balance()`, `templates()` and
`template_detail(template_id)`. Inputs use the API's JSON names. List queries
accept `limit`, `cursor`, `createdFrom`, `createdTo`, and `verificationStatus`
for issues or `entryType` for credit entries. Dates are ISO 8601 strings.

`issue` requires `idempotencyKey`: trimmed nonempty ASCII, at most 128 characters.
The same key is sent in header and body. Phone numbers and verification codes
remain strings. Automatic retries are disabled. `issue(..., retry503=True)`
allows one retry after an HTTP 503 response with the same body and key.

Catch `KotpApiError` for `status`, `envelope` (`defined`, `code`, `status`,
`message`, `data`), `request_id`, `retry_after_ms`, and lowercase `headers`.
`KotpTransportError.outcome` is `"unknown"`; a timed-out request may have reached
the server. Reconcile an uncertain issue instead of retrying with a new key.
Caller task cancellation still propagates normally.

`timeout_ms` defaults to 10000. `base_url` defaults to the HTTPS API and accepts
loopback HTTP for local tests. `headers` and issue `origin` are optional per-call
settings. Authentication and idempotency headers cannot be replaced. Requests
to another origin and redirects are rejected. Use `async with` or call `aclose()`;
the client owns its transport, including a supplied test transport.

This is a release. Supported runtime: Python 3.13.
