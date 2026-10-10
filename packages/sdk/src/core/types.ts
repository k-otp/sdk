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
  WalletScope,
} from "./generated/openapi";

/**
 * Input of `issue`. Unlike the raw REST API, the SDK always requires
 * `idempotencyKey` (see `createIdempotencyKey`) and sends it both as the body
 * field and the `Idempotency-Key` header.
 *
 * The code is delivered by KakaoTalk AlimTalk by default, with automatic SMS
 * fallback when AlimTalk cannot be delivered: leave `channel` out. Pass
 * `smsFallback: false` (API 1.8.0+) to deliver by AlimTalk only.
 */
export type IssueInput = Omit<IssueOtpInput, "idempotencyKey"> & {
  /** 1-128 visible ASCII characters. Reuse the same key when retrying. */
  idempotencyKey: string;
};
/**
 * Result of `issue`. `mode` (API 1.9.0+) is `"test"` for a simulated issue
 * made with a `pk_test_`/`sk_test_` key: no message was sent and no credit
 * was used.
 */
export type IssueResult = IssueOtpOutput;
export type VerifyInput = VerifyOtpInput;
export type VerifyResult = VerifyOtpOutput;
/** Verification failure reason (returned with HTTP 200 and `verified: false`). */
export type VerifyReasonCode = NonNullable<VerifyOtpOutput["reasonCode"]>;
/**
 * Delivery channel of an issue. Codes are delivered by KakaoTalk AlimTalk by
 * default, with automatic SMS fallback (`smsFallback: false` turns it off);
 * `issue` callers leave `channel` out.
 */
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
/**
 * Which wallet a balance or ledger belongs to (1.4.0+): `"organization"` is the
 * credit wallet shared by every app of the organization, `"app"` the legacy
 * per-app wallet that only exists until the API's contract step, and `"test"`
 * (1.9.0+) the fixed simulated wallet a `sk_test_` key sees instead of the
 * real one (`walletId: "test:<appId>"`; its balance never changes).
 */
export type OtpWalletScope = WalletScope;
/**
 * Result of `GET /v1/balance`. From API 1.4.0 the balance is the organization
 * wallet shared by all apps of the key's organization (`walletScope:
 * "organization"`, `organizationId` set). `walletId` and `walletScope` are
 * always sent by 1.4.0+ but are typed optional here: an API deployment older
 * than 1.4.0 omits them and the balance is then that app's own wallet.
 * Likewise `promoBalance` (free promotional credits included in `balance`) and
 * `promoNextExpiry` are sent by 1.6.0+ and typed optional for older APIs.
 * A `sk_test_` key (1.9.0+) gets a fixed simulated balance with `walletScope:
 * "test"` and `mode: "test"`; the real wallet is never read.
 */
export type GetBalanceResult = Omit<
  OtpBalanceOutput,
  "walletId" | "walletScope" | "promoBalance" | "promoNextExpiry"
> &
  Partial<
    Pick<
      OtpBalanceOutput,
      "walletId" | "walletScope" | "promoBalance" | "promoNextExpiry"
    >
  >;
export type ListTemplatesResult = ListTemplatesOutput;
export type OtpTemplateSummary = TemplateSummary;
export type GetTemplateInput = OpenApiOperations["getTemplate"]["params"];
export type GetTemplateResult = TemplatePublicDetail;

export type OtpVerificationStatus = GetIssueStatusOutput["verificationStatus"];
export type OtpDeliveryStatus = GetIssueStatusOutput["deliveryStatus"];
export type OtpOverallStatus = GetIssueStatusOutput["overallStatus"];
