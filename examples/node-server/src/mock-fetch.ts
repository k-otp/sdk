/**
 * A stand-in for the K-OTP API so the example runs without a key. The
 * correct code is always 123456. Not part of the SDK.
 */
const MOCK_CODE = "123456";
const issues = new Map<
  string,
  { attempts: number; expiresAt: string; verifiedAt?: string }
>();

const reply = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

export const mockFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    string
  >;
  const path = new URL(request.url).pathname;
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
