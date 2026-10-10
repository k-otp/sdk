import { describe, expect, test } from "bun:test";
import {
  createOtpClient,
  getTestNumberErrorCode,
  isOtpApiError,
  isTestKey,
  matchTestPhoneNumber,
  type OtpApiError,
  type OtpTestScenario,
  TEST_NUMBER_ERROR_CODES,
  TEST_OTP_CODE,
  TEST_PHONE_NUMBERS,
  TEST_SCENARIOS,
} from "../src/core";
import { createOtpServerClient } from "../src/server";
import {
  createMockTransport,
  TEST_MODE_SIMULATED_BALANCE,
  TEST_MODE_TIMINGS,
} from "../src/testing";

const START = Date.parse("2026-10-11T00:00:00.000Z");

const rejection = async (promise: Promise<unknown>): Promise<OtpApiError> => {
  try {
    await promise;
  } catch (error) {
    if (isOtpApiError(error)) return error;
    throw error;
  }
  throw new Error("expected the promise to reject");
};

/** A mock on a fixed clock plus both clients (public test key and secret test key). */
const setup = () => {
  const mock = createMockTransport({ now: () => START });
  const client = createOtpClient({
    apiKey: "pk_test_unit",
    fetch: mock.fetch,
  });
  const server = createOtpServerClient({
    apiKey: "sk_test_unit",
    fetch: mock.fetch,
  });
  let key = 0;
  const issue = (
    scenario: OtpTestScenario,
    extra: Record<string, unknown> = {},
  ) =>
    server.issue({
      phoneNumber: TEST_PHONE_NUMBERS[scenario],
      purpose: "login",
      idempotencyKey: `key-${++key}`,
      ...extra,
    });
  return { mock, client, server, issue };
};

describe("test-mode constants", () => {
  test("isTestKey recognizes pk_test_/sk_test_ only", () => {
    expect(isTestKey("pk_test_abc")).toBe(true);
    expect(isTestKey(" sk_test_abc ")).toBe(true);
    expect(isTestKey("pk_live")).toBe(false);
    expect(isTestKey("sk_testing")).toBe(false);
    expect(isTestKey("")).toBe(false);
  });

  test("TEST_PHONE_NUMBERS follows the two-digit scenario suffix", () => {
    expect(TEST_OTP_CODE).toBe("000000");
    expect(TEST_SCENARIOS).toHaveLength(11);
    TEST_SCENARIOS.forEach((scenario, index) => {
      const number = TEST_PHONE_NUMBERS[scenario];
      expect(number).toBe(`010-0000-00${String(index).padStart(2, "0")}`);
      expect(matchTestPhoneNumber(number)?.scenario).toBe(scenario);
    });
  });

  test("matchTestPhoneNumber reads every documented range and spelling", () => {
    expect(matchTestPhoneNumber("+82 10-0000-0001")).toEqual({
      region: "KR",
      canonical: "01000000001",
      suffix: "01",
      scenario: "delivery_failed",
    });
    expect(matchTestPhoneNumber("0082 10 0000 0004")?.scenario).toBe("expired");
    expect(matchTestPhoneNumber("+44 7700 900005")).toMatchObject({
      region: "GB",
      scenario: "mismatch",
    });
    expect(matchTestPhoneNumber("+1 415-555-0109")).toMatchObject({
      region: "US",
      scenario: "service_unavailable",
    });
    // Reserved suffixes behave like `00`.
    expect(matchTestPhoneNumber("010-0000-0042")?.scenario).toBe("success");
    // Real numbers and look-alikes are not test numbers.
    expect(matchTestPhoneNumber("010-1234-5678")).toBeUndefined();
    expect(matchTestPhoneNumber("010-0000-0100")).toBeUndefined();
    expect(matchTestPhoneNumber("+1 415-555-2671")).toBeUndefined();
    expect(matchTestPhoneNumber("+1 015-555-0100")).toBeUndefined();
  });

  test("getTestNumberErrorCode reads data.code of a 400 only", () => {
    for (const code of TEST_NUMBER_ERROR_CODES) {
      expect(getTestNumberErrorCode({ status: 400, data: { code } })).toBe(
        code,
      );
    }
    expect(
      getTestNumberErrorCode({ status: 400, data: { code: "OTHER" } }),
    ).toBeUndefined();
    expect(
      getTestNumberErrorCode({
        status: 402,
        data: { code: "TEST_NUMBER_REQUIRED" },
      }),
    ).toBeUndefined();
    expect(getTestNumberErrorCode(new Error("x"))).toBeUndefined();
    expect(getTestNumberErrorCode(undefined)).toBeUndefined();
  });
});

describe("createMockTransport", () => {
  test("success: issue, delivery timeline and verification with 000000", async () => {
    const { mock, client, server } = setup();
    const issued = await client.issue({
      phoneNumber: TEST_PHONE_NUMBERS.success,
      purpose: "login",
      idempotencyKey: "k1",
    });
    expect(issued).toMatchObject({
      attemptsRemaining: 5,
      queuedAt: new Date(START).toISOString(),
      expiresAt: new Date(START + 180_000).toISOString(),
      mode: "test",
    });

    const statusAt = async () =>
      (await server.getStatus({ issueId: issued.issueId })).deliveryStatus;
    expect(await statusAt()).toBe("queued");
    mock.advance(TEST_MODE_TIMINGS.sentAfterMs);
    expect(await statusAt()).toBe("sent");
    mock.advance(
      TEST_MODE_TIMINGS.deliveredAfterMs - TEST_MODE_TIMINGS.sentAfterMs,
    );
    const delivered = await server.getStatus({ issueId: issued.issueId });
    expect(delivered).toMatchObject({
      deliveryStatus: "delivered",
      overallStatus: "delivered",
      verificationStatus: "issued",
      mode: "test",
    });

    const wrong = await client.verify({
      issueId: issued.issueId,
      code: "123456",
    });
    expect(wrong).toMatchObject({
      verified: false,
      reasonCode: "MISMATCH",
      attemptsRemaining: 4,
    });
    const ok = await client.verify({
      issueId: issued.issueId,
      code: TEST_OTP_CODE,
    });
    expect(ok).toMatchObject({
      verified: true,
      attemptsRemaining: 4,
      mode: "test",
    });
    const again = await client.verify({
      issueId: issued.issueId,
      code: TEST_OTP_CODE,
    });
    expect(again.reasonCode).toBe("ALREADY_VERIFIED");
    expect(
      (await server.getStatus({ issueId: issued.issueId })).overallStatus,
    ).toBe("verified");
  });

  test("delivery_failed, slow_delivery, ambiguous and alimtalk_failover timelines", async () => {
    const { mock, server, issue } = setup();
    const failed = await issue("delivery_failed");
    const slow = await issue("slow_delivery", { purpose: "slow" });
    const ambiguous = await issue("ambiguous", { purpose: "ambiguous" });
    const failover = await issue("alimtalk_failover", { purpose: "failover" });
    const noFallback = await issue("alimtalk_failover", {
      purpose: "no-fallback",
      smsFallback: false,
    });
    const status = (issueId: string) => server.getStatus({ issueId });

    mock.advance(TEST_MODE_TIMINGS.failedAfterMs);
    expect(await status(failed.issueId)).toMatchObject({
      deliveryStatus: "failed",
      overallStatus: "delivery_failed",
    });
    expect((await status(slow.issueId)).deliveryStatus).toBe("sent");
    expect(await status(ambiguous.issueId)).toMatchObject({
      deliveryStatus: "sent",
      providerOutcomeAmbiguous: true,
      providerOutcomeCode: "TEST_PROVIDER_OUTCOME_UNKNOWN",
    });
    expect((await status(failover.issueId)).deliveryStatus).toBe("sent");
    expect((await status(noFallback.issueId)).deliveryStatus).toBe("failed");

    mock.advance(TEST_MODE_TIMINGS.failoverDeliveredAfterMs);
    expect((await status(failover.issueId)).deliveryStatus).toBe("delivered");
    mock.advance(TEST_MODE_TIMINGS.slowDeliveredAfterMs);
    expect((await status(slow.issueId)).deliveryStatus).toBe("delivered");
    expect((await status(ambiguous.issueId)).deliveryStatus).toBe("sent");

    // Delivery and verification are independent.
    const verified = await server.verify({
      issueId: failed.issueId,
      code: TEST_OTP_CODE,
    });
    expect(verified.verified).toBe(true);
  });

  test("expired: 10 second lifetime, then EXPIRED", async () => {
    const { mock, server, issue } = setup();
    const issued = await issue("expired", { expiresInSec: 600 });
    expect(issued.expiresAt).toBe(
      new Date(START + TEST_MODE_TIMINGS.expiredScenarioTtlMs).toISOString(),
    );
    mock.advance(TEST_MODE_TIMINGS.expiredScenarioTtlMs);
    const result = await server.verify({
      issueId: issued.issueId,
      code: TEST_OTP_CODE,
    });
    expect(result).toMatchObject({ verified: false, reasonCode: "EXPIRED" });
    expect(
      (await server.getStatus({ issueId: issued.issueId })).overallStatus,
    ).toBe("expired");
  });

  test("mismatch: every code is MISMATCH, the last attempt MAX_ATTEMPTS", async () => {
    const { server, issue } = setup();
    const issued = await issue("mismatch", { maxAttempts: 2 });
    const first = await server.verify({
      issueId: issued.issueId,
      code: TEST_OTP_CODE,
    });
    expect(first).toMatchObject({
      reasonCode: "MISMATCH",
      attemptsRemaining: 1,
    });
    const second = await server.verify({
      issueId: issued.issueId,
      code: TEST_OTP_CODE,
    });
    expect(second).toMatchObject({
      reasonCode: "MAX_ATTEMPTS",
      attemptsRemaining: 0,
    });
    const third = await server.verify({
      issueId: issued.issueId,
      code: TEST_OTP_CODE,
    });
    expect(third.reasonCode).toBe("MAX_ATTEMPTS");
  });

  test("rejecting scenarios answer like the live errors", async () => {
    const { mock, issue } = setup();
    const limited = await rejection(issue("rate_limited"));
    expect(limited).toMatchObject({
      code: "TOO_MANY_REQUESTS",
      status: 429,
      retryAfterMs: 60_000,
      data: { limit: "perPhone", policy: "platform", retryAfterMs: 60_000 },
    });
    const credit = await rejection(issue("insufficient_credit"));
    expect(credit).toMatchObject({
      code: "PAYMENT_REQUIRED",
      data: { code: "INSUFFICIENT_CREDIT" },
    });
    const trial = await rejection(issue("trial_daily_limit"));
    expect(trial).toMatchObject({
      code: "PAYMENT_REQUIRED",
      data: {
        code: "TRIAL_DAILY_LIMIT_EXCEEDED",
        // 2026-10-11T00:00Z is 09:00 KST: the next KST midnight is 15:00Z.
        resetAt: "2026-10-11T15:00:00.000Z",
      },
    });
    const unavailable = await rejection(issue("service_unavailable"));
    expect(unavailable).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      retryAfterMs: 2_000,
    });
    expect(unavailable.retryable).toBe(true);
    // Nothing was created.
    expect(mock.issues()).toHaveLength(0);
  });

  test("test keys require test numbers; live keys reject them", async () => {
    const { client } = setup();
    const real = await rejection(
      client.issue({
        phoneNumber: "010-1234-5678",
        purpose: "login",
        idempotencyKey: "k1",
      }),
    );
    expect(real.code).toBe("BAD_REQUEST");
    expect(real.message.startsWith("TEST_NUMBER_REQUIRED:")).toBe(true);
    expect(getTestNumberErrorCode(real)).toBe("TEST_NUMBER_REQUIRED");

    const mock = createMockTransport();
    const live = createOtpClient({ apiKey: "pk_live_unit", fetch: mock.fetch });
    const inLive = await rejection(
      live.issue({
        phoneNumber: TEST_PHONE_NUMBERS.success,
        purpose: "login",
        idempotencyKey: "k1",
      }),
    );
    expect(getTestNumberErrorCode(inLive)).toBe("TEST_NUMBER_IN_LIVE_MODE");
    const notSimulated = await rejection(
      live.issue({
        phoneNumber: "010-1234-5678",
        purpose: "login",
        idempotencyKey: "k2",
      }),
    );
    expect(notSimulated.code).toBe("UNAUTHORIZED");
  });

  test("idempotency replay, conflict and replacement", async () => {
    const { server, mock } = setup();
    const input = {
      phoneNumber: TEST_PHONE_NUMBERS.success,
      purpose: "login",
      idempotencyKey: "same",
    };
    const first = await server.issue(input);
    const replay = await server.issue({
      ...input,
      phoneNumber: "+82 10 0000 0000",
    });
    expect(replay).toEqual(first);
    const conflict = await rejection(
      server.issue({ ...input, purpose: "other" }),
    );
    expect(conflict.code).toBe("CONFLICT");

    const second = await server.issue({ ...input, idempotencyKey: "next" });
    expect(second.issueId).not.toBe(first.issueId);
    const old = await server.verify({
      issueId: first.issueId,
      code: TEST_OTP_CODE,
    });
    expect(old.reasonCode).toBe("REPLACED");
    expect(mock.issues().map((issue) => issue.verificationStatus)).toEqual([
      "issued",
      "replaced",
    ]);
  });

  test("pk_test_ keys may only issue and verify", async () => {
    const { mock } = setup();
    const response = await mock.fetch("https://api.k-otp.dev/v1/balance", {
      headers: { authorization: "Bearer pk_test_unit" },
    });
    expect(response.status).toBe(403);
  });

  test("dashboard reads: issues, issue detail, balance, ledger, templates", async () => {
    const { server, issue } = setup();
    const a = await issue("success");
    const b = await issue("delivery_failed", { purpose: "b" });
    const c = await issue("slow_delivery", { purpose: "c" });

    const page1 = await server.listIssues({ limit: 2 });
    expect(page1.items.map((item) => item.issueId)).toEqual([
      c.issueId,
      b.issueId,
    ]);
    expect(page1.items[0]).toMatchObject({
      billingStatus: "released",
      debitedAmount: 0,
      mode: "test",
    });
    expect(page1.nextCursor).toBeString();
    const page2 = await server.listIssues({
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items.map((item) => item.issueId)).toEqual([a.issueId]);
    expect(page2.nextCursor).toBeUndefined();

    expect((await server.getIssue({ issueId: b.issueId })).purpose).toBe("b");
    const missing = await rejection(server.getIssue({ issueId: "nope" }));
    expect(missing.code).toBe("NOT_FOUND");

    expect(await server.getBalance()).toMatchObject({
      walletId: "test:app_mock",
      walletScope: "test",
      balance: TEST_MODE_SIMULATED_BALANCE,
      promoBalance: 0,
      promoNextExpiry: null,
      mode: "test",
    });
    expect(await server.listCreditLedger()).toEqual({ items: [] });
    const templates = await server.listTemplates();
    expect(
      (await server.getTemplate({ templateId: templates.defaultTemplateId }))
        .templateId,
    ).toBe(templates.defaultTemplateId);
  });

  test("issues() shows the inbox view and reset() forgets everything", async () => {
    const { mock, issue } = setup();
    await issue("mismatch");
    expect(mock.issues()).toEqual([
      expect.objectContaining({
        scenario: "mismatch",
        region: "KR",
        testNumber: "01000000005",
        code: null,
        deliveryStatus: "queued",
      }),
    ]);
    mock.reset();
    expect(mock.issues()).toEqual([]);
  });
});
