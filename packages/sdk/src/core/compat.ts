/**
 * Source compatibility with `@k-otp/sdk` 2.0.0, which targeted K-OTP API 1.x.
 *
 * API 2.0.0 delivers by KakaoTalk AlimTalk only (SMS is only the automatic
 * fallback) and no longer offers WebOTP, so the generated wire types
 * (`generated/openapi.ts`) dropped `channel: "sms"` and every `webOtp` field.
 * Removing them from the SDK's public types would be a breaking change, so
 * the types here put them back as deprecated members: code written for 2.0.0
 * still compiles, and the request is sent unchanged so the API answers with a
 * clear 400 (`CHANNEL_NOT_SUPPORTED`, `WEB_OTP_NOT_SUPPORTED`; see
 * `getIssueRequestErrorCode`). They will be removed in the next major version.
 *
 * Types only: nothing here exists at runtime.
 */
import type {
  IssueOtpInput as GeneratedIssueOtpInput,
  IssueOtpOutput as GeneratedIssueOtpOutput,
  OpenApiOperations as GeneratedOpenApiOperations,
} from "./generated/openapi";

/**
 * Explicit WebOTP binding for `POST /v1/issue`.
 *
 * @deprecated WebOTP is no longer offered: K-OTP API 2.x rejects a `webOtp`
 * other than `false` with 400 `WEB_OTP_NOT_SUPPORTED` and never adds the
 * origin-bound line to the SMS. Remove the option.
 */
export type IssueWebOtpOptions = {
  /**
   * Origin of the page that reads the code, exactly as the browser serializes
   * it (scheme and host, no path or trailing slash).
   */
  origin: string;
};

/**
 * WebOTP outcome of an issue that asked for it (`webOtp` on the request).
 *
 * @deprecated K-OTP API 2.x no longer returns it: an issue with `webOtp` set
 * (other than `false`) is refused with 400 `WEB_OTP_NOT_SUPPORTED`.
 */
export type IssueWebOtpResult = {
  /**
   * `fallback_only`: AlimTalk delivery; only the SMS fallback could carry the
   * line. `applied`: the SMS carried `@<host> #<code>`. `skipped`: sent
   * without the line (see `reason`).
   */
  status: "applied" | "fallback_only" | "skipped";
  /** Why it was skipped. */
  reason?: "channel_alimtalk" | "host_too_long";
};

/**
 * Request body for `POST /v1/issue`: the generated wire type, plus the
 * members `@k-otp/sdk` 2.0.0 accepted (deprecated, refused by the API).
 */
export type IssueOtpInput = Omit<GeneratedIssueOtpInput, "channel"> & {
  /**
   * Delivery channel: only `"alimtalk"` (KakaoTalk AlimTalk), which is also
   * the default, so leave it out. If AlimTalk delivery fails the same text is
   * sent by SMS automatically (`smsFallback: false` turns it off).
   *
   * `"sms"` is deprecated and still typed only for compatibility: K-OTP API
   * 2.x refuses it with 400 `CHANNEL_NOT_SUPPORTED` (in `data.code`; see
   * `getIssueRequestErrorCode`). It will be removed from the type in the next
   * major version.
   */
  channel?: GeneratedIssueOtpInput["channel"] | "sms";
  /**
   * WebOTP opt-in.
   *
   * @deprecated WebOTP is no longer offered: K-OTP API 2.x refuses any value
   * but `false` with 400 `WEB_OTP_NOT_SUPPORTED`. Remove the option.
   */
  webOtp?: boolean | IssueWebOtpOptions;
};

/** Result of `POST /v1/issue`: the generated wire type plus deprecated members. */
export type IssueOtpOutput = GeneratedIssueOtpOutput & {
  /**
   * WebOTP outcome.
   *
   * @deprecated Never sent by K-OTP API 2.x (WebOTP is no longer offered).
   */
  webOtp?: IssueWebOtpResult;
};

/** The generated operation map with the compatible `issue` body and result. */
export interface OpenApiOperations
  extends Omit<GeneratedOpenApiOperations, "issue"> {
  issue: Omit<GeneratedOpenApiOperations["issue"], "body" | "response"> & {
    body: IssueOtpInput;
    response: IssueOtpOutput;
  };
}
