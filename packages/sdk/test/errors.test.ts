import { describe, expect, test } from "bun:test";
import {
  createOtpClient,
  getIssueRequestErrorCode,
  getOtpErrorReason,
  getTestNumberErrorCode,
  ISSUE_REQUEST_ERROR_CODES,
  isOtpApiError,
  normalizeOtpApiError,
  OtpApiError,
  type OtpApiErrorCode,
  otpErrorCodeFromStatus,
  parseRetryAfter,
} from "../src/core";
import { errorEnvelope, json, mockFetch } from "./helpers";

const verify = (response: () => Response) => {
  const { fetch } = mockFetch(response);
  const client = createOtpClient({ apiKey: "pk_test", fetch });
  return client.verify({ issueId: "a", code: "123456" }).then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => {
      if (!isOtpApiError(error)) throw error;
      return error;
    },
  );
};

describe("HTTP error envelope mapping", () => {
  test.each<[number, OtpApiErrorCode, boolean]>([
    [400, "BAD_REQUEST", false],
    [401, "UNAUTHORIZED", false],
    [402, "PAYMENT_REQUIRED", false],
    [403, "FORBIDDEN", false],
    [404, "NOT_FOUND", false],
    [409, "CONFLICT", false],
    [429, "TOO_MANY_REQUESTS", true],
    [500, "INTERNAL_SERVER_ERROR", true],
    [503, "SERVICE_UNAVAILABLE", true],
  ])("%i -> %s", async (status, code, retryable) => {
    const error = await verify(() =>
      errorEnvelope(status, code, `server says ${code}`, undefined, {
        "x-request-id": "req_abc",
      }),
    );
    expect(error).toBeInstanceOf(OtpApiError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.message).toBe(`server says ${code}`);
    expect(error.requestId).toBe("req_abc");
    expect(error.retryable).toBe(retryable);
  });

  test("prefers X-Request-Id over request-id and cf-ray", async () => {
    const error = await verify(() =>
      errorEnvelope(403, "FORBIDDEN", "no", undefined, {
        "cf-ray": "8a1b2c3d4e-ICN",
        "request-id": "other",
        "X-Request-Id": "req_preferred",
      }),
    );
    expect(error.requestId).toBe("req_preferred");
  });

  test("undefined server errors (defined: false) keep their code", async () => {
    const error = await verify(() =>
      json(500, {
        defined: false,
        code: "INTERNAL_SERVER_ERROR",
        status: 500,
        message: "Internal server error",
      }),
    );
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  test("unknown envelope codes fall back to the HTTP status", async () => {
    const error = await verify(() =>
      json(409, {
        defined: true,
        code: "SOMETHING_NEW",
        status: 409,
        message: "x",
      }),
    );
    expect(error.code).toBe("CONFLICT");
  });

  test("non-JSON gateway errors map by status", async () => {
    const error = await verify(
      () =>
        new Response("<html>Bad gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html", "cf-ray": "8a1b2c3d4e-ICN" },
        }),
    );
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(error.status).toBe(502);
    expect(error.requestId).toBe("8a1b2c3d4e-ICN");
    // The HTML page is never surfaced as the message or the data.
    expect(error.message).toBe("K-OTP API request failed with HTTP 502");
    expect(error.data).toBeUndefined();
  });

  test("a plain-text gateway body is kept as data, never as the message", async () => {
    const error = await verify(
      () =>
        new Response("  upstream\nconnect error  ", {
          status: 503,
          headers: { "content-type": "text/plain" },
        }),
    );
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(error.message).toBe("K-OTP API request failed with HTTP 503");
    expect(error.data).toBe("upstream connect error");
  });

  test("an HTML or overly long envelope message is not surfaced as is", async () => {
    const html = await verify(() =>
      json(502, {
        code: "SERVICE_UNAVAILABLE",
        message: "<!DOCTYPE html><html><body><h1>502</h1></body></html>",
      }),
    );
    expect(html.code).toBe("SERVICE_UNAVAILABLE");
    expect(html.message).toBe("K-OTP API request failed with HTTP 502");
    const long = await verify(() =>
      errorEnvelope(500, "INTERNAL_SERVER_ERROR", `x\n${"y".repeat(1000)}`),
    );
    expect(long.message).toHaveLength(300);
    expect(long.message.startsWith("x y")).toBe(true);
    expect(long.message.endsWith("\u2026")).toBe(true);
    const plain = await verify(() =>
      errorEnvelope(400, "BAD_REQUEST", "code must be 6 digits (a < b)"),
    );
    expect(plain.message).toBe("code must be 6 digits (a < b)");
    const blank = await verify(() => errorEnvelope(400, "BAD_REQUEST", "  "));
    expect(blank.message).toBe("K-OTP API request failed with HTTP 400");
  });

  test("an empty error body maps by status and keeps the request id", async () => {
    const error = await verify(
      () =>
        new Response(null, {
          status: 500,
          headers: { "x-request-id": "req_empty" },
        }),
    );
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toBe("K-OTP API request failed with HTTP 500");
    expect(error.requestId).toBe("req_empty");
    expect(error.data).toBeUndefined();
  });

  test("malformed JSON error bodies still map by status", async () => {
    const error = await verify(
      () =>
        new Response("{not json", {
          status: 504,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(error.status).toBe(504);
  });

  test("unexpected statuses map to UNKNOWN", async () => {
    const error = await verify(() => json(418, { message: "teapot" }));
    expect(error.code).toBe("UNKNOWN");
    expect(error.status).toBe(418);
  });

  test("malformed success bodies map to UNKNOWN with the status", async () => {
    const error = await verify(
      () =>
        new Response("{oops", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(error.code).toBe("UNKNOWN");
    expect(error.status).toBe(200);
  });
});

describe("interrupted responses", () => {
  test("a body stream that fails after the headers maps to NETWORK_ERROR", async () => {
    const error = await verify(
      () =>
        new Response(
          new ReadableStream({
            start: (controller) =>
              controller.error(new TypeError("terminated")),
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-request-id": "req_1",
            },
          },
        ),
    );
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
    expect(error.requestId).toBe("req_1");
  });
});

describe("Retry-After", () => {
  test("delta-seconds header", async () => {
    const error = await verify(() =>
      errorEnvelope(429, "TOO_MANY_REQUESTS", "slow down", undefined, {
        "retry-after": "3",
      }),
    );
    expect(error.code).toBe("TOO_MANY_REQUESTS");
    expect(error.retryAfterMs).toBe(3000);
  });

  test("HTTP-date header", () => {
    const now = Date.parse("2026-09-29T00:00:00Z");
    expect(parseRetryAfter("Tue, 29 Sep 2026 00:00:05 GMT", now)).toBe(5000);
    expect(parseRetryAfter("Mon, 28 Sep 2026 00:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });

  test("body data.retryAfterMs / data.retryAfter (forward-compatible)", async () => {
    const ms = await verify(() =>
      errorEnvelope(503, "SERVICE_UNAVAILABLE", "busy", { retryAfterMs: 1500 }),
    );
    expect(ms.retryAfterMs).toBe(1500);
    const seconds = await verify(() =>
      errorEnvelope(429, "TOO_MANY_REQUESTS", "busy", { retryAfter: 2 }),
    );
    expect(seconds.retryAfterMs).toBe(2000);
  });

  test("429 rate limit (1.3.1): exact data.retryAfterMs wins over the rounded header", async () => {
    const error = await verify(() =>
      errorEnvelope(
        429,
        "TOO_MANY_REQUESTS",
        "Too Many Requests",
        { limit: "perKey", policy: "key", retryAfterMs: 1500 },
        { "retry-after": "2" },
      ),
    );
    expect(error.code).toBe("TOO_MANY_REQUESTS");
    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(1500);
    expect(error.data).toEqual({
      limit: "perKey",
      policy: "key",
      retryAfterMs: 1500,
    });
    expect(error.toJSON().retryAfterMs).toBe(1500);
  });

  test("Retry-After header wins over the legacy data.retryAfter seconds", async () => {
    const error = await verify(() =>
      errorEnvelope(
        429,
        "TOO_MANY_REQUESTS",
        "x",
        { retryAfter: 9 },
        {
          "retry-after": "2",
        },
      ),
    );
    expect(error.retryAfterMs).toBe(2000);
  });

  test("429 without an envelope still maps to TOO_MANY_REQUESTS with Retry-After", async () => {
    const error = await verify(
      () =>
        new Response("rate limited", {
          status: 429,
          headers: { "content-type": "text/plain", "retry-after": "4" },
        }),
    );
    expect(error.code).toBe("TOO_MANY_REQUESTS");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(4000);
  });

  test("absent when not provided", async () => {
    const error = await verify(() =>
      errorEnvelope(503, "SERVICE_UNAVAILABLE", "x"),
    );
    expect(error.retryAfterMs).toBeUndefined();
  });
});

describe("OtpApiError", () => {
  test("toJSON omits undefined fields", () => {
    const error = new OtpApiError({
      code: "NOT_FOUND",
      status: 404,
      message: "nope",
    });
    expect(error.toJSON()).toEqual({
      name: "OtpApiError",
      code: "NOT_FOUND",
      status: 404,
      message: "nope",
    });
    expect(error.name).toBe("OtpApiError");
    expect(error).toBeInstanceOf(Error);
  });

  test("isOtpApiError recognizes copies from another bundle", () => {
    const foreign = new OtpApiError({
      code: "UNKNOWN",
      status: 0,
      message: "x",
    });
    const copy = Object.create(foreign);
    expect(isOtpApiError(copy)).toBe(true);
    expect(isOtpApiError(new Error("x"))).toBe(false);
    expect(isOtpApiError(null)).toBe(false);
  });

  test("instanceof accepts errors from another copy (ESM/CJS, CDN)", () => {
    // What another copy's OtpApiError looks like from here: a different
    // prototype chain carrying the shared Symbol.for brand.
    const foreign = Object.defineProperty(
      new Error("x"),
      Symbol.for("@k-otp/sdk/OtpApiError"),
      { value: true },
    );
    expect(foreign instanceof OtpApiError).toBe(true);
    expect(isOtpApiError(foreign)).toBe(true);
    expect(new Error("x") instanceof OtpApiError).toBe(false);
    expect((null as unknown as object) instanceof OtpApiError).toBe(false);

    // Subclasses keep the ordinary prototype check.
    class CustomError extends OtpApiError {}
    const base = new OtpApiError({ code: "UNKNOWN", status: 0, message: "x" });
    const custom = new CustomError({
      code: "UNKNOWN",
      status: 0,
      message: "x",
    });
    expect(custom instanceof OtpApiError).toBe(true);
    expect(custom instanceof CustomError).toBe(true);
    expect(base instanceof CustomError).toBe(false);
    expect(foreign instanceof CustomError).toBe(false);
  });

  test("normalizeOtpApiError handles arbitrary values", () => {
    const same = new OtpApiError({
      code: "CONFLICT",
      status: 409,
      message: "x",
    });
    expect(normalizeOtpApiError(same)).toBe(same);
    expect(normalizeOtpApiError(new Error("boom")).code).toBe("UNKNOWN");
    expect(normalizeOtpApiError("boom").code).toBe("UNKNOWN");
    const fromShape = normalizeOtpApiError({
      status: 403,
      code: "FORBIDDEN",
      message: "no",
    });
    expect(fromShape.code).toBe("FORBIDDEN");
    expect(fromShape.status).toBe(403);
  });

  test("otpErrorCodeFromStatus", () => {
    expect(otpErrorCodeFromStatus(408)).toBe("TIMEOUT");
    expect(otpErrorCodeFromStatus(502)).toBe("SERVICE_UNAVAILABLE");
    expect(otpErrorCodeFromStatus(507)).toBe("INTERNAL_SERVER_ERROR");
    expect(otpErrorCodeFromStatus(302)).toBe("UNKNOWN");
  });

  test("getIssueRequestErrorCode reads data.code of a 400 only", async () => {
    expect(ISSUE_REQUEST_ERROR_CODES).toEqual([
      "CHANNEL_NOT_SUPPORTED",
      "TEMPLATE_NOT_AVAILABLE",
      "WEB_OTP_NOT_SUPPORTED",
      "PHONE_NUMBER_NOT_MOBILE",
    ]);
    for (const code of ISSUE_REQUEST_ERROR_CODES) {
      const { fetch } = mockFetch(() =>
        errorEnvelope(400, "BAD_REQUEST", `${code}: rejected`, { code }),
      );
      const client = createOtpClient({ apiKey: "pk_test", fetch });
      const error = await client
        .issue({
          phoneNumber: "01012345678",
          purpose: "signup",
          idempotencyKey: "k1",
        })
        .catch((reason: unknown) => reason);
      expect(isOtpApiError(error)).toBe(true);
      expect((error as OtpApiError).code).toBe("BAD_REQUEST");
      expect(getIssueRequestErrorCode(error)).toBe(code);
    }
    expect(
      getIssueRequestErrorCode({ status: 400, data: { code: "OTHER" } }),
    ).toBeUndefined();
    expect(
      getIssueRequestErrorCode({
        status: 402,
        data: { code: "CHANNEL_NOT_SUPPORTED" },
      }),
    ).toBeUndefined();
    expect(getIssueRequestErrorCode(new Error("x"))).toBeUndefined();
    expect(getIssueRequestErrorCode(undefined)).toBeUndefined();
  });

  test("PHONE_NUMBER_NOT_MOBILE (API 2.3.0): a landline number", async () => {
    const { fetch } = mockFetch(() =>
      errorEnvelope(
        400,
        "BAD_REQUEST",
        "PHONE_NUMBER_NOT_MOBILE: phoneNumber is not a mobile number",
        { code: "PHONE_NUMBER_NOT_MOBILE" },
        { "x-request-id": "req_landline" },
      ),
    );
    const client = createOtpClient({ apiKey: "pk_live_x", fetch });
    const error = await client
      .issue({
        phoneNumber: "0212345678",
        purpose: "signup",
        idempotencyKey: "k1",
      })
      .then(
        () => {
          throw new Error("expected rejection");
        },
        (reason: unknown) => reason as OtpApiError,
      );
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.retryable).toBe(false);
    expect(error.requestId).toBe("req_landline");
    expect(getIssueRequestErrorCode(error)).toBe("PHONE_NUMBER_NOT_MOBILE");
    expect(getTestNumberErrorCode(error)).toBeUndefined();
    expect(getOtpErrorReason(error)).toBe("PHONE_NUMBER_NOT_MOBILE");
  });

  test("getOtpErrorReason: data.code of a 4xx, data.limit of a 429", () => {
    const error = (status: number, data: unknown) =>
      new OtpApiError({
        code: otpErrorCodeFromStatus(status),
        status,
        message: "x",
        data,
      });
    expect(
      getOtpErrorReason(error(400, { code: "TEST_NUMBER_REQUIRED" })),
    ).toBe("TEST_NUMBER_REQUIRED");
    expect(
      getOtpErrorReason(
        error(402, {
          code: "TRIAL_DAILY_LIMIT_EXCEEDED",
          resetAt: "2026-01-02T00:00:00+09:00",
        }),
      ),
    ).toBe("TRIAL_DAILY_LIMIT_EXCEEDED");
    expect(
      getOtpErrorReason(
        error(429, { limit: "perPhone", policy: "key", retryAfterMs: 1 }),
      ),
    ).toBe("perPhone");
    // A reason a newer API adds is reported as is.
    expect(getOtpErrorReason(error(400, { code: "SOMETHING_NEW" }))).toBe(
      "SOMETHING_NEW",
    );
    // Not an identifier, not a 4xx, or no data: no reason.
    expect(
      getOtpErrorReason(error(400, { code: "<b>not an id</b>" })),
    ).toBeUndefined();
    expect(getOtpErrorReason(error(400, { code: "x".repeat(65) }))).toBe(
      undefined,
    );
    expect(getOtpErrorReason(error(429, { code: "perPhone" }))).toBeUndefined();
    expect(getOtpErrorReason(error(503, { code: "X" }))).toBeUndefined();
    expect(getOtpErrorReason(error(400, "BAD"))).toBeUndefined();
    expect(getOtpErrorReason(error(400, undefined))).toBeUndefined();
    expect(getOtpErrorReason(undefined)).toBeUndefined();
  });
});
