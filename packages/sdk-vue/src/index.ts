export {
  createIdempotencyKey,
  createOtpClient,
  type IssueInput,
  type IssueResult,
  isOtpApiError,
  OtpApiError,
  type OtpApiErrorCode,
  type OtpClient,
  type OtpClientOptions,
  type OtpRequestOptions,
  type VerifyInput,
  type VerifyReasonCode,
  type VerifyResult,
} from "@k-otp/sdk-core";
export type {
  OtpFlowOptions,
  OtpFlowResult,
  OtpFlowSendInput,
  OtpFlowSkipReason,
  OtpFlowState,
  OtpOperationState,
  OtpOperationStatus,
  OtpRunResult,
} from "@k-otp/sdk-core/internal";
export {
  type UseOtpFlowOptions,
  type UseOtpFlowReturn,
  type UseOtpOperation,
  type UseOtpOptions,
  type UseOtpReturn,
  useOtp,
  useOtpFlow,
} from "./composables";
export {
  createOtpPlugin,
  OTP_CLIENT_KEY,
  type OtpClientLike,
  type OtpClientSource,
  provideOtpClient,
  useOtpClient,
} from "./plugin";
