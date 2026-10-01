/**
 * WebOTP (`navigator.credentials.get({ otp })`): lets Chrome on Android read
 * the code from the incoming SMS after a one-tap consent, without leaving the
 * page.
 *
 * It only works when the SMS ends with an origin-bound line, on its own last
 * line, naming the page's host and the code:
 *
 * ```text
 * [K-OTP] 인증번호는 123456입니다.
 *
 * @www.example.com #123456
 * ```
 *
 * The host must be the top-level page's (and an iframe's origin can be added:
 * `@top.example #123456 @iframe.example`). Without that line the request
 * simply never resolves (until aborted), so it is safe to always start it.
 * iOS/macOS Safari ignore WebOTP and autofill from the SMS through
 * `autocomplete="one-time-code"` instead, which the code input also sets.
 *
 * Feature-detected at call time: nothing runs on import or on the server.
 */
import { DEFAULT_OTP_CODE_LENGTH, sanitizeOtpCode } from "./code";

/** `true` in browsers that implement WebOTP (`OTPCredential`). */
export const isWebOtpSupported = (): boolean =>
  typeof window !== "undefined" &&
  "OTPCredential" in window &&
  typeof navigator !== "undefined" &&
  typeof navigator.credentials?.get === "function";

export type ReceiveWebOtpOptions = {
  /** Abort the request (e.g. on unmount or when the code was typed). */
  signal?: AbortSignal;
  /** Expected code length (default 6). */
  length?: number;
};

/**
 * Waits for an SMS code through WebOTP. Resolves the sanitized code, or
 * `undefined` when WebOTP is unsupported, the request was aborted, the user
 * declined, or anything else failed. Never rejects and never throws.
 */
export const receiveWebOtp = async (
  options: ReceiveWebOtpOptions = {},
): Promise<string | undefined> => {
  if (!isWebOtpSupported() || options.signal?.aborted) return undefined;
  try {
    const credential = (await navigator.credentials.get({
      otp: { transport: ["sms"] },
      ...(options.signal ? { signal: options.signal } : {}),
    } as CredentialRequestOptions)) as { code?: unknown } | null;
    if (options.signal?.aborted) return undefined;
    const code =
      typeof credential?.code === "string"
        ? sanitizeOtpCode(
            credential.code,
            options.length ?? DEFAULT_OTP_CODE_LENGTH,
          )
        : "";
    return code || undefined;
  } catch {
    return undefined;
  }
};
