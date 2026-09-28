import { describe, expect, test } from "bun:test";
import {
  createOtpClient,
  isOtpApiError,
  normalizeOtpApiError,
  OtpApiError,
  type OtpApiErrorCode,
  otpErrorCodeFromStatus,
  parseRetryAfter,
} from "../src/index";
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
});
