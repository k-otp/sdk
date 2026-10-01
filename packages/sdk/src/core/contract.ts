/**
 * oRPC contract for the public K-OTP REST API (`/v1`), mirroring
 * `spec/openapi.json`.
 *
 * The contract is written directly in oRPC's *minified* shape (what
 * `minifyContractRouter()` produces): each procedure is a plain object that
 * only carries its HTTP route. There are no runtime schemas or validators, so
 * the browser bundle pays nothing for it; input/output types come from
 * `generated/openapi.ts`, which is generated from the vendored spec.
 *
 * `test/contract-drift.test.ts` fails when an operation, method, path, path
 * parameter or required field here disagrees with `spec/openapi.json`.
 */
import type { ContractProcedure, Route, Schema } from "@orpc/contract";
import type { OpenApiOperations } from "./generated/openapi";

type Operations = OpenApiOperations;
type Part<T> = T extends undefined ? unknown : T;

/** Input of a `compact` procedure: path params, query and body merged. */
export type CompactInput<K extends keyof Operations> = Part<
  Operations[K]["params"]
> &
  Part<Operations[K]["query"]> &
  Part<Operations[K]["body"]>;

/** Input of a `detailed` procedure (explicit headers/body). */
export type DetailedInput<K extends keyof Operations> = {
  headers: Operations[K]["headers"];
  body: Operations[K]["body"];
};

/** A schema-less oRPC contract procedure (types only, no runtime validation). */
export type OtpContractProcedure<TInput, TOutput> = ContractProcedure<
  Schema<TInput, TInput>,
  Schema<TOutput, TOutput>,
  Record<never, never>,
  Record<never, never>
>;

const procedure = <TInput, TOutput>(
  route: Route,
): OtpContractProcedure<TInput, TOutput> =>
  ({
    "~orpc": { route, errorMap: {}, meta: {} },
  }) as unknown as OtpContractProcedure<TInput, TOutput>;

type Output<K extends keyof Operations> = Operations[K]["response"];

/** `POST /issue`. Uses the detailed structure to send `Idempotency-Key`. */
export const issueProcedure: OtpContractProcedure<
  DetailedInput<"issue">,
  Output<"issue">
> = /* @__PURE__ */ procedure({
  method: "POST",
  path: "/issue",
  operationId: "otp.issue",
  inputStructure: "detailed",
});

/** `POST /verify`. */
export const verifyProcedure: OtpContractProcedure<
  CompactInput<"verify">,
  Output<"verify">
> = /* @__PURE__ */ procedure({
  method: "POST",
  path: "/verify",
  operationId: "otp.verify",
});

/** `GET /status` (`sk_` only). */
export const statusProcedure: OtpContractProcedure<
  CompactInput<"status">,
  Output<"status">
> = /* @__PURE__ */ procedure({
  method: "GET",
  path: "/status",
  operationId: "otp.status",
});

/** `GET /issues` (`sk_` only). */
export const listIssuesProcedure: OtpContractProcedure<
  CompactInput<"listIssues">,
  Output<"listIssues">
> = /* @__PURE__ */ procedure({
  method: "GET",
  path: "/issues",
  operationId: "otp.listIssues",
});

/** `GET /issues/{issueId}` (`sk_` only). */
export const getIssueProcedure: OtpContractProcedure<
  CompactInput<"getIssue">,
  Output<"getIssue">
> = /* @__PURE__ */ procedure({
  method: "GET",
  path: "/issues/{issueId}",
  operationId: "otp.getIssue",
});

/** `GET /credit-ledger` (`sk_` only). */
export const listCreditLedgerProcedure: OtpContractProcedure<
  CompactInput<"listCreditLedger">,
  Output<"listCreditLedger">
> = /* @__PURE__ */ procedure({
  method: "GET",
  path: "/credit-ledger",
  operationId: "otp.listCreditLedger",
});

/** `GET /balance` (`sk_` only). */
export const balanceProcedure: OtpContractProcedure<
  CompactInput<"balance">,
  Output<"balance">
> = /* @__PURE__ */ procedure({
  method: "GET",
  path: "/balance",
  operationId: "otp.balance",
});

/** `GET /templates` (`sk_` only). */
export const listTemplatesProcedure: OtpContractProcedure<
  CompactInput<"listTemplates">,
  Output<"listTemplates">
> = /* @__PURE__ */ procedure({
  method: "GET",
  path: "/templates",
  operationId: "otp.listTemplates",
});

/** `GET /templates/{templateId}` (`sk_` only). */
export const getTemplateProcedure: OtpContractProcedure<
  CompactInput<"getTemplate">,
  Output<"getTemplate">
> = /* @__PURE__ */ procedure({
  method: "GET",
  path: "/templates/{templateId}",
  operationId: "otp.getTemplate",
});

/** Operations a browser `pk_` public key may call. */
export type OtpPublicContract = {
  issue: typeof issueProcedure;
  verify: typeof verifyProcedure;
};

/** Every public `/v1` operation (server-side `sk_` secret key). */
export type OtpServerContract = OtpPublicContract & {
  status: typeof statusProcedure;
  listIssues: typeof listIssuesProcedure;
  getIssue: typeof getIssueProcedure;
  listCreditLedger: typeof listCreditLedgerProcedure;
  balance: typeof balanceProcedure;
  listTemplates: typeof listTemplatesProcedure;
  getTemplate: typeof getTemplateProcedure;
};

/** Contract for `issue`/`verify` (usable with a `pk_` key). */
export const otpPublicContract: OtpPublicContract = {
  issue: issueProcedure,
  verify: verifyProcedure,
};

/** Contract for all nine public operations. */
export const otpServerContract: OtpServerContract = {
  ...otpPublicContract,
  status: statusProcedure,
  listIssues: listIssuesProcedure,
  getIssue: getIssueProcedure,
  listCreditLedger: listCreditLedgerProcedure,
  balance: balanceProcedure,
  listTemplates: listTemplatesProcedure,
  getTemplate: getTemplateProcedure,
};

export type * from "./generated/openapi";
export { OPENAPI_VERSION } from "./generated/openapi";
