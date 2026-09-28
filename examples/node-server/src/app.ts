/**
 * Server-driven OTP flow: the browser talks only to YOUR backend, which holds
 * the sk_ key and decides who may receive a code.
 *
 *   POST /api/otp/send    { phoneNumber }  -> { expiresAt, attemptsRemaining }
 *   POST /api/otp/verify  { code }         -> { verified, reasonCode?, attemptsRemaining }
 *
 * Pending state (phone number, idempotency key, issueId) lives in a server
 * side session keyed by an HttpOnly cookie. A real app would use its session
 * store / database; the in-memory Map (with a TTL and a size cap) is only for
 * the example.
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
  /** Epoch ms after which the entry is dropped. */
  expiresAt: number;
};

/** Pending sends and codes live at most this long (OTP expiry + margin). */
const SESSION_TTL_MS = 10 * 60_000;
const MAX_SESSIONS = 10_000;

class InvalidBodyError extends Error {}

/** Errors after which the send may or may not have happened. */
const AMBIGUOUS = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_SERVER_ERROR",
  "TOO_MANY_REQUESTS",
]);

const PHONE = /^01\d{8,9}$/;

/** Parses a small JSON body; throws InvalidBodyError for client mistakes. */
const readJson = async (
  req: IncomingMessage,
): Promise<Record<string, unknown>> => {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new InvalidBodyError("body too large");
  }
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new InvalidBodyError("invalid JSON");
  }
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
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const text = await res.text();
      let shown = text;
      try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      out.textContent = res.status + " " + shown;
    } catch (error) {
      out.textContent = "Request failed: " + (error && error.message ? error.message : error);
    }
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

  /** Returns a live session entry, dropping expired ones. */
  const getPending = (sid: string): PendingOtp | undefined => {
    const pending = sessions.get(sid);
    if (pending && pending.expiresAt <= Date.now()) {
      sessions.delete(sid);
      return undefined;
    }
    return pending;
  };

  const savePending = (sid: string, pending: PendingOtp): void => {
    sessions.delete(sid); // re-insert: the Map stays ordered by last write
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest !== undefined) sessions.delete(oldest);
    }
    sessions.set(sid, pending);
  };

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
      let body: Record<string, unknown>;
      try {
        body = await readJson(req);
      } catch (error) {
        if (error instanceof InvalidBodyError) {
          return send(res, 400, { error: "INVALID_BODY" });
        }
        throw error;
      }

      if (req.url === "/api/otp/send") {
        const phoneNumber = String(body.phoneNumber ?? "").replace(/-/g, "");
        if (!PHONE.test(phoneNumber))
          return send(res, 400, { error: "INVALID_PHONE" });
        // Your own abuse controls (CAPTCHA, per-user/IP limits) belong here.
        const previous = getPending(sid);
        // Reuse the key only to retry the SAME unresolved send; otherwise
        // this is a new attempt with a new key.
        const pending: PendingOtp =
          previous && !previous.issueId && previous.phoneNumber === phoneNumber
            ? previous
            : {
                phoneNumber,
                idempotencyKey: createIdempotencyKey("signup"),
                expiresAt: 0,
              };
        pending.expiresAt = Date.now() + SESSION_TTL_MS;
        savePending(sid, pending); // persist before calling issue
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
        const pending = getPending(sid);
        if (!pending?.issueId)
          return send(res, 409, { error: "NO_PENDING_CODE" });
        // A repeated submit after success: the API would now answer
        // ALREADY_VERIFIED, so answer from the session instead.
        if (pending.verified) return send(res, 200, { verified: true });
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
