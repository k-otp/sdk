# K-OTP server client for Ruby

Install the release gem:

```sh
gem install --local kotp_sdk-0.1.0.gem
```

```ruby
require 'kotp_sdk'
client = KOtp::Client.new(ENV.fetch('K_OTP_SECRET_KEY'))
balance = client.balance
```

This server client uses an `sk_` key and returns JSON values as Hash/Array/scalars.
Methods: `issue`, `verify`, `status`, `issues`, `issue_detail`, `credit_ledger`,
`balance`, `templates`, `template_detail`. Input hashes use API JSON names;
symbol keys also work. List filters accept `limit`, `cursor`, ISO 8601
`createdFrom`/`createdTo`, and `verificationStatus` or `entryType`. Keep phone
numbers and codes as strings.

Issue requires a trimmed nonempty ASCII `idempotencyKey` up to 128 characters.
The same key is sent in header and body. Automatic retries are disabled.
`client.issue(input, retry503: true)` permits one retry following an explicit
HTTP 503 response. Other operations never automatically retry. Per-call
`headers` and issue `origin` may be provided; authentication and idempotency
headers cannot be replaced.

`KOtp::ApiError` exposes HTTP `status`, JSON `envelope`, `request_id`,
`retry_after_ms` and lowercase `headers`. `TransportError#outcome` is `'unknown'`:
a timed-out issue may have reached the server. Reconcile with the original key
instead of starting a new operation.

`timeout_ms` defaults to 10000. `base_url` accepts HTTPS or loopback HTTP for
local tests. Redirect middleware is not installed and requests to another
origin are rejected. This release uses Ruby 3.3+ and pinned JSON runtime
dependencies. Loading it installs a guarded process-wide JSON compatibility
hook; keep the locked runtime versions when using other clients in the same
process. Additional environments remain under evaluation.
