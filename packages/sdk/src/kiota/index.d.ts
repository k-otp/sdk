/** Server client using the official Kiota request builders and runtimes. */
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
export declare class KotpApiError extends Error {
  readonly envelope: Record<string, unknown>;
  readonly status: number;
  readonly headers: Record<string, string[]>;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  constructor(error: NativeError);
}
export declare class KotpTransportError extends Error {
  readonly outcome: "unknown";
  constructor(cause: unknown);
}
export declare class KotpClient {
  constructor(options: ClientOptions);
  issue(
    input: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<unknown>;
  verify(
    input: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<unknown>;
  status(issueId: string, options?: RequestOptions): Promise<unknown>;
  issues(
    query?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<unknown>;
  issueDetail(issueId: string, options?: RequestOptions): Promise<unknown>;
  creditLedger(
    query?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<unknown>;
  balance(options?: RequestOptions): Promise<unknown>;
  templates(options?: RequestOptions): Promise<unknown>;
  templateDetail(
    templateId: string,
    options?: RequestOptions,
  ): Promise<unknown>;
}
