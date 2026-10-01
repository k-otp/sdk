import type { OtpIssueVerifyClient } from "../headless";
import { createOtpClient, type OtpClientOptions } from "./client";

/**
 * Resolves what the framework adapters accept as a client: an existing
 * client (anything with `issue`/`verify`) is returned as-is, options are
 * passed to `createOtpClient`. Anything else (e.g. `undefined`) throws a
 * descriptive `TypeError`, identically in every adapter.
 */
export const toOtpClient = (
  source: OtpIssueVerifyClient | OtpClientOptions | null | undefined,
): OtpIssueVerifyClient => {
  if (typeof source !== "object" || source === null) {
    throw new TypeError(
      'Pass an OTP client or createOtpClient options (e.g. { apiKey: "pk_..." }).',
    );
  }
  const candidate = source as Partial<OtpIssueVerifyClient>;
  return typeof candidate.issue === "function" &&
    typeof candidate.verify === "function"
    ? (source as OtpIssueVerifyClient)
    : createOtpClient(source as OtpClientOptions);
};
