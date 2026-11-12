function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    assert(url.origin === "https://sdk.test", "Unexpected API origin");
    assert(
      ["Bearer pk_test_receiver", "Bearer sk_test_receiver"].includes(
        request.headers.get("authorization"),
      ),
      "Unexpected authorization",
    );
    if (url.pathname === "/v1/issue" && request.method === "POST") {
      const body = await request.json();
      assert(
        body.idempotencyKey === "workerd-receiver" &&
          request.headers.get("idempotency-key") === body.idempotencyKey,
        "Idempotency mismatch",
      );
      assert(
        body.phoneNumber === "01000000000" &&
          ["login", "redirect"].includes(body.purpose),
        "Issue body changed",
      );
      if (body.purpose === "redirect")
        return Response.redirect("https://redirect.test/v1/issue", 307);
      return Response.json({
        issueId: "i_receiver",
        attemptsRemaining: 5,
        expiresAt: "2026-11-13T00:03:00.000Z",
        queuedAt: "2026-11-13T00:00:00.000Z",
      });
    }
    if (url.pathname === "/v1/verify" && request.method === "POST") {
      const body = await request.json();
      assert(
        body.issueId === "i_receiver" && body.code === "000000",
        "Verify body changed",
      );
      return Response.json({
        issueId: "i_receiver",
        verified: false,
        attemptsRemaining: 4,
        expiresAt: "2026-11-13T00:03:00.000Z",
      });
    }
    if (url.pathname === "/v1/balance" && request.method === "GET")
      return Response.json({
        balance: 42,
        currency: "KRW",
        lowBalanceThreshold: 10,
        isLowBalance: false,
      });
    throw new Error("Unexpected request");
  },
};
