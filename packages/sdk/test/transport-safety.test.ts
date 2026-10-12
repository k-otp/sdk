import { expect, test } from "bun:test";
import { createOtpClient } from "../src/core/client";
import { isAmbiguousIssueError, OtpApiError } from "../src/core/errors";
import { createOtpFlow } from "../src/headless";
import { otpErrorMessageKey } from "../src/ui/messages";

const input = { phoneNumber: "01000000000", purpose: "login" };
test.each([200, 0])(
  "unreadable issue responses retain the same idempotency key (status %s)",
  async (status) => {
    const keys: (string | null)[] = [];
    let sequence = 0;
    const client = createOtpClient({
      apiKey: "pk_synthetic",
      fetch: (async (request: RequestInfo | URL, init?: RequestInit) => {
        keys.push(new Request(request, init).headers.get("idempotency-key"));
        if (status === 0) return Response.error();
        return new Response("{", {
          status,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    const flow = createOtpFlow(client, {
      createIdempotencyKey: () => `key-${++sequence}`,
    });
    await flow.send(input);
    expect(flow.getState().idempotencyKey).toBe("key-1");
    await flow.send(input);
    expect(keys).toEqual(["key-1", "key-1"]);
  },
);

const malformedSuccesses: [string, () => Response, number][] = [
  ["307 empty body", () => redirectResponse(307), 307],
  ["308 empty body", () => redirectResponse(308), 308],
  ["302 with a text body", () => new Response("moved", { status: 302 }), 302],
  ["200 empty body", () => new Response(null, { status: 200 }), 200],
  [
    "200 empty body with a JSON content type",
    () =>
      new Response("", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    200,
  ],
  ["204", () => new Response(null, { status: 204 }), 204],
  [
    "200 text/html",
    () =>
      new Response("<html>gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    200,
  ],
  ["200 JSON without issueId", () => Response.json({ ok: true }), 200],
  ["200 JSON null", () => Response.json(null), 200],
  ["200 JSON array", () => Response.json([]), 200],
];

function redirectResponse(status: number): Response {
  // `new Response(null, { status: 3xx })` is allowed; a Location header is
  // what a real redirect carries and must never be followed.
  return new Response(null, {
    status,
    headers: { location: "http://untrusted.invalid/v1/issue" },
  });
}

test.each(malformedSuccesses)(
  "issue %s is ambiguous: createOtpFlow keeps and reuses the idempotency key",
  async (_name, makeResponse, status) => {
    const keys: (string | null)[] = [];
    let sequence = 0;
    const client = createOtpClient({
      apiKey: "pk_synthetic",
      fetch: (async (request: RequestInfo | URL, init?: RequestInit) => {
        keys.push(new Request(request, init).headers.get("idempotency-key"));
        return makeResponse();
      }) as typeof fetch,
    });
    const flow = createOtpFlow(client, {
      createIdempotencyKey: () => `key-${++sequence}`,
    });
    const first = await flow.send(input);
    expect(first).toMatchObject({ error: { code: "UNKNOWN", status } });
    expect(flow.getState().idempotencyKey).toBe("key-1");
    expect(flow.getState().issueId).toBeUndefined();
    await flow.send(input);
    expect(keys).toEqual(["key-1", "key-1"]);
    expect(flow.getState().idempotencyKey).toBe("key-1");
  },
);

test("an opaque redirect (status 0) is an ambiguous UNKNOWN error", async () => {
  const opaque = Object.defineProperty(
    new Response(null, { status: 200 }),
    "type",
    { value: "opaqueredirect" },
  );
  const client = createOtpClient({
    apiKey: "pk_synthetic",
    fetch: (async () => opaque) as unknown as typeof fetch,
  });
  const error = await client
    .issue({ ...input, idempotencyKey: "key-1" })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OtpApiError);
  expect(isAmbiguousIssueError(error as OtpApiError)).toBe(true);
});

test("a malformed verify success is an UNKNOWN error, not a result", async () => {
  const client = createOtpClient({
    apiKey: "pk_synthetic",
    fetch: (async (_request: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 204 })) as typeof fetch,
  });
  expect(
    await client
      .verify({ issueId: "test", code: "000000" })
      .catch((e: unknown) => e),
  ).toMatchObject({ code: "UNKNOWN", status: 204 });
});

test("a well-formed issue success still resolves and drops the key", async () => {
  const client = createOtpClient({
    apiKey: "pk_synthetic",
    fetch: (async (_request: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        issueId: "iss_1",
        expiresAt: "2030-01-01T00:00:00Z",
        attemptsRemaining: 5,
        queuedAt: "2030-01-01T00:00:00Z",
      })) as typeof fetch,
  });
  let sequence = 0;
  const flow = createOtpFlow(client, {
    createIdempotencyKey: () => `key-${++sequence}`,
  });
  const result = await flow.send(input);
  expect(result).toMatchObject({ data: { issueId: "iss_1" } });
  expect(flow.getState().idempotencyKey).toBeUndefined();
});

test("remote HTTP and URL credentials are refused before resolving a secret", () => {
  for (const baseUrl of [
    "http://api.example/v1",
    "https://user:pass@api.example/v1",
    "https://api.example/v1?q=1",
    "https://api.example/v1#x",
    "//api.example/v1",
  ]) {
    expect(() => createOtpClient({ apiKey: "sk_synthetic", baseUrl })).toThrow(
      TypeError,
    );
  }
  expect(() =>
    createOtpClient({
      apiKey: "sk_synthetic",
      baseUrl: "http://localhost:8788/v1",
    }),
  ).not.toThrow();
});

test("*.localhost names are loopback and may use plain HTTP", () => {
  for (const host of [
    "app.localhost:3000",
    "a.b.localhost",
    "api.localhost.",
    "localhost",
  ]) {
    expect(() =>
      createOtpClient({ apiKey: "sk_synthetic", baseUrl: `http://${host}/v1` }),
    ).not.toThrow();
  }
  for (const host of [
    "evil-localhost.example",
    "localhost.example.com",
    "notlocalhost",
    "0.0.0.0",
    "host.docker.internal",
    "10.0.0.5",
  ]) {
    expect(() =>
      createOtpClient({ apiKey: "sk_synthetic", baseUrl: `http://${host}/v1` }),
    ).toThrow(TypeError);
  }
});

test("allowInsecureHttp is an explicit opt-in for remote HTTP only", () => {
  for (const baseUrl of [
    "http://host.docker.internal:8788/v1",
    "http://10.0.0.5/v1",
  ]) {
    expect(() =>
      createOtpClient({
        apiKey: "sk_synthetic",
        baseUrl,
        allowInsecureHttp: true,
      }),
    ).not.toThrow();
  }
  // It lifts the scheme rule only: credentials, query and fragment stay refused.
  for (const baseUrl of [
    "http://u:p@10.0.0.5/v1",
    "http://10.0.0.5/v1?x=1",
    "http://10.0.0.5/v1#x",
    "ftp://10.0.0.5/v1",
  ]) {
    expect(() =>
      createOtpClient({
        apiKey: "sk_synthetic",
        baseUrl,
        allowInsecureHttp: true,
      }),
    ).toThrow(TypeError);
  }
  // false/undefined keep the default.
  expect(() =>
    createOtpClient({
      apiKey: "sk_synthetic",
      baseUrl: "http://10.0.0.5/v1",
      allowInsecureHttp: false,
    }),
  ).toThrow(TypeError);
});

test("a custom fetch alone does not lift the HTTPS requirement", () => {
  expect(() =>
    createOtpClient({
      apiKey: "sk_synthetic",
      baseUrl: "http://api.example/v1",
      fetch: (async (_request: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({})) as typeof fetch,
    }),
  ).toThrow(TypeError);
});

test("a relative baseUrl inherits the page scheme", () => {
  const original = (globalThis as { location?: unknown }).location;
  const setLocation = (href: string | undefined) => {
    Object.defineProperty(globalThis, "location", {
      value: href === undefined ? undefined : { href },
      configurable: true,
      writable: true,
    });
  };
  try {
    setLocation("https://app.example/page");
    expect(() =>
      createOtpClient({ apiKey: "pk_synthetic", baseUrl: "/v1" }),
    ).not.toThrow();
    setLocation("http://intranet.example/page");
    expect(() =>
      createOtpClient({ apiKey: "pk_synthetic", baseUrl: "/v1" }),
    ).toThrow(TypeError);
    expect(() =>
      createOtpClient({
        apiKey: "pk_synthetic",
        baseUrl: "/v1",
        allowInsecureHttp: true,
      }),
    ).not.toThrow();
    setLocation("http://localhost:5173/page");
    expect(() =>
      createOtpClient({ apiKey: "pk_synthetic", baseUrl: "/v1" }),
    ).not.toThrow();
    setLocation(undefined);
    expect(() =>
      createOtpClient({ apiKey: "pk_synthetic", baseUrl: "/v1" }),
    ).toThrow(TypeError);
  } finally {
    Object.defineProperty(globalThis, "location", {
      value: original,
      configurable: true,
      writable: true,
    });
  }
});

test("key resolution is bounded by the request timeout and never sends late", async () => {
  let resolveKey: (key: string) => void = () => {};
  let sends = 0;
  const client = createOtpClient({
    apiKey: () =>
      new Promise<string>((resolve) => {
        resolveKey = resolve;
      }),
    timeoutMs: 5,
    fetch: (async (_request: RequestInfo | URL, _init?: RequestInit) => {
      sends++;
      return Response.json({});
    }) as typeof fetch,
  });
  expect(
    await client
      .verify({ issueId: "test", code: "000000" })
      .catch((error: unknown) => error),
  ).toMatchObject({ code: "TIMEOUT" });
  resolveKey("pk_synthetic");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(sends).toBe(0);
});

test("caller abort interrupts a pending resolver and rejects without HTTP", async () => {
  const abort = new AbortController();
  const client = createOtpClient({
    apiKey: () => new Promise<string>(() => {}),
    timeoutMs: 0,
  });
  const pending = client.verify(
    { issueId: "test", code: "000000" },
    { signal: abort.signal },
  );
  abort.abort();
  expect(await pending.catch((error: unknown) => error)).toMatchObject({
    code: "ABORTED",
  });
});

test("the transport never automatically follows a redirect", async () => {
  let redirect: RequestRedirect | undefined;
  const client = createOtpClient({
    apiKey: "sk_synthetic",
    fetch: (async (_request: RequestInfo | URL, init?: RequestInit) => {
      redirect = init?.redirect;
      return new Response(null, {
        status: 307,
        headers: { location: "http://untrusted.invalid" },
      });
    }) as typeof fetch,
  });
  await client.verify({ issueId: "test", code: "000000" }).catch(() => {});
  expect(redirect).toBe("manual");
});

test("UI and public helper agree on ambiguous issue outcomes", () => {
  for (const status of [0, 200, 307]) {
    const error = new OtpApiError({
      code: "UNKNOWN",
      status,
      message: "unreadable",
    });
    expect(isAmbiguousIssueError(error)).toBe(true);
    expect(otpErrorMessageKey(error, "send")).toBe("error.sendUncertain");
  }
});
test("canonical loopback variants are allowed without exposing invalid URL secrets", () => {
  for (const host of [
    "127.0.0.2",
    "127.255.255.255",
    "[::1]",
    "[::ffff:127.0.0.1]",
    "localhost.",
  ]) {
    expect(() =>
      createOtpClient({ apiKey: "sk_test", baseUrl: `http://${host}/v1` }),
    ).not.toThrow();
  }
  for (const host of ["128.0.0.1", "[::ffff:10.0.0.1]", "127.evil.example"]) {
    expect(() =>
      createOtpClient({ apiKey: "sk_test", baseUrl: `http://${host}/v1` }),
    ).toThrow();
  }
  try {
    createOtpClient({
      apiKey: "sk_test",
      baseUrl: "https://user:private-secret@example.com/v1",
    });
  } catch (error) {
    expect(String(error)).not.toContain("private-secret");
  }
});
