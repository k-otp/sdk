import {
  AnonymousAuthenticationProvider,
  type Parsable,
  type RequestConfiguration,
  type SerializationWriter,
} from "@microsoft/kiota-abstractions";
import { DefaultRequestAdapter } from "@microsoft/kiota-bundle";
import {
  CustomFetchHandler,
  HttpClient,
} from "@microsoft/kiota-http-fetchlibrary";
import { JsonSerializationWriter } from "@microsoft/kiota-serialization-json";
import { serializeBalanceGetResponse } from "../generated/balance";
import { serializeCreditLedgerGetResponse } from "../generated/creditLedger";
import {
  createIssuePostRequestBodyFromDiscriminatorValue,
  serializeIssuePostResponse,
} from "../generated/issue";
import { serializeIssuesGetResponse } from "../generated/issues";
import { serializeWithIssueGetResponse } from "../generated/issues/item";
import { createKOtpApiClient } from "../generated/kOtpApiClient";
import { serializeStatusGetResponse } from "../generated/status";
import { serializeTemplatesGetResponse } from "../generated/templates";
import { serializeWithTemplateGetResponse } from "../generated/templates/item";
import {
  createVerifyPostRequestBodyFromDiscriminatorValue,
  serializeVerifyPostResponse,
} from "../generated/verify";
import { jsonValue, KotpJsonParseNodeFactory, model } from "./compatibility";

export interface RequestOptions {
  headers?: Record<string, string>;
  origin?: string;
  retry503?: boolean;
}
export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
type NativeError = {
  responseStatusCode?: number;
  responseHeaders?: Headers | Record<string, string | string[]>;
  defined?: boolean;
  code?: string;
  status?: number;
  message?: string;
  messageEscaped?: string;
  data?: unknown;
  additionalData?: Record<string, unknown>;
};
export class KotpApiError extends Error {
  readonly envelope: Record<string, unknown>;
  readonly status: number;
  readonly headers: Record<string, string[]>;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  constructor(error: NativeError) {
    super(error.messageEscaped ?? error.message ?? "K-OTP API request failed");
    this.name = "KotpApiError";
    this.status = error.responseStatusCode ?? 0;
    this.envelope = {
      defined: error.defined,
      code: error.code,
      status: error.status,
      message: this.message,
      data: jsonValue(error.data ?? error.additionalData?.data),
    };
    const entries =
      error.responseHeaders instanceof Headers
        ? [...error.responseHeaders.entries()]
        : Object.entries(error.responseHeaders ?? {});
    this.headers = Object.fromEntries(
      entries.map(([key, value]) => [
        key.toLowerCase(),
        Array.isArray(value) ? value : [value],
      ]),
    );
    this.requestId = this.headers["x-request-id"]?.[0];
    const data = this.envelope.data as { retryAfterMs?: unknown } | undefined;
    const bodyMs = data?.retryAfterMs;
    const seconds = this.headers["retry-after"]?.[0];
    if (typeof bodyMs === "number" && Number.isFinite(bodyMs) && bodyMs >= 0)
      this.retryAfterMs = bodyMs;
    else if (seconds && /^\d+$/.test(seconds))
      this.retryAfterMs = Number(seconds) * 1000;
  }
}
export class KotpTransportError extends Error {
  readonly outcome = "unknown";
  constructor(cause: unknown) {
    super("The request outcome is unknown", { cause });
    this.name = "KotpTransportError";
  }
}
type Serializer = (
  writer: SerializationWriter,
  value: Parsable | undefined | null,
) => void;
const serializers: Record<string, Serializer> = {
  issue: serializeIssuePostResponse,
  verify: serializeVerifyPostResponse,
  status: serializeStatusGetResponse,
  issues: serializeIssuesGetResponse,
  issueDetail: serializeWithIssueGetResponse,
  creditLedger: serializeCreditLedgerGetResponse,
  balance: serializeBalanceGetResponse,
  templates: serializeTemplatesGetResponse,
  templateDetail: serializeWithTemplateGetResponse,
};

export class KotpClient {
  private readonly api: ReturnType<typeof createKOtpApiClient>;
  constructor(options: ClientOptions) {
    const apiKey = options.apiKey;
    if (!/^sk_[!-~]+$/.test(apiKey))
      throw new TypeError("A server secret key is required");
    const base = new URL(options.baseUrl ?? "https://api.k-otp.dev/v1");
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !(
        base.protocol === "https:" ||
        (base.protocol === "http:" && base.hostname === "127.0.0.1")
      )
    )
      throw new TypeError(
        "An HTTPS API base URL or loopback HTTP URL is required",
      );
    const timeout = options.timeoutMs ?? 10000;
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw new TypeError("timeoutMs must be positive");
    const transport = options.fetch ?? globalThis.fetch;
    const scopedFetch = async (request: string, init: RequestInit) => {
      if (new URL(request).origin !== base.origin)
        throw new TypeError(
          "Request destination differs from the configured API origin",
        );
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${apiKey}`);
      const signal = init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout);
      try {
        return await transport(request, {
          ...init,
          headers,
          signal,
          redirect: "error",
        });
      } catch (cause) {
        throw new KotpTransportError(cause);
      }
    };
    const adapter = new DefaultRequestAdapter(
      new AnonymousAuthenticationProvider(),
      new KotpJsonParseNodeFactory(),
      undefined,
      new HttpClient(scopedFetch, new CustomFetchHandler(scopedFetch)),
    );
    adapter.baseUrl = base.href;
    this.api = createKOtpApiClient(adapter);
  }
  issue(input: Record<string, unknown>, options: RequestOptions = {}) {
    return this.send("issue", input, {}, "", options);
  }
  verify(input: Record<string, unknown>, options: RequestOptions = {}) {
    return this.send("verify", input, {}, "", options);
  }
  status(issueId: string, options: RequestOptions = {}) {
    return this.send("status", {}, { issueId }, "", options);
  }
  issues(query: Record<string, unknown> = {}, options: RequestOptions = {}) {
    return this.send("issues", {}, query, "", options);
  }
  issueDetail(issueId: string, options: RequestOptions = {}) {
    return this.send("issueDetail", {}, {}, issueId, options);
  }
  creditLedger(
    query: Record<string, unknown> = {},
    options: RequestOptions = {},
  ) {
    return this.send("creditLedger", {}, query, "", options);
  }
  balance(options: RequestOptions = {}) {
    return this.send("balance", {}, {}, "", options);
  }
  templates(options: RequestOptions = {}) {
    return this.send("templates", {}, {}, "", options);
  }
  templateDetail(templateId: string, options: RequestOptions = {}) {
    return this.send("templateDetail", {}, {}, templateId, options);
  }

  private async send(
    operation: string,
    input: Record<string, unknown>,
    query: Record<string, unknown>,
    path: string,
    options: RequestOptions,
  ): Promise<unknown> {
    input = structuredClone(input);
    query = structuredClone(query);
    const retry503 = options.retry503 === true;
    const headers = { ...options.headers };
    if (
      Object.keys(headers).some((key) =>
        ["authorization", "idempotency-key"].includes(key.toLowerCase()),
      )
    )
      throw new TypeError(
        "Authentication and idempotency headers are managed by the client",
      );
    const config: RequestConfiguration<Record<string, unknown>> = {
      headers,
      queryParameters: query,
    };
    let key = "";
    if (operation === "issue") {
      key =
        typeof input.idempotencyKey === "string"
          ? input.idempotencyKey.trim()
          : "";
      if (!/^[!-~]{1,128}$/.test(key))
        throw new TypeError("Invalid issue idempotency key before HTTP");
      headers["Idempotency-Key"] = key;
      if (options.origin) headers.Origin = options.origin;
    }
    const call = () => {
      switch (operation) {
        case "issue":
          return this.api.issue.post(
            model(
              { ...input, idempotencyKey: key },
              createIssuePostRequestBodyFromDiscriminatorValue,
            ),
            config,
          );
        case "verify":
          return this.api.verify.post(
            model(input, createVerifyPostRequestBodyFromDiscriminatorValue),
            config,
          );
        case "status":
          return this.api.status.get(config);
        case "issues":
          return this.api.issues.get(config);
        case "issueDetail":
          return this.api.issues.byIssueId(path).get(config);
        case "creditLedger":
          return this.api.creditLedger.get(config);
        case "balance":
          return this.api.balance.get(config);
        case "templates":
          return this.api.templates.get(config);
        case "templateDetail":
          return this.api.templates.byTemplateId(path).get(config);
        default:
          throw new TypeError("Unknown operation");
      }
    };
    try {
      let value: Parsable | undefined;
      try {
        value = await call();
      } catch (error) {
        if (
          operation === "issue" &&
          retry503 &&
          (error as NativeError)?.responseStatusCode === 503
        )
          value = await call();
        else throw error;
      }
      const serializer = serializers[operation];
      if (!serializer) throw new TypeError("Unknown response serializer");
      const writer = new JsonSerializationWriter();
      writer.writeObjectValue(undefined, value ?? null, serializer);
      return JSON.parse(
        new TextDecoder().decode(writer.getSerializedContent()),
      );
    } catch (error) {
      if (typeof (error as NativeError)?.responseStatusCode === "number")
        throw new KotpApiError(error as NativeError);
      if (
        error instanceof DOMException &&
        ["TimeoutError", "AbortError"].includes(error.name)
      )
        throw new KotpTransportError(error);
      throw error;
    }
  }
}
