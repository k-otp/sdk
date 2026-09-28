import { OtpApiError } from "./errors";

/** Max idempotency key length accepted by the API (after trimming). */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

const VISIBLE_ASCII = /^[\x21-\x7e]+$/;

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const randomUuid = (): string => {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error(
      "createIdempotencyKey() needs Web Crypto (globalThis.crypto). Pass your own unique key instead.",
    );
  }
  // `randomUUID` is only exposed in secure contexts; build a v4 UUID by hand.
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/**
 * Creates a new random idempotency key for `issue` (a UUID v4, optionally
 * prefixed: `createIdempotencyKey("signup")` -> `signup-3f2a...`).
 *
 * Create ONE key per logical "send an OTP" action, persist it (component
 * state, session, DB row) and reuse it for every retry of that action. Only
 * mint a new key when the user intentionally asks for a new code. Retrying an
 * ambiguous failure (timeout, network error, 503) with a new key can send a
 * duplicate SMS and debit twice.
 */
export const createIdempotencyKey = (prefix?: string): string => {
  const key = prefix ? `${prefix}-${randomUuid()}` : randomUuid();
  return normalizeIdempotencyKey(key);
};

/**
 * Trims and validates an idempotency key the way the API does: 1-128 visible
 * ASCII characters, no spaces. Throws `OtpApiError(BAD_REQUEST, 400)` before
 * any network request.
 */
export const normalizeIdempotencyKey = (value: unknown): string => {
  const key = typeof value === "string" ? value.trim() : "";
  const fail = (message: string): never => {
    throw new OtpApiError({ code: "BAD_REQUEST", status: 400, message });
  };
  if (!key) {
    return fail("idempotencyKey is required for issue requests");
  }
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return fail(
      `idempotencyKey must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
    );
  }
  if (!VISIBLE_ASCII.test(key)) {
    return fail(
      "idempotencyKey must contain only visible ASCII characters (no spaces)",
    );
  }
  return key;
};
