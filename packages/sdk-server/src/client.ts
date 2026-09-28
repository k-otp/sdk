import type {
  CreditLedgerEntry,
  GetBalanceResult,
  GetIssueInput,
  GetIssueResult,
  GetStatusInput,
  GetStatusResult,
  GetTemplateInput,
  GetTemplateResult,
  IssueInput,
  IssueResult,
  ListCreditLedgerInput,
  ListCreditLedgerResult,
  ListIssuesInput,
  ListIssuesResult,
  ListTemplatesResult,
  OtpIssue,
  OtpRequestOptions,
  OtpTransportOptions,
  VerifyInput,
  VerifyResult,
} from "@k-otp/sdk-core";
import { otpServerContract } from "@k-otp/sdk-core/contract";
import {
  createOtpTransport,
  issueWith,
  verifyWith,
} from "@k-otp/sdk-core/internal";
import { type PaginateOptions, paginate } from "./pagination";

export type OtpServerClientOptions = OtpTransportOptions & {
  /**
   * Allow constructing the server client where `window`/`document` exist
   * (e.g. jsdom tests). Never ship an `sk_` key to real browsers.
   */
  dangerouslyAllowBrowser?: boolean;
};

export type OtpListOptions = OtpRequestOptions & PaginateOptions;

export type OtpServerClient = {
  /** `POST /v1/issue`. Requires `input.idempotencyKey`. */
  issue: (
    input: IssueInput,
    options?: OtpRequestOptions,
  ) => Promise<IssueResult>;
  /** `POST /v1/verify`. */
  verify: (
    input: VerifyInput,
    options?: OtpRequestOptions,
  ) => Promise<VerifyResult>;
  /** `GET /v1/status?issueId=` - verification + delivery status. */
  getStatus: (
    input: GetStatusInput,
    options?: OtpRequestOptions,
  ) => Promise<GetStatusResult>;
  /** `GET /v1/issues` - one page of the PII-free issue history. */
  listIssues: (
    input?: ListIssuesInput,
    options?: OtpRequestOptions,
  ) => Promise<ListIssuesResult>;
  /** Iterates all issues matching `input`, following `nextCursor`. */
  iterateIssues: (
    input?: ListIssuesInput,
    options?: OtpListOptions,
  ) => AsyncGenerator<OtpIssue, void, undefined>;
  /** `GET /v1/issues/{issueId}`. */
  getIssue: (
    input: GetIssueInput,
    options?: OtpRequestOptions,
  ) => Promise<GetIssueResult>;
  /** `GET /v1/credit-ledger` - one page of wallet ledger entries. */
  listCreditLedger: (
    input?: ListCreditLedgerInput,
    options?: OtpRequestOptions,
  ) => Promise<ListCreditLedgerResult>;
  /** Iterates all ledger entries matching `input`, following `nextCursor`. */
  iterateCreditLedger: (
    input?: ListCreditLedgerInput,
    options?: OtpListOptions,
  ) => AsyncGenerator<CreditLedgerEntry, void, undefined>;
  /** `GET /v1/balance`. */
  getBalance: (options?: OtpRequestOptions) => Promise<GetBalanceResult>;
  /** `GET /v1/templates`. */
  listTemplates: (options?: OtpRequestOptions) => Promise<ListTemplatesResult>;
  /** `GET /v1/templates/{templateId}`. */
  getTemplate: (
    input: GetTemplateInput,
    options?: OtpRequestOptions,
  ) => Promise<GetTemplateResult>;
};

const isBrowser = (): boolean =>
  typeof (globalThis as { window?: unknown }).window !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined";

const assertSecretKey = (apiKey: string): void => {
  if (apiKey.startsWith("pk_")) {
    throw new TypeError(
      "@k-otp/sdk-server requires an sk_ secret key; received a pk_ public key. Use @k-otp/sdk-core in browsers with pk_ keys.",
    );
  }
};

/**
 * Creates a server-side client for every public `/v1` operation. Use it from
 * Node.js, Bun, Deno or edge runtimes (Cloudflare Workers, Vercel Edge) with
 * an `sk_` secret key. Creation performs no I/O.
 */
export const createOtpServerClient = (
  options: OtpServerClientOptions,
): OtpServerClient => {
  if (isBrowser() && !options.dangerouslyAllowBrowser) {
    throw new TypeError(
      "@k-otp/sdk-server must not run in a browser: it requires an sk_ secret key. Use @k-otp/sdk-core with a pk_ public key instead.",
    );
  }
  const transport = createOtpTransport(otpServerContract, options, {
    validateApiKey: assertSecretKey,
  });
  const { client, call } = transport;

  const listIssues: OtpServerClient["listIssues"] = (
    input = {},
    requestOptions,
  ) => call("listIssues", (o) => client.listIssues(input, o), requestOptions);
  const listCreditLedger: OtpServerClient["listCreditLedger"] = (
    input = {},
    requestOptions,
  ) =>
    call(
      "listCreditLedger",
      (o) => client.listCreditLedger(input, o),
      requestOptions,
    );

  return {
    issue: (input, requestOptions) =>
      issueWith(transport, input, requestOptions),
    verify: (input, requestOptions) =>
      verifyWith(transport, input, requestOptions),
    getStatus: (input, requestOptions) =>
      call("status", (o) => client.status(input, o), requestOptions),
    listIssues,
    iterateIssues: (input = {}, listOptions = {}) =>
      paginate((page) => listIssues(page, listOptions), input, listOptions),
    getIssue: (input, requestOptions) =>
      call("getIssue", (o) => client.getIssue(input, o), requestOptions),
    listCreditLedger,
    iterateCreditLedger: (input = {}, listOptions = {}) =>
      paginate(
        (page) => listCreditLedger(page, listOptions),
        input,
        listOptions,
      ),
    getBalance: (requestOptions) =>
      call("balance", (o) => client.balance(undefined, o), requestOptions),
    listTemplates: (requestOptions) =>
      call(
        "listTemplates",
        (o) => client.listTemplates(undefined, o),
        requestOptions,
      ),
    getTemplate: (input, requestOptions) =>
      call("getTemplate", (o) => client.getTemplate(input, o), requestOptions),
  };
};
