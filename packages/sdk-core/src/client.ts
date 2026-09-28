import { otpPublicContract } from "./contract";
import { issueWith, verifyWith } from "./operations";
import {
  createOtpTransport,
  type OtpRequestOptions,
  type OtpTransportOptions,
} from "./transport";
import type {
  IssueInput,
  IssueResult,
  VerifyInput,
  VerifyResult,
} from "./types";

export type OtpClientOptions = OtpTransportOptions & {
  /**
   * Allow an `sk_` secret key when running in a browser. Never do this in
   * production: anyone can read the key from your bundle.
   */
  dangerouslyAllowSecretKeyInBrowser?: boolean;
};

export type OtpClient = {
  /** Issue an OTP (`POST /v1/issue`). Requires `input.idempotencyKey`. */
  issue: (
    input: IssueInput,
    options?: OtpRequestOptions,
  ) => Promise<IssueResult>;
  /** Verify an OTP code (`POST /v1/verify`). */
  verify: (
    input: VerifyInput,
    options?: OtpRequestOptions,
  ) => Promise<VerifyResult>;
};

const isBrowser = (): boolean =>
  typeof (globalThis as { window?: unknown }).window !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined";

/**
 * Creates an `issue`/`verify` client. Creation performs no I/O and never
 * touches `window` beyond a lazy environment check, so it is SSR-safe.
 *
 * In browsers use a `pk_` public key whose allowed origins include the exact
 * page origin (scheme + host + port).
 */
export const createOtpClient = (options: OtpClientOptions): OtpClient => {
  const transport = createOtpTransport(otpPublicContract, options, {
    validateApiKey: (apiKey) => {
      if (
        apiKey.startsWith("sk_") &&
        !options.dangerouslyAllowSecretKeyInBrowser &&
        isBrowser()
      ) {
        throw new TypeError(
          "Refusing to use an sk_ secret key in a browser. Use a pk_ public key (with an exact Origin allowlist) in client code and keep sk_ keys on your server.",
        );
      }
    },
  });
  return {
    issue: (input, requestOptions) =>
      issueWith(transport, input, requestOptions),
    verify: (input, requestOptions) =>
      verifyWith(transport, input, requestOptions),
  };
};
