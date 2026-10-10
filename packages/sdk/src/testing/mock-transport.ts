/**
 * In-memory simulator of the K-OTP test mode for unit tests: a `fetch`
 * implementation that answers the public `/v1` REST operations the way the
 * API answers a `pk_test_`/`sk_test_` key, from the same scenario table and
 * timeline. No network, no API key needed beyond its prefix, no daily test
 * budget used.
 */
import {
  matchTestPhoneNumber,
  type OtpApiMode,
  type OtpTestPhoneRegion,
  type OtpTestScenario,
  TEST_OTP_CODE,
} from "../core/test-mode";
import type {
  GetBalanceResult,
  GetStatusResult,
  IssueResult,
  OtpChannel,
  OtpDeliveryStatus,
  OtpIssue,
  OtpOverallStatus,
  OtpVerificationStatus,
  VerifyReasonCode,
  VerifyResult,
} from "../core/types";

/**
 * Scenario timeline of test mode, in milliseconds after the issue (the same
 * values the API simulator uses).
 */
export const TEST_MODE_TIMINGS: {
  /** `queued` -> `sent` for every delivering scenario. */
  readonly sentAfterMs: 1000;
  /** `success`, `expired`, `mismatch`: `sent` -> `delivered`. */
  readonly deliveredAfterMs: 2000;
  /** `delivery_failed`: `sent` -> `failed`. */
  readonly failedAfterMs: 3000;
  /** `slow_delivery`: `queued`/`sent` until then, then `delivered`. */
  readonly slowDeliveredAfterMs: 30000;
  /** `alimtalk_failover`: the SMS fallback is `delivered` at this time. */
  readonly failoverDeliveredAfterMs: 4000;
  /** `expired`: the issue expires this long after it was issued. */
  readonly expiredScenarioTtlMs: 10000;
  /** `rate_limited`: the wait of the simulated `perPhone` 429. */
  readonly rateLimitedRetryAfterMs: 60000;
  /** `service_unavailable`: `Retry-After` (seconds) of the simulated 503. */
  readonly serviceUnavailableRetryAfterSec: 2;
} = {
  sentAfterMs: 1000,
  deliveredAfterMs: 2000,
  failedAfterMs: 3000,
  slowDeliveredAfterMs: 30000,
  failoverDeliveredAfterMs: 4000,
  expiredScenarioTtlMs: 10000,
  rateLimitedRetryAfterMs: 60000,
  serviceUnavailableRetryAfterSec: 2,
};

/** The fixed `GET /v1/balance` balance of a test key; it never decreases. */
export const TEST_MODE_SIMULATED_BALANCE = 1_000_000;

/** Provider result code of the `ambiguous` scenario. */
export const TEST_MODE_AMBIGUOUS_OUTCOME_CODE = "TEST_PROVIDER_OUTCOME_UNKNOWN";

/** Retention of a test issue on the API (7 days). */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type MockTransportOptions = {
  /**
   * Clock of the simulation in epoch milliseconds. Default: `Date.now`. Use
   * {@link MockTransport.advance} (or your own clock) to walk the delivery
   * timeline and expiry without waiting.
   */
  now?: () => number;
  /** `appId` (and `walletId: "test:<appId>"`) of balance results. Default `"app_mock"`. */
  appId?: string;
  /** `organizationId` of balance results. Omitted by default. */
  organizationId?: string;
};

/** A simulated issue, as the console test inbox shows it. */
export type MockTestIssue = {
  issueId: string;
  scenario: OtpTestScenario;
  region: OtpTestPhoneRegion;
  /** Canonical digits of the test number. */
  testNumber: string;
  purpose: string;
  channel: OtpChannel;
  templateId: string;
  /** The code that verifies this issue, or `null` for `mismatch`. */
  code: string | null;
  deliveryStatus: OtpDeliveryStatus;
  verificationStatus: OtpVerificationStatus;
  attemptsUsed: number;
  maxAttempts: number;
  issuedAt: string;
  expiresAt: string;
  verifiedAt?: string;
};

export type MockTransport = {
  /**
   * Pass it as the `fetch` option of `createOtpClient`,
   * `createOtpServerClient` or a framework provider.
   */
  fetch: typeof fetch;
  /** Moves the simulation clock forward by `ms`. */
  advance: (ms: number) => void;
  /** Every simulated issue, newest first (expired retention excluded). */
  issues: () => MockTestIssue[];
  /** Forgets every issue and idempotency key and rewinds {@link advance}. */
  reset: () => void;
};

type StoredIssue = {
  issueId: string;
  messageId: string;
  scenario: OtpTestScenario;
  region: OtpTestPhoneRegion;
  testNumber: string;
  purpose: string;
  channel: OtpChannel;
  smsFallback: boolean;
  templateId: string;
  webOtp: IssueResult["webOtp"];
  issuedAtMs: number;
  expiresAtMs: number;
  attemptsUsed: number;
  maxAttempts: number;
  verificationStatus: OtpVerificationStatus;
  verifiedAtMs: number | null;
  updatedAtMs: number;
};

type Json = Record<string, unknown>;

const MODE: OtpApiMode = "test";
const DEFAULT_TEMPLATE_ID = "default";
const DEFAULT_TEMPLATE = {
  templateId: DEFAULT_TEMPLATE_ID,
  name: "Default (mock)",
  channelSupport: ["alimtalk", "sms"] as OtpChannel[],
  body: "Your verification code is #{code}.",
};

const iso = (ms: number): string => new Date(ms).toISOString();

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

class MockHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly data?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

const reply = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": "mock-request",
      ...headers,
    },
  });

const fail = (
  status: number,
  code: string,
  message: string,
  data?: unknown,
  headers?: Record<string, string>,
): never => {
  throw new MockHttpError(status, code, message, data, headers);
};

const badRequest = (message: string, data?: unknown): never =>
  fail(400, "BAD_REQUEST", message, data);

/** Whole-number field in `[min, max]`, or the default when omitted. */
const integerField = (
  body: Json,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number => {
  const value = body[name];
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return badRequest(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
};

/** Stable JSON (sorted keys) for the idempotency fingerprint. */
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const deliveryFinalAfterMs = (issue: StoredIssue): number => {
  switch (issue.scenario) {
    case "delivery_failed":
      return TEST_MODE_TIMINGS.failedAfterMs;
    case "slow_delivery":
      return TEST_MODE_TIMINGS.slowDeliveredAfterMs;
    case "ambiguous":
      return TEST_MODE_TIMINGS.sentAfterMs;
    case "alimtalk_failover":
      if (issue.channel === "alimtalk") {
        return issue.smsFallback
          ? TEST_MODE_TIMINGS.failoverDeliveredAfterMs
          : TEST_MODE_TIMINGS.failedAfterMs;
      }
      return TEST_MODE_TIMINGS.deliveredAfterMs;
    default:
      return TEST_MODE_TIMINGS.deliveredAfterMs;
  }
};

/** Delivery status `elapsedMs` after the issue (computed, never stored). */
const deliveryStatus = (
  issue: StoredIssue,
  elapsedMs: number,
): "queued" | "sent" | "delivered" | "failed" => {
  if (elapsedMs < TEST_MODE_TIMINGS.sentAfterMs) return "queued";
  if (issue.scenario === "ambiguous") return "sent";
  if (elapsedMs < deliveryFinalAfterMs(issue)) return "sent";
  const fails =
    issue.scenario === "delivery_failed" ||
    (issue.scenario === "alimtalk_failover" &&
      issue.channel === "alimtalk" &&
      !issue.smsFallback);
  return fails ? "failed" : "delivered";
};

const effectiveStatus = (
  issue: StoredIssue,
  nowMs: number,
): OtpVerificationStatus =>
  issue.verificationStatus === "issued" && nowMs >= issue.expiresAtMs
    ? "expired"
    : issue.verificationStatus;

const overallStatus = (
  verification: OtpVerificationStatus,
  delivery: OtpDeliveryStatus,
): OtpOverallStatus => {
  if (verification !== "issued") return verification;
  if (delivery === "delivered") return "delivered";
  if (delivery === "failed") return "delivery_failed";
  return "in_progress";
};

const updatedAtMs = (issue: StoredIssue, nowMs: number): number => {
  const elapsed = Math.max(0, nowMs - issue.issuedAtMs);
  const deliveryChangedAt =
    issue.issuedAtMs + Math.min(elapsed, deliveryFinalAfterMs(issue));
  const expiredAt =
    issue.verificationStatus === "issued" && nowMs >= issue.expiresAtMs
      ? issue.expiresAtMs
      : 0;
  return Math.max(issue.updatedAtMs, deliveryChangedAt, expiredAt);
};

const remaining = (issue: StoredIssue): number =>
  Math.max(0, issue.maxAttempts - issue.attemptsUsed);

const issueOutput = (issue: StoredIssue): IssueResult => ({
  issueId: issue.issueId,
  expiresAt: iso(issue.expiresAtMs),
  attemptsRemaining: remaining(issue),
  queuedAt: iso(issue.issuedAtMs),
  ...(issue.webOtp === undefined ? {} : { webOtp: issue.webOtp }),
  mode: MODE,
});

const statusOutput = (issue: StoredIssue, nowMs: number): GetStatusResult => {
  const delivery = deliveryStatus(issue, nowMs - issue.issuedAtMs);
  const verification = effectiveStatus(issue, nowMs);
  return {
    issueId: issue.issueId,
    messageId: issue.messageId,
    purpose: issue.purpose,
    templateId: issue.templateId,
    verificationStatus: verification,
    deliveryStatus: delivery,
    overallStatus: overallStatus(verification, delivery),
    ...(issue.scenario === "ambiguous" && delivery === "sent"
      ? {
          providerOutcomeAmbiguous: true,
          providerOutcomeCode: TEST_MODE_AMBIGUOUS_OUTCOME_CODE,
        }
      : {}),
    expiresAt: iso(issue.expiresAtMs),
    ...(issue.verifiedAtMs === null
      ? {}
      : { verifiedAt: iso(issue.verifiedAtMs) }),
    attemptsUsed: issue.attemptsUsed,
    maxAttempts: issue.maxAttempts,
    attemptsRemaining: remaining(issue),
    createdAt: iso(issue.issuedAtMs),
    updatedAt: iso(updatedAtMs(issue, nowMs)),
    mode: MODE,
  };
};

const dashboardOutput = (issue: StoredIssue, nowMs: number): OtpIssue => {
  const status = statusOutput(issue, nowMs);
  return {
    issueId: issue.issueId,
    purpose: issue.purpose,
    templateId: issue.templateId,
    channel: issue.channel,
    verificationStatus: status.verificationStatus,
    deliveryStatus: status.deliveryStatus,
    overallStatus: status.overallStatus,
    billingStatus: "released",
    debitedAmount: 0,
    currency: "CREDIT",
    expiresAt: status.expiresAt,
    ...(status.verifiedAt === undefined
      ? {}
      : { verifiedAt: status.verifiedAt }),
    attemptsUsed: status.attemptsUsed,
    maxAttempts: status.maxAttempts,
    attemptsRemaining: status.attemptsRemaining,
    createdAt: status.createdAt,
    updatedAt: status.updatedAt,
    mode: MODE,
  };
};

const verifyFailure = (
  issue: StoredIssue,
  reasonCode: VerifyReasonCode,
): VerifyResult => ({
  issueId: issue.issueId,
  verified: false,
  reasonCode,
  attemptsRemaining: remaining(issue),
  expiresAt: iso(issue.expiresAtMs),
  ...(issue.verifiedAtMs === null
    ? {}
    : { verifiedAt: iso(issue.verifiedAtMs) }),
  mode: MODE,
});

/** Next KST (UTC+9) midnight, as the trial limit's `resetAt`. */
const nextKstMidnight = (nowMs: number): string => {
  const day = 24 * 60 * 60 * 1000;
  const offset = 9 * 60 * 60 * 1000;
  return iso(Math.floor((nowMs + offset) / day + 1) * day - offset);
};

const webOtpResult = (
  requested: unknown,
  channel: OtpChannel,
  smsFallback: boolean,
): IssueResult["webOtp"] => {
  if (requested === undefined || requested === false) return undefined;
  if (requested !== true && !isRecord(requested)) {
    return badRequest("webOtp must be a boolean or { origin }");
  }
  if (channel === "sms") return { status: "applied" };
  return smsFallback
    ? { status: "fallback_only" }
    : { status: "skipped", reason: "channel_alimtalk" };
};

/**
 * Creates an in-memory simulator of the K-OTP test mode, for unit and
 * component tests that must not reach the network:
 *
 * ```ts
 * import { createOtpClient, TEST_OTP_CODE, TEST_PHONE_NUMBERS } from "@k-otp/sdk";
 * import { createMockTransport } from "@k-otp/sdk/testing";
 *
 * const mock = createMockTransport();
 * const client = createOtpClient({ apiKey: "pk_test_mock", fetch: mock.fetch });
 * const { issueId } = await client.issue({
 *   phoneNumber: TEST_PHONE_NUMBERS.success,
 *   purpose: "login",
 *   idempotencyKey: "test-1",
 * });
 * await client.verify({ issueId, code: TEST_OTP_CODE }); // verified: true
 * ```
 *
 * It follows the API's test mode: only test phone numbers are accepted (400
 * `TEST_NUMBER_REQUIRED` otherwise), the last two digits pick the scenario
 * (`TEST_PHONE_NUMBERS`), every created issue verifies with `000000` (except
 * `mismatch`), delivery follows {@link TEST_MODE_TIMINGS} on the mock clock,
 * idempotency keys replay (409 for a different payload), a new issue for the
 * same number and purpose replaces the previous one, `pk_test_` keys may only
 * issue and verify, and the balance is fixed. A live key gets 400
 * `TEST_NUMBER_IN_LIVE_MODE` for a test number and 401 otherwise: live
 * delivery is never simulated.
 *
 * Not simulated: `Origin` checks, rate limits and daily test budgets (the
 * `rate_limited` scenario still answers 429), template variables (any
 * `templateId` is accepted) and request ids.
 */
export const createMockTransport = (
  options: MockTransportOptions = {},
): MockTransport => {
  const clock = options.now ?? Date.now;
  const appId = options.appId ?? "app_mock";
  let offsetMs = 0;
  let sequence = 0;
  /** By issue id, in creation order. */
  const issues = new Map<string, StoredIssue>();
  /** Idempotency key -> issue id + payload fingerprint. */
  const claims = new Map<string, { issueId: string; fingerprint: string }>();
  /** `number\0purpose` -> active issue id. */
  const active = new Map<string, string>();

  const now = (): number => clock() + offsetMs;

  /** Time-ordered, UUIDv7-shaped ids (deterministic for a fixed clock). */
  const nextId = (nowMs: number): string => {
    sequence += 1;
    const time = Math.max(0, Math.trunc(nowMs))
      .toString(16)
      .padStart(12, "0")
      .slice(-12);
    const seq = sequence.toString(16).padStart(12, "0").slice(-12);
    return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${seq}`;
  };

  const findIssue = (
    issueId: unknown,
    nowMs: number,
  ): StoredIssue | undefined => {
    const issue =
      typeof issueId === "string" ? issues.get(issueId.trim()) : undefined;
    return issue && nowMs - issue.issuedAtMs <= RETENTION_MS
      ? issue
      : undefined;
  };

  const requireIssue = (issueId: unknown, nowMs: number): StoredIssue =>
    findIssue(issueId, nowMs) ??
    fail(404, "NOT_FOUND", `Issue not found: ${String(issueId)}`);

  const handleIssue = (
    request: Request,
    body: Json,
    live: boolean,
  ): Response => {
    const phoneNumber =
      typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
    if (!/\d/.test(phoneNumber) || phoneNumber.length > 32) {
      return badRequest(
        "phoneNumber must be at most 32 characters with at least one digit",
      );
    }
    const purpose = typeof body.purpose === "string" ? body.purpose.trim() : "";
    if (purpose.length < 1 || purpose.length > 64) {
      return badRequest("purpose must be 1-64 characters");
    }
    const headerKey = request.headers.get("idempotency-key")?.trim();
    const bodyKey =
      typeof body.idempotencyKey === "string"
        ? body.idempotencyKey.trim()
        : undefined;
    const idempotencyKey = headerKey || bodyKey;
    if (!idempotencyKey || !/^[\x21-\x7e]{1,128}$/.test(idempotencyKey)) {
      return badRequest(
        "Idempotency-Key header or idempotencyKey (1-128 visible ASCII characters) is required",
      );
    }
    if (headerKey && bodyKey && headerKey !== bodyKey) {
      return badRequest(
        "Idempotency-Key header and body idempotencyKey differ",
      );
    }
    if (
      body.channel !== undefined &&
      body.channel !== "alimtalk" &&
      body.channel !== "sms"
    ) {
      return badRequest("channel must be alimtalk or sms");
    }
    const channel: OtpChannel = body.channel === "sms" ? "sms" : "alimtalk";
    const smsFallback = body.smsFallback !== false;
    const expiresInSec = integerField(body, "expiresInSec", 30, 600, 180);
    const maxAttempts = integerField(body, "maxAttempts", 1, 10, 5);
    const webOtp = webOtpResult(body.webOtp, channel, smsFallback);

    const match = matchTestPhoneNumber(phoneNumber);
    if (live) {
      if (match) {
        return badRequest(
          "TEST_NUMBER_IN_LIVE_MODE: this is a test phone number; use a test-mode key (pk_test_/sk_test_) to issue to it",
          { code: "TEST_NUMBER_IN_LIVE_MODE" },
        );
      }
      return fail(
        401,
        "UNAUTHORIZED",
        "createMockTransport() only simulates test mode: use a pk_test_/sk_test_ key",
      );
    }
    if (!match) {
      return badRequest(
        "TEST_NUMBER_REQUIRED: test-mode keys (pk_test_/sk_test_) only accept test phone numbers (010-0000-00xx, +44 7700 9000xx, +1 NXX 555-01xx); no message is ever sent in test mode",
        { code: "TEST_NUMBER_REQUIRED" },
      );
    }

    const nowMs = now();
    switch (match.scenario) {
      case "rate_limited":
        return fail(
          429,
          "TOO_MANY_REQUESTS",
          "Rate limit exceeded (perPhone)",
          {
            limit: "perPhone",
            policy: "platform",
            retryAfterMs: TEST_MODE_TIMINGS.rateLimitedRetryAfterMs,
          },
          {
            "retry-after": String(
              Math.ceil(TEST_MODE_TIMINGS.rateLimitedRetryAfterMs / 1000),
            ),
          },
        );
      case "insufficient_credit":
        return fail(402, "PAYMENT_REQUIRED", "INSUFFICIENT_CREDIT", {
          code: "INSUFFICIENT_CREDIT",
        });
      case "trial_daily_limit":
        return fail(402, "PAYMENT_REQUIRED", "TRIAL_DAILY_LIMIT_EXCEEDED", {
          code: "TRIAL_DAILY_LIMIT_EXCEEDED",
          resetAt: nextKstMidnight(nowMs),
        });
      case "service_unavailable":
        return fail(
          503,
          "SERVICE_UNAVAILABLE",
          "TEST_SCENARIO_SERVICE_UNAVAILABLE",
          undefined,
          {
            "retry-after": String(
              TEST_MODE_TIMINGS.serviceUnavailableRetryAfterSec,
            ),
          },
        );
      default:
        break;
    }

    const templateId =
      typeof body.templateId === "string" && body.templateId.trim()
        ? body.templateId.trim()
        : DEFAULT_TEMPLATE_ID;
    const { idempotencyKey: _key, ...payload } = body;
    const fingerprint = stable({
      ...payload,
      phoneNumber: match.canonical,
      purpose,
      // Like the API: only an explicit `false` on AlimTalk is fingerprinted.
      smsFallback: channel === "alimtalk" && !smsFallback ? false : undefined,
    });
    const claim = claims.get(idempotencyKey);
    if (claim) {
      const claimed = issues.get(claim.issueId);
      if (claim.fingerprint !== fingerprint || !claimed) {
        return fail(
          409,
          "CONFLICT",
          "idempotencyKey already exists with a different issue payload",
        );
      }
      return reply(200, issueOutput(claimed));
    }

    const activeKey = `${match.canonical}\u0000${purpose}`;
    const previous = issues.get(active.get(activeKey) ?? "");
    if (previous && effectiveStatus(previous, nowMs) === "issued") {
      previous.verificationStatus = "replaced";
      previous.updatedAtMs = nowMs;
    }
    const issue: StoredIssue = {
      issueId: nextId(nowMs),
      messageId: nextId(nowMs),
      scenario: match.scenario,
      region: match.region,
      testNumber: match.canonical,
      purpose,
      channel,
      smsFallback,
      templateId,
      webOtp,
      issuedAtMs: nowMs,
      expiresAtMs:
        nowMs +
        (match.scenario === "expired"
          ? TEST_MODE_TIMINGS.expiredScenarioTtlMs
          : expiresInSec * 1000),
      attemptsUsed: 0,
      maxAttempts,
      verificationStatus: "issued",
      verifiedAtMs: null,
      updatedAtMs: nowMs,
    };
    issues.set(issue.issueId, issue);
    claims.set(idempotencyKey, { issueId: issue.issueId, fingerprint });
    active.set(activeKey, issue.issueId);
    return reply(200, issueOutput(issue));
  };

  const handleVerify = (body: Json): Response => {
    const issueId = typeof body.issueId === "string" ? body.issueId.trim() : "";
    if (!issueId) return badRequest("issueId is required");
    const code = body.code;
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return badRequest("code must be a 6-digit numeric string");
    }
    const nowMs = now();
    const issue = findIssue(issueId, nowMs);
    if (!issue) {
      return reply(200, {
        issueId,
        verified: false,
        reasonCode: "NOT_FOUND",
        attemptsRemaining: 0,
        expiresAt: iso(nowMs),
        mode: MODE,
      } satisfies VerifyResult);
    }
    const status = effectiveStatus(issue, nowMs);
    if (status !== issue.verificationStatus) {
      issue.verificationStatus = status;
      issue.updatedAtMs = Math.max(issue.updatedAtMs, issue.expiresAtMs);
    }
    switch (status) {
      case "replaced":
        return reply(200, verifyFailure(issue, "REPLACED"));
      case "verified":
        return reply(200, verifyFailure(issue, "ALREADY_VERIFIED"));
      case "max_attempts":
        return reply(200, verifyFailure(issue, "MAX_ATTEMPTS"));
      case "expired":
        return reply(200, verifyFailure(issue, "EXPIRED"));
      default:
        break;
    }
    if (issue.scenario !== "mismatch" && code === TEST_OTP_CODE) {
      issue.verificationStatus = "verified";
      issue.verifiedAtMs = nowMs;
      issue.updatedAtMs = nowMs;
      return reply(200, {
        issueId: issue.issueId,
        verified: true,
        attemptsRemaining: remaining(issue),
        expiresAt: iso(issue.expiresAtMs),
        verifiedAt: iso(nowMs),
        mode: MODE,
      } satisfies VerifyResult);
    }
    issue.attemptsUsed += 1;
    issue.updatedAtMs = nowMs;
    const reachedMax = issue.attemptsUsed >= issue.maxAttempts;
    if (reachedMax) issue.verificationStatus = "max_attempts";
    return reply(
      200,
      verifyFailure(issue, reachedMax ? "MAX_ATTEMPTS" : "MISMATCH"),
    );
  };

  const handleListIssues = (query: URLSearchParams): Response => {
    const nowMs = now();
    const limitText = query.get("limit");
    const limit = limitText === null ? 50 : Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return badRequest("limit must be an integer from 1 to 100");
    }
    const status = query.get("verificationStatus");
    const from = query.get("createdFrom");
    const to = query.get("createdTo");
    const fromMs = from === null ? undefined : Date.parse(from);
    const toMs = to === null ? undefined : Date.parse(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      return badRequest("createdFrom/createdTo must be RFC 3339 timestamps");
    }
    if (fromMs !== undefined && toMs !== undefined && fromMs >= toMs) {
      return badRequest("createdFrom must be earlier than createdTo");
    }
    const cursor = query.get("cursor");
    if (cursor !== null && !cursor.startsWith("mock:")) {
      return badRequest("Invalid dashboard cursor");
    }
    const newestFirst = [...issues.values()]
      .filter((issue) => nowMs - issue.issuedAtMs <= RETENTION_MS)
      .reverse();
    let start = 0;
    if (cursor !== null) {
      const index = newestFirst.findIndex(
        (issue) => issue.issueId === cursor.slice(5),
      );
      if (index < 0) return badRequest("Invalid dashboard cursor");
      start = index + 1;
    }
    const matching = newestFirst
      .slice(start)
      .filter(
        (issue) =>
          (status === null || effectiveStatus(issue, nowMs) === status) &&
          (fromMs === undefined || issue.issuedAtMs >= fromMs) &&
          (toMs === undefined || issue.issuedAtMs < toMs),
      );
    const page = matching.slice(0, limit);
    const last = page[page.length - 1];
    return reply(200, {
      items: page.map((issue) => dashboardOutput(issue, nowMs)),
      ...(matching.length > limit && last
        ? { nextCursor: `mock:${last.issueId}` }
        : {}),
    });
  };

  const handleBalance = (): Response => {
    const organizationId = options.organizationId?.trim();
    return reply(200, {
      appId,
      walletId: `test:${appId}`,
      walletScope: "test",
      ...(organizationId ? { organizationId } : {}),
      balance: TEST_MODE_SIMULATED_BALANCE,
      currency: "CREDIT",
      updatedAt: iso(now()),
      promoBalance: 0,
      promoNextExpiry: null,
      mode: MODE,
    } satisfies GetBalanceResult);
  };

  const route = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method.toUpperCase();
    const authorization = request.headers.get("authorization") ?? "";
    const key = /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
    if (!key) {
      return fail(401, "UNAUTHORIZED", "Missing Authorization: Bearer <key>");
    }
    const isTest = key.startsWith("pk_test_") || key.startsWith("sk_test_");
    const isPublic = key.startsWith("pk_");
    const readBody = async (): Promise<Json> => {
      const text = await request.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        return badRequest("Request body must be JSON");
      }
      return isRecord(parsed)
        ? parsed
        : badRequest("Request body must be a JSON object");
    };

    if (method === "POST" && path.endsWith("/issue")) {
      return handleIssue(request, await readBody(), !isTest);
    }
    if (!isTest) {
      return fail(
        401,
        "UNAUTHORIZED",
        "createMockTransport() only simulates test mode: use a pk_test_/sk_test_ key",
      );
    }
    if (method === "POST" && path.endsWith("/verify")) {
      return handleVerify(await readBody());
    }
    if (method !== "GET") {
      return fail(404, "NOT_FOUND", `No route for ${method} ${url.pathname}`);
    }
    const readOperation =
      /\/(status|issues|credit-ledger|balance|templates)(?:\/([^/]+))?$/.exec(
        path,
      );
    if (!readOperation) {
      return fail(404, "NOT_FOUND", `No route for ${method} ${url.pathname}`);
    }
    if (isPublic) {
      return fail(
        403,
        "FORBIDDEN",
        "pk_ public keys may only call POST /issue and POST /verify",
      );
    }
    const [, operation, param] = readOperation;
    const id = param === undefined ? undefined : decodeURIComponent(param);
    const nowMs = now();
    switch (operation) {
      case "status": {
        if (id !== undefined) break;
        const issueId = url.searchParams.get("issueId")?.trim();
        if (!issueId) return badRequest("issueId is required");
        return reply(200, statusOutput(requireIssue(issueId, nowMs), nowMs));
      }
      case "issues":
        return id === undefined
          ? handleListIssues(url.searchParams)
          : reply(200, dashboardOutput(requireIssue(id, nowMs), nowMs));
      case "credit-ledger":
        if (id !== undefined) break;
        return reply(200, { items: [] });
      case "balance":
        if (id !== undefined) break;
        return handleBalance();
      case "templates":
        if (id === undefined) {
          return reply(200, {
            defaultTemplateId: DEFAULT_TEMPLATE_ID,
            templates: [
              {
                ...DEFAULT_TEMPLATE,
                isDefault: true,
                providerTemplateCode: "",
              },
            ],
            note: "Mock template list of createMockTransport()",
          });
        }
        if (id === DEFAULT_TEMPLATE_ID) {
          return reply(200, {
            ...DEFAULT_TEMPLATE,
            variables: {
              required: [],
              properties: {},
              additionalProperties: false,
            },
          });
        }
        return fail(404, "NOT_FOUND", `Template not found: ${id}`);
      default:
        break;
    }
    return fail(404, "NOT_FOUND", `No route for ${method} ${url.pathname}`);
  };

  const mockFetch = async (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    if (request.signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    try {
      return await route(request);
    } catch (error) {
      if (!(error instanceof MockHttpError)) throw error;
      return reply(
        error.status,
        {
          defined: error.data !== undefined,
          code: error.code,
          status: error.status,
          message: error.message,
          ...(error.data === undefined ? {} : { data: error.data }),
        },
        error.headers,
      );
    }
  };

  return {
    fetch: mockFetch as typeof fetch,
    advance: (ms) => {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new TypeError("advance(ms) needs a non-negative number");
      }
      offsetMs += ms;
    },
    issues: () => {
      const nowMs = now();
      return [...issues.values()]
        .filter((issue) => nowMs - issue.issuedAtMs <= RETENTION_MS)
        .reverse()
        .map((issue) => ({
          issueId: issue.issueId,
          scenario: issue.scenario,
          region: issue.region,
          testNumber: issue.testNumber,
          purpose: issue.purpose,
          channel: issue.channel,
          templateId: issue.templateId,
          code: issue.scenario === "mismatch" ? null : TEST_OTP_CODE,
          deliveryStatus: deliveryStatus(issue, nowMs - issue.issuedAtMs),
          verificationStatus: effectiveStatus(issue, nowMs),
          attemptsUsed: issue.attemptsUsed,
          maxAttempts: issue.maxAttempts,
          issuedAt: iso(issue.issuedAtMs),
          expiresAt: iso(issue.expiresAtMs),
          ...(issue.verifiedAtMs === null
            ? {}
            : { verifiedAt: iso(issue.verifiedAtMs) }),
        }));
    },
    reset: () => {
      issues.clear();
      claims.clear();
      active.clear();
      offsetMs = 0;
      sequence = 0;
    },
  };
};
