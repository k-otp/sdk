/**
 * A stand-in for the K-OTP API so the example runs without a key. The
 * correct code is always 123456. Not part of the SDK.
 */
const MOCK_CODE = "123456";
/** Wallet balance after the mocked debit; the ledger entries add up to it. */
const MOCK_BALANCE = 999;
const issues = new Map<
  string,
  { attempts: number; expiresAt: string; verifiedAt?: string }
>();

const reply = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

export const mockFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const path = new URL(request.url).pathname;
  // API 1.4.0: one credit wallet per organization, shared by all of its apps.
  if (request.method === "GET" && path.endsWith("/balance")) {
    return reply({
      appId: "app_mock",
      walletId: "org:org_mock",
      walletScope: "organization",
      organizationId: "org_mock",
      balance: MOCK_BALANCE,
      currency: "CREDIT",
      updatedAt: new Date().toISOString(),
    });
  }
  if (request.method === "GET" && path.endsWith("/credit-ledger")) {
    // Newest first: this app's debit, then the wallet's credit (no appId: not
    // attributed to an app). Honors the entryType and limit query params.
    const query = new URL(request.url).searchParams;
    const entryType = query.get("entryType");
    const limit = Number(query.get("limit") ?? 20);
    const entries = [
      {
        ledgerId: "00000000-0000-4000-8000-000000000002",
        issueId: "5f2b1c3e-8d4a-4f6b-9a7c-1e2d3c4b5a69",
        entryType: "debit",
        appId: "app_mock",
        amountDelta: -1,
        balanceAfter: MOCK_BALANCE,
        currency: "CREDIT",
        createdAt: new Date().toISOString(),
      },
      {
        ledgerId: "00000000-0000-4000-8000-000000000001",
        entryType: "credit",
        amountDelta: MOCK_BALANCE + 1,
        balanceAfter: MOCK_BALANCE + 1,
        currency: "CREDIT",
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    ].filter((entry) => !entryType || entry.entryType === entryType);
    return reply({ items: entries.slice(0, limit) });
  }
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    string
  >;
  if (path.endsWith("/issue")) {
    const issueId = `mock-${body.idempotencyKey}`;
    if (!issues.has(issueId)) {
      issues.set(issueId, {
        attempts: 5,
        expiresAt: new Date(Date.now() + 180_000).toISOString(),
      });
      console.info(`[mock] OTP for ${body.phoneNumber}: ${MOCK_CODE}`);
    }
    const issue = issues.get(issueId);
    return reply({
      issueId,
      expiresAt: issue?.expiresAt,
      attemptsRemaining: issue?.attempts,
      queuedAt: new Date().toISOString(),
    });
  }
  if (path.endsWith("/verify")) {
    const issue = issues.get(body.issueId ?? "");
    if (!issue) {
      return reply({
        issueId: body.issueId,
        verified: false,
        reasonCode: "NOT_FOUND",
        attemptsRemaining: 0,
        expiresAt: new Date().toISOString(),
      });
    }
    // Like the real API: a consumed, expired or locked code never verifies.
    const rejected = (reasonCode: string) =>
      reply({
        issueId: body.issueId,
        verified: false,
        reasonCode,
        attemptsRemaining: issue.attempts,
        expiresAt: issue.expiresAt,
      });
    if (issue.verifiedAt) return rejected("ALREADY_VERIFIED");
    if (Date.parse(issue.expiresAt) <= Date.now()) return rejected("EXPIRED");
    if (issue.attempts <= 0) return rejected("MAX_ATTEMPTS");
    if (body.code !== MOCK_CODE) {
      issue.attempts -= 1;
      return rejected(issue.attempts > 0 ? "MISMATCH" : "MAX_ATTEMPTS");
    }
    issue.verifiedAt = new Date().toISOString();
    return reply({
      issueId: body.issueId,
      verified: true,
      verifiedAt: issue.verifiedAt,
      attemptsRemaining: issue.attempts,
      expiresAt: issue.expiresAt,
    });
  }
  return reply(
    { defined: true, code: "NOT_FOUND", status: 404, message: "Not found" },
    404,
  );
};
