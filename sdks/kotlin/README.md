# K-OTP server client for Kotlin/JVM

Install the Java release JAR using the [Java installation guide](../java/README.md).
Kotlin/JVM uses the same `dev.kotp:kotp-sdk:0.1.0` package and public API.

```kotlin
import dev.kotp.sdk.KotpClient

KotpClient(System.getenv("K_OTP_SECRET_KEY")).use { client ->
    val balance = client.balance()
}
```

Calls are synchronous and return Gson JSON values. Schedule blocking I/O on an
appropriate dispatcher. `KotpClient.KotpApiException` exposes `status`, `envelope`,
`requestId`, `retryAfterMs` and `headers`. `KotpTransportException.outcome` is
`"unknown"` after a transport failure; reconcile the original issue with the same
idempotency key. Automatic retries are disabled; the explicit issue retry option
allows one HTTP 503 retry with the same payload.

Validated with Kotlin 2.1.20 and JDK 21. Android and Kotlin Multiplatform are
outside this release's support scope. See the Java guide for all methods,
idempotency validation, options and connection lifetime.
