# K-OTP server client for Go

Use the supplied local module proxy ZIP for
`github.com/k-otp/sdk/poc/kiota/generated@v0.1.0-preview.1`. Configure `GOPROXY`
to the local `packages` directory and exempt this local module from the checksum
server with `GONOSUMDB`. Import its `preview` package:

```go
client, err := preview.New(preview.Options{APIKey: os.Getenv("K_OTP_SECRET_KEY")})
if err != nil { return err }
balance, err := client.Balance(ctx, preview.RequestOptions{})
```

This server client accepts `sk_` keys and returns ordinary JSON values.
Methods: `Issue`, `Verify`, `Status`, `Issues`, `IssueDetail`, `CreditLedger`,
`Balance`, `Templates`, `TemplateDetail`. Issue/verify accept `json.RawMessage`;
lists accept `map[string]any` using API JSON names: `limit`, `cursor`, RFC 3339
`createdFrom`/`createdTo`, and `verificationStatus` or `entryType`. Keep phone
numbers and codes as JSON strings.

Issue requires a trimmed nonempty ASCII `idempotencyKey` up to 128 characters.
The same key is sent in header and body. Automatic retries are disabled.
`RequestOptions{Retry503:true}` permits one issue retry after an explicit HTTP
503 response. Other operations never automatically retry. Request options also
accept `Headers` and `Origin`; authentication and idempotency headers cannot be
replaced.

Use `errors.As` to read `*preview.APIError`: HTTP `Status`, JSON `Envelope`,
`RequestID`, `RetryAfterMs` and lowercase `Headers`. `*preview.TransportError`
returns `Outcome()=="unknown"`; a timed-out issue may have reached the server.
Reconcile it with the original key rather than starting a new operation.

Every call accepts a context. `Options.Timeout` defaults to 10 seconds.
`Options.BaseURL` accepts HTTPS or loopback HTTP for local tests. Redirects and
requests to another origin are rejected. A supplied transport must honor the
request context. This is a local preview; additional Go versions and production
network environments remain under evaluation.
