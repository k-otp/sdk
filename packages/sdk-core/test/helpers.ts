export type RecordedRequest = {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal;
};

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

/** A fetch mock that records every request and answers via `handler`. */
export const mockFetch = (
  handler: Handler,
): { fetch: typeof fetch; calls: RecordedRequest[] } => {
  const calls: RecordedRequest[] = [];
  const impl = async (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const text =
      request.method === "GET" || request.method === "HEAD"
        ? ""
        : await request.text();
    const recorded: RecordedRequest = {
      url: new URL(request.url),
      method: request.method,
      headers: request.headers,
      body: text ? JSON.parse(text) : undefined,
      signal: request.signal,
    };
    calls.push(recorded);
    return handler(recorded);
  };
  return { fetch: impl as typeof fetch, calls };
};

export const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const errorEnvelope = (
  status: number,
  code: string,
  message: string,
  data?: unknown,
  headers?: Record<string, string>,
): Response =>
  json(
    status,
    {
      defined: true,
      code,
      status,
      message,
      ...(data === undefined ? {} : { data }),
    },
    headers,
  );

/** Resolves when `signal` aborts, rejecting like a real fetch would. */
export const hangUntilAborted = (signal: AbortSignal): Promise<Response> =>
  new Promise((_, reject) => {
    const fail = () =>
      reject(new DOMException("The operation was aborted.", "AbortError"));
    if (signal.aborted) fail();
    signal.addEventListener("abort", fail, { once: true });
  });

export const issueOutput = {
  issueId: "0f5b5c9e-1c1a-4c63-9d0c-6d1d2c6b7a10",
  expiresAt: "2026-09-29T00:03:00.000Z",
  attemptsRemaining: 5,
  queuedAt: "2026-09-29T00:00:00.000Z",
};

export const verifyOutput = {
  issueId: issueOutput.issueId,
  verified: true,
  attemptsRemaining: 4,
  expiresAt: issueOutput.expiresAt,
  verifiedAt: "2026-09-29T00:01:00.000Z",
};
