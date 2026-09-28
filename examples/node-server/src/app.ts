/**
 * Server-driven OTP flow: the browser talks only to YOUR backend, which holds
 * the sk_ key and decides who may receive a code.
 *
 *   POST /api/otp/send    { phoneNumber }  -> { expiresAt, attemptsRemaining }
 *   POST /api/otp/verify  { code }         -> { verified, reasonCode?, attemptsRemaining }
 *
 * Pending state (phone number, idempotency key, issueId) lives in a server
 * side session keyed by an HttpOnly cookie. A real app would use its session
 * store / database; the in-memory Map is only for the example.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createIdempotencyKey,
  isOtpApiError,
  type OtpApiError,
  type OtpServerClient,
} from "@k-otp/sdk-server";

type PendingOtp = {
  phoneNumber: string;
  /** Persisted BEFORE calling issue, reused for retries of the same send. */
  idempotencyKey: string;
  issueId?: string;
  verified?: boolean;
};

/** Errors after which the send may or may not have happened. */
const AMBIGUOUS = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_SERVER_ERROR",
  "TOO_MANY_REQUESTS",
]);

const PHONE = /^01\d{8,9}$/;

const readJson = async (
  req: IncomingMessage,
): Promise<Record<string, unknown>> => {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("body too large");
  }
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
};

const send = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

/** Maps an OtpApiError to what the browser may see (no internal details). */
const sendError = (res: ServerResponse, error: OtpApiError): void => {
  const reply = (
    status: number,
    body: unknown,
    headers?: Record<string, string>,
  ) => send(res, status, body, headers);
  switch (error.code) {
    case "PAYMENT_REQUIRED":
      // Your K-OTP credit ran out: alert yourself, show a generic message.
      console.error("K-OTP credit exhausted", error.data, error.requestId);
      reply(503, { error: "OTP_UNAVAILABLE" });
      return;
    case "TOO_MANY_REQUESTS": {
      const seconds = Math.ceil((error.retryAfterMs ?? 30_000) / 1000);
      reply(
        429,
        { error: "RATE_LIMITED", retryAfterMs: seconds * 1000 },
        {
          "retry-after": String(seconds),
        },
      );
      return;
    }
    case "BAD_REQUEST":
      reply(400, { error: "INVALID_REQUEST" });
      return;
    default:
      console.error(
        "K-OTP request failed",
        error.code,
        error.status,
        error.requestId,
      );
      reply(error.retryable ? 503 : 500, {
        error: error.retryable ? "RETRY" : "OTP_FAILED",
      });
  }
};

const PAGE = `<!doctype html>
<meta charset="utf-8" />
<title>K-OTP server-driven example</title>
<h1>Phone verification (server-driven)</h1>
<form id="send"><input name="phoneNumber" placeholder="01012345678" required /> <button>Send code</button></form>
<form id="verify"><input name="code" placeholder="123456" required /> <button>Verify</button></form>
<pre id="out"></pre>
<script>
  const out = document.getElementById("out");
  const post = async (path, body) => {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    out.textContent = res.status + " " + JSON.stringify(await res.json(), null, 2);
  };
  for (const form of document.forms) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      post(form.id === "send" ? "/api/otp/send" : "/api/otp/verify", data);
    });
  }
</script>`;

export const createHandler = (otp: OtpServerClient) => {
  const sessions = new Map<string, PendingOtp>();

  const sessionId = (req: IncomingMessage, res: ServerResponse): string => {
    const match = /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie ?? "");
    if (match?.[1]) return match[1];
    const sid = randomUUID();
    res.setHeader("set-cookie", `sid=${sid}; HttpOnly; SameSite=Lax; Path=/`);
    return sid;
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAGE);
        return;
      }
      if (req.method !== "POST") return send(res, 404, { error: "NOT_FOUND" });
      const sid = sessionId(req, res);
      const body = await readJson(req);

      if (req.url === "/api/otp/send") {
        const phoneNumber = String(body.phoneNumber ?? "").replace(/-/g, "");
        if (!PHONE.test(phoneNumber))
          return send(res, 400, { error: "INVALID_PHONE" });
        // Your own abuse controls (CAPTCHA, per-user/IP limits) belong here.
        const previous = sessions.get(sid);
        // Reuse the key only to retry the SAME unresolved send; otherwise
        // this is a new attempt with a new key.
        const pending: PendingOtp =
          previous && !previous.issueId && previous.phoneNumber === phoneNumber
            ? previous
            : { phoneNumber, idempotencyKey: createIdempotencyKey("signup") };
        sessions.set(sid, pending); // persist before calling issue
        try {
          const result = await otp.issue({
            phoneNumber,
            purpose: "signup",
            idempotencyKey: pending.idempotencyKey,
          });
          pending.issueId = result.issueId;
          return send(res, 200, {
            expiresAt: result.expiresAt,
            attemptsRemaining: result.attemptsRemaining,
          });
        } catch (error) {
          if (!isOtpApiError(error)) throw error;
          // Definitive failure: the next send is a new attempt.
          if (!AMBIGUOUS.has(error.code)) sessions.delete(sid);
          return sendError(res, error);
        }
      }

      if (req.url === "/api/otp/verify") {
        const pending = sessions.get(sid);
        if (!pending?.issueId)
          return send(res, 409, { error: "NO_PENDING_CODE" });
        const code = String(body.code ?? "").trim();
        try {
          const result = await otp.verify({ issueId: pending.issueId, code });
          pending.verified = result.verified;
          // result.verified is the server-side proof: mark the phone number
          // as verified for this user/session here.
          return send(res, 200, {
            verified: result.verified,
            reasonCode: result.reasonCode,
            attemptsRemaining: result.attemptsRemaining,
          });
        } catch (error) {
          if (!isOtpApiError(error)) throw error;
          return sendError(res, error);
        }
      }
      return send(res, 404, { error: "NOT_FOUND" });
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, { error: "INTERNAL" });
    }
  };
};
