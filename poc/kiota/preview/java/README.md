# K-OTP server client for Java and Kotlin/JVM

Install the local `dev.kotp.poc:kiota-sdk:0.1.0-preview.1` JAR and reference
it as a Maven dependency. Java 17 bytecode is supplied.

```java
import dev.kotp.sdk.preview.KotpClient;
try (KotpClient client = new KotpClient(System.getenv("K_OTP_SECRET_KEY"))) {
    var balance = client.balance();
}
```

Kotlin/JVM consumes the same JAR:

```kotlin
KotpClient(System.getenv("K_OTP_SECRET_KEY")).use { client ->
    val balance = client.balance()
}
```

This synchronous server client uses `sk_` keys and returns Gson JSON values.
Methods: `issue`, `verify`, `status`, `issues`, `issueDetail`, `creditLedger`,
`balance`, `templates`, `templateDetail`. Issue/verify take a `JsonObject`.
List queries accept `limit`, `cursor`, ISO 8601 `createdFrom`/`createdTo`, and
`verificationStatus` or `entryType`. Phone numbers and codes are strings.

Issue requires a trimmed nonempty ASCII `idempotencyKey`, at most 128 characters.
The same key is sent in header and body. Automatic retries are disabled.
`new KotpClient.RequestOptions(headers, origin, true)` allows one issue retry
after an explicit HTTP 503 response. Other operations never automatically retry.
Authentication and idempotency headers cannot be replaced.

`KotpClient.KotpApiException` exposes HTTP `status`, JSON `envelope`, `requestId`,
`retryAfterMs` and lowercase `headers`. `KotpTransportException.outcome` is
`"unknown"`; an issue may have reached the server before a timeout. Reconcile
using the original key instead of starting a new operation.

The constructor accepts `baseUrl` and `timeoutMs` (default 10000). HTTPS and
loopback HTTP are supported. Requests to another origin and redirects are
rejected. Close the client to release its connection pool. Kotlin callers
should schedule blocking I/O on a suitable dispatcher. This local preview
does not yet cover Android or Kotlin Multiplatform.
