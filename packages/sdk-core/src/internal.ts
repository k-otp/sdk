/**
 * Building blocks shared with `@k-otp/sdk-server` and future framework
 * adapters. Import from `@k-otp/sdk-core/internal` only inside the K-OTP SDK
 * packages: this entry point is NOT covered by SemVer.
 */
export { issueWith, verifyWith } from "./operations";
export {
  createOtpTransport,
  mergeHeaders,
  type OtpCallOptions,
  type OtpTransport,
  type OtpTransportInternalOptions,
  resolveApiKey,
  resolveBaseUrl,
} from "./transport";
