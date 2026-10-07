# K-OTP server client for PHP

Configure a Composer artifact repository pointing to the local ZIP directory,
then require `k-otp/sdk:0.1.0`.

```sh
composer config repositories.kotp artifact ./packages
composer require k-otp/sdk:0.1.0
```

Place the downloaded release ZIP in `./packages`.

```php
use KOtp\KotpClient;
$client = new KotpClient(getenv('K_OTP_SECRET_KEY'));
$balance = $client->balance();
```

This synchronous server client uses an `sk_` key. Responses use `stdClass` for
JSON objects and arrays for JSON lists, preserving empty objects. Methods:
`issue`, `verify`, `status`, `issues`, `issueDetail`, `creditLedger`, `balance`,
`templates`, `templateDetail`. Inputs are arrays with API JSON property names.
List filters accept `limit`, `cursor`, ISO 8601 `createdFrom`/`createdTo` and
`verificationStatus` or `entryType`. Phone numbers and codes remain strings.

Issue requires a trimmed nonempty ASCII `idempotencyKey` up to 128 characters;
the client sends the same key in header and body. Automatic retries are
disabled. `['retry503'=>true]` in issue options permits one retry following
an explicit HTTP 503 response. Other operations never automatically retry.
Options also accept `headers` and issue `origin`; authentication and
idempotency headers cannot be replaced.

Catch `KotpApiError` for HTTP `status`, JSON `envelope`, `requestId`,
`retryAfterMs` and lowercase `headers`. `KotpTransportError.outcome` is
`'unknown'`; a timed-out issue may have reached the server. Reconcile with
the original idempotency key instead of starting a new operation.

The constructor accepts `baseUrl` and `timeoutMs` (default 10000). HTTPS and
loopback HTTP are supported. Redirects and requests to another origin are
rejected. This release requires PHP 8.2 or later; additional supported
versions and production network environments remain under evaluation.
