/**
 * Building blocks shared with `@k-otp/sdk-server` and the framework adapters
 * (`@k-otp/sdk-react`, `@k-otp/sdk-vue`, `@k-otp/sdk-svelte`). Import from
 * `@k-otp/sdk-core/internal` only inside the K-OTP SDK packages: this entry
 * point is NOT covered by SemVer.
 */
export {
  createOtpFlow,
  createOtpOperation,
  type OtpFlowController,
  type OtpFlowOptions,
  type OtpFlowResult,
  type OtpFlowSendInput,
  type OtpFlowSkipReason,
  type OtpFlowState,
  type OtpIssueVerifyClient,
  type OtpOperationController,
  type OtpOperationState,
  type OtpOperationStatus,
  type OtpRunResult,
} from "./headless";
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
