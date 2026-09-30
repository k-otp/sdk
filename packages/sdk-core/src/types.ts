/**
 * Public request/response types. They are aliases of the types generated from
 * the vendored OpenAPI document (`generated/openapi.ts`), so they cannot drift
 * from the API without the drift test failing.
 */
import type {
  GetIssueStatusOutput,
  IssueOtpInput,
  IssueOtpOutput,
  IssueOtpPaymentErrorData,
  ListOtpCreditLedgerOutput,
  ListOtpIssuesOutput,
  ListTemplatesOutput,
  OpenApiOperations,
  OtpBalanceOutput,
  OtpCreditLedgerItem,
  OtpDashboardIssue,
  OtpRateLimitErrorData,
  TemplatePublicDetail,
  TemplateSummary,
  VerifyOtpInput,
  VerifyOtpOutput,
} from "./generated/openapi";

/**
 * Input of `issue`. Unlike the raw REST API, the SDK always requires
 * `idempotencyKey` (see `createIdempotencyKey`) and sends it both as the body
 * field and the `Idempotency-Key` header.
 */
export type IssueInput = Omit<IssueOtpInput, "idempotencyKey"> & {
  /** 1-128 visible ASCII characters. Reuse the same key when retrying. */
  idempotencyKey: string;
};
export type IssueResult = IssueOtpOutput;
export type VerifyInput = VerifyOtpInput;
export type VerifyResult = VerifyOtpOutput;
/** Verification failure reason (returned with HTTP 200 and `verified: false`). */
export type VerifyReasonCode = NonNullable<VerifyOtpOutput["reasonCode"]>;
export type OtpChannel = NonNullable<IssueOtpInput["channel"]>;
export type PaymentRequiredData = IssueOtpPaymentErrorData;
/** `data` of a 429 TOO_MANY_REQUESTS error from `issue`/`verify` (1.3.1+). */
export type RateLimitedData = OtpRateLimitErrorData;

export type GetStatusInput = OpenApiOperations["status"]["query"];
export type GetStatusResult = GetIssueStatusOutput;
export type ListIssuesInput = NonNullable<
  OpenApiOperations["listIssues"]["query"]
>;
export type ListIssuesResult = ListOtpIssuesOutput;
export type OtpIssue = OtpDashboardIssue;
export type GetIssueInput = OpenApiOperations["getIssue"]["params"];
export type GetIssueResult = OtpDashboardIssue;
export type ListCreditLedgerInput = NonNullable<
  OpenApiOperations["listCreditLedger"]["query"]
>;
export type ListCreditLedgerResult = ListOtpCreditLedgerOutput;
export type CreditLedgerEntry = OtpCreditLedgerItem;
export type GetBalanceResult = OtpBalanceOutput;
export type ListTemplatesResult = ListTemplatesOutput;
export type OtpTemplateSummary = TemplateSummary;
export type GetTemplateInput = OpenApiOperations["getTemplate"]["params"];
export type GetTemplateResult = TemplatePublicDetail;

export type OtpVerificationStatus = GetIssueStatusOutput["verificationStatus"];
export type OtpDeliveryStatus = GetIssueStatusOutput["deliveryStatus"];
export type OtpOverallStatus = GetIssueStatusOutput["overallStatus"];
