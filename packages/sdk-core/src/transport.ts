/**
 * Shared transport used by `@k-otp/sdk-core` and `@k-otp/sdk-server`:
 * oRPC `OpenAPILink` over the REST `/v1` API plus timeout, abort, telemetry
 * hooks and error normalization.
 *
 * Nothing here touches `window`/`document` at import time, and creating a
 * transport performs no I/O, so it is SSR- and edge-safe.
 */
import { createORPCClient, type ORPCError } from "@orpc/client";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { isBrowser } from "./env";
import {
  isOtpApiError,
  normalizeOtpApiError,
  OtpApiError,
  otpErrorFromResponse,
  readRequestId,
} from "./errors";
import type { OpenApiOperations } from "./generated/openapi";

/** Default API base URL (production). */
export const DEFAULT_BASE_URL = "https://api.k-otp.dev/v1";
/** Default per-request timeout. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Operation names, matching the OpenAPI `operationId` suffix. */
export type OtpOperation = keyof OpenApiOperations;

export type OtpRequestEndInfo = {
  /** Wall-clock duration including body decoding. */
  durationMs: number;
  requestId?: string | undefined;
  /** The normalized error when `ok` is false. */
  error?: OtpApiError | undefined;
};

/**
 * Observability hooks. They are called synchronously; exceptions thrown by a
 * hook are swallowed and never change SDK behavior.
 */
export type OtpTelemetryHooks = {
  onRequestStart?: (op: OtpOperation) => void;
  /** `status` is the HTTP status, or undefined when no response was received. */
  onRequestEnd?: (
    op: OtpOperation,
    ok: boolean,
    status?: number,
    info?: OtpRequestEndInfo,
  ) => void;
};

/** API key, or a (possibly async) function resolved before every request. */
export type OtpApiKey = string | (() => string | Promise<string>);

export type OtpTransportOptions = {
  /** API base URL including `/v1`. Default: `https://api.k-otp.dev/v1`. */
  baseUrl?: string;
  apiKey: OtpApiKey;
  /** Custom fetch implementation. Default: `globalThis.fetch` (resolved lazily). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default: 10000. `0` disables it. */
  timeoutMs?: number;
  /**
   * Extra request headers. `authorization` and `idempotency-key` are set by
   * the SDK and cannot be overridden here.
   */
  headers?: Record<string, string>;
  hooks?: OtpTelemetryHooks;
};

/** Transport-only options used by the SDK packages themselves. */
export type OtpTransportInternalOptions = {
  /** Throws (TypeError) when a resolved key must not be used by this client. */
  validateApiKey?: (apiKey: string) => void;
};

/** Per-call options accepted by every SDK method. */
export type OtpRequestOptions = {
  /** Cancels the request; rejects with `OtpApiError(ABORTED)`. */
  signal?: AbortSignal;
  /** Overrides the client-level timeout for this call. */
  timeoutMs?: number;
};

type ResponseCapture = {
  fetchStarted?: boolean;
  status?: number;
  headers?: Headers;
};
type TransportContext = {
  apiKey: string;
  fetch: typeof fetch;
  capture: ResponseCapture;
};

export type OtpCallOptions = {
  signal: AbortSignal;
  context: TransportContext;
};

export type OtpTransport<TContract extends AnyContractRouter> = {
  /** Typed oRPC client for `TContract`; always call it through `call`. */
  client: ContractRouterClient<TContract, TransportContext>;
  call: <T>(
    op: OtpOperation,
    execute: (options: OtpCallOptions) => Promise<T>,
    requestOptions?: OtpRequestOptions,
  ) => Promise<T>;
};

/** `https://x/v1/` -> `https://x/v1`; relative URLs resolve against `location`. */
export const resolveBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const location = (globalThis as { location?: { href?: string } }).location;
  if (location?.href) {
    return new URL(trimmed, location.href).href.replace(/\/+$/, "");
  }
  throw new TypeError(
    `baseUrl must be an absolute http(s) URL (received "${baseUrl}")`,
  );
};

/**
 * Header merge where `required` wins (case-insensitively) and `reserved`
 * names are dropped from `optional`.
 */
export const mergeHeaders = (
  required: Record<string, string>,
  optional: Record<string, string> | undefined,
  reserved: readonly string[] = [],
): Record<string, string> => {
  const requiredNames = new Set(
    [...Object.keys(required), ...reserved].map((name) => name.toLowerCase()),
  );
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(optional ?? {})) {
    if (!requiredNames.has(name.toLowerCase()))
      merged[name.toLowerCase()] = value;
  }
  return { ...merged, ...required };
};

const safeHook = (run: () => void): void => {
  try {
    run();
  } catch {
    // Telemetry must never change SDK behavior.
  }
};

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  ((error as { name?: unknown }).name === "AbortError" ||
    (error as { name?: unknown }).name === "TimeoutError");

export const resolveApiKey = async (apiKey: OtpApiKey): Promise<string> => {
  const key = (typeof apiKey === "function" ? await apiKey() : apiKey)?.trim();
  if (!key) throw new TypeError("apiKey is required");
  return key;
};

/**
 * Creates a transport bound to one contract. Internal building block shared
 * with `@k-otp/sdk-server`; not covered by SemVer outside the SDK packages.
 */
export const createOtpTransport = <TContract extends AnyContractRouter>(
  contract: TContract,
  options: OtpTransportOptions,
  internal: OtpTransportInternalOptions = {},
): OtpTransport<TContract> => {
  const validateApiKey = internal.validateApiKey;
  if (typeof options.apiKey === "string") {
    const key = options.apiKey.trim();
    if (!key) throw new TypeError("apiKey is required");
    validateApiKey?.(key);
  } else if (typeof options.apiKey !== "function") {
    throw new TypeError("apiKey is required");
  }
  const baseUrl = resolveBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userFetch = options.fetch;
  const hooks = options.hooks;

  const link = new OpenAPILink<TransportContext>(contract, {
    url: baseUrl,
    headers: ({ context }) =>
      // The per-call idempotency key (issue) must always be authoritative.
      mergeHeaders(
        { authorization: `Bearer ${context.apiKey}` },
        options.headers,
        ["idempotency-key"],
      ),
    fetch: async (request, init, callOptions) => {
      callOptions.context.capture.fetchStarted = true;
      const response = await callOptions.context.fetch(request, init);
      callOptions.context.capture.status = response.status;
      callOptions.context.capture.headers = response.headers;
      return response;
    },
    // The codec throws whatever this returns, so we can hand back our own
    // normalized error (with request id / Retry-After) instead of ORPCError.
    customErrorResponseBodyDecoder: (body, response) =>
      otpErrorFromResponse(
        response.status,
        body,
        response.headers,
      ) as unknown as ORPCError<string, unknown>,
  });

  const client =
    createORPCClient<ContractRouterClient<TContract, TransportContext>>(link);

  const call = async <T>(
    op: OtpOperation,
    execute: (callOptions: OtpCallOptions) => Promise<T>,
    requestOptions: OtpRequestOptions = {},
  ): Promise<T> => {
    // Configuration problems are programmer errors: they reject with a
    // TypeError before any hook or request, instead of an OtpApiError.
    const apiKey = await resolveApiKey(options.apiKey);
    validateApiKey?.(apiKey);
    const fetchImpl = userFetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new TypeError(
        "No fetch implementation found. Pass `fetch` in the client options.",
      );
    }
    const capture: ResponseCapture = {};
    const controller = new AbortController();
    const timeoutMs = requestOptions.timeoutMs ?? defaultTimeoutMs;
    const userSignal = requestOptions.signal;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onUserAbort = (): void => controller.abort(userSignal?.reason);
    if (userSignal?.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal?.addEventListener("abort", onUserAbort, { once: true });
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    const startedAt = now();
    if (hooks?.onRequestStart) {
      const onStart = hooks.onRequestStart;
      safeHook(() => onStart(op));
    }

    const end = (ok: boolean, error?: OtpApiError): void => {
      if (!hooks?.onRequestEnd) return;
      const onEnd = hooks.onRequestEnd;
      const status = error ? error.status || undefined : capture.status;
      const info: OtpRequestEndInfo = {
        durationMs: now() - startedAt,
        requestId: error?.requestId ?? readRequestId(capture.headers),
        ...(error ? { error } : {}),
      };
      safeHook(() => onEnd(op, ok, status, info));
    };

    try {
      if (controller.signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const result = await execute({
        signal: controller.signal,
        context: { apiKey, fetch: fetchImpl, capture },
      });
      end(true);
      return result;
    } catch (error) {
      const normalized = normalizeTransportError(error, {
        timedOut,
        timeoutMs,
        aborted: controller.signal.aborted,
        capture,
      });
      end(false, normalized);
      throw normalized;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      userSignal?.removeEventListener("abort", onUserAbort);
    }
  };

  return { client, call };
};

/**
 * Browsers report a CORS rejection as a plain network failure. The API sends
 * no CORS headers when a pk_ key is used from an origin outside its
 * allowedOrigins, so that is the most common cause in browsers.
 */
const BROWSER_NETWORK_HINT: string =
  " (In a browser this is also how a CORS rejection looks: if it works with curl, check that this page's origin is listed exactly - scheme, host and port - in the pk_ key's allowedOrigins.)";

/** The error or one of its causes (oRPC wraps body read failures). */
const findTypeError = (error: unknown): TypeError | undefined => {
  let current = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth++) {
    if (current instanceof TypeError) return current;
    current = current.cause;
  }
  return undefined;
};

const normalizeTransportError = (
  error: unknown,
  state: {
    timedOut: boolean;
    timeoutMs: number;
    aborted: boolean;
    capture: ResponseCapture;
  },
): OtpApiError => {
  if (isOtpApiError(error)) return error;
  if (state.timedOut) {
    return new OtpApiError({
      code: "TIMEOUT",
      status: 0,
      message: `K-OTP API request timed out after ${state.timeoutMs}ms`,
      cause: error,
    });
  }
  if (state.aborted || isAbortError(error)) {
    return new OtpApiError({
      code: "ABORTED",
      status: 0,
      message: "K-OTP API request was aborted",
      cause: error,
    });
  }
  const { status, headers } = state.capture;
  if (status !== undefined) {
    if (status >= 400) {
      // The error body could not be decoded (e.g. invalid JSON).
      const normalized = otpErrorFromResponse(status, undefined, headers);
      return new OtpApiError({
        code: normalized.code,
        status,
        message: normalized.message,
        requestId: normalized.requestId,
        retryAfterMs: normalized.retryAfterMs,
        cause: error,
      });
    }
    const interrupted = findTypeError(error);
    if (interrupted) {
      // The connection failed while the body was being read (a body that is
      // not valid JSON is a SyntaxError instead): same as a network failure.
      return new OtpApiError({
        code: "NETWORK_ERROR",
        status: 0,
        message: `K-OTP API response was interrupted: ${interrupted.message}`,
        requestId: readRequestId(headers),
        cause: error,
      });
    }
    return new OtpApiError({
      code: "UNKNOWN",
      status,
      message: `Unexpected K-OTP API response: ${
        error instanceof Error ? error.message : String(error)
      }`,
      requestId: readRequestId(headers),
      cause: error,
    });
  }
  if (state.capture.fetchStarted) {
    return new OtpApiError({
      code: "NETWORK_ERROR",
      status: 0,
      message: `K-OTP API request failed: ${
        error instanceof Error ? error.message : String(error)
      }${isBrowser() ? BROWSER_NETWORK_HINT : ""}`,
      cause: error,
    });
  }
  return normalizeOtpApiError(error);
};
