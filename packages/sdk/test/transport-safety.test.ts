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
