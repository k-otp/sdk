# K-OTP server client for Dart

Extract the local `kotp-kiota-poc-dart.tar.gz` archive and add its directory as
a Pub path dependency named `kotp_kiota_poc` (version `0.1.0-dev.1`).

```dart
import 'package:kotp_kiota_poc/kotp_kiota_preview.dart';
final client = KotpClient(secretKey);
try {
  final balance = await client.balance();
} finally {
  client.close();
}
```

This server client uses an `sk_` key. Responses are ordinary JSON values.
Methods: `issue`, `verify`, `status`, `issues`, `issueDetail`, `creditLedger`,
`balance`, `templates`, `templateDetail`. Input maps use API JSON names. List
queries accept `limit`, `cursor`, ISO 8601 `createdFrom`/`createdTo`, and
`verificationStatus` or `entryType`. Keep phone numbers and codes as strings.

Issue requires a trimmed nonempty ASCII `idempotencyKey` up to 128 characters.
The same key is sent in header and body. Automatic retries are disabled.
`RequestOptions(retry503:true)` permits one issue retry following an explicit
HTTP 503 response. Other operations never automatically retry. Options accept
custom `headers` and issue `origin`; authentication and idempotency headers
cannot be replaced. List methods take options as their second positional
argument; other methods use the named `options` argument.

`KotpApiError` exposes HTTP `status`, JSON `envelope`, `requestId`,
`retryAfterMs` and lowercase `headers`. `KotpTransportError.outcome` is
`'unknown'`; a timed-out issue may have reached the server. Reconcile using the
original key instead of starting a new operation. Timeout does not prove that
the remote operation was cancelled.

`timeoutMs` defaults to 10000. `baseUrl` accepts HTTPS or loopback HTTP for local
tests. Redirects and requests to another origin are rejected. The client owns
its HTTP transport, including a supplied test transport; call `close()` when
finished. This local preview targets Dart 3.9; Flutter/mobile and production
network environments remain under evaluation.
