import { expect, test } from "bun:test";
import { createOtpClient } from "../src/core";
import { createOtpServerClient } from "../src/server";
import { issueOutput, json, mockFetch } from "./helpers";

const issueInput = {
  phoneNumber: "01000000000",
  purpose: "login",
  idempotencyKey: "receiver-test",
};

test.each(["core", "server"] as const)(
  "%s calls the default fetch with the global receiver",
  async (kind) => {
    const original = globalThis.fetch;
    const mock = mockFetch(() => json(200, issueOutput));
    globalThis.fetch = async function (this: unknown, input, init) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return mock.fetch(input, init);
    } as typeof fetch;
    try {
      const options = { apiKey: `${kind === "core" ? "pk" : "sk"}_fake` };
      const client =
        kind === "core"
          ? createOtpClient(options)
          : createOtpServerClient(options);
      expect(mock.calls).toHaveLength(0);
      expect(await client.issue(issueInput)).toEqual(issueOutput);
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0]?.headers.get("authorization")).toBe(
        `Bearer ${options.apiKey}`,
      );
      expect(mock.calls[0]?.headers.get("idempotency-key")).toBe(
        issueInput.idempotencyKey,
      );
      expect(mock.calls[0]?.body).toEqual(issueInput);
    } finally {
      globalThis.fetch = original;
    }
  },
);

test("default fetch stays lazy and is resolved again for each request", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const first = mockFetch(() => json(200, issueOutput));
  const second = mockFetch(() => json(200, issueOutput));
  try {
    Reflect.deleteProperty(globalThis, "fetch");
    const client = createOtpClient({ apiKey: "pk_fake" });
    const missing = await client
      .issue(issueInput)
      .catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(TypeError);
    expect((missing as Error).message).toContain(
      "No fetch implementation found",
    );
    globalThis.fetch = first.fetch;
    await client.issue(issueInput);
    globalThis.fetch = second.fetch;
    await client.issue(issueInput);
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "fetch", descriptor);
    else Reflect.deleteProperty(globalThis, "fetch");
  }
});

test("custom fetch is used without binding it to the global receiver", async () => {
  const original = globalThis.fetch;
  const mock = mockFetch(() => json(200, issueOutput));
  globalThis.fetch = mockFetch(() => {
    throw new Error("Unexpected default fetch");
  }).fetch;
  const customFetch = async function (
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    expect(this).not.toBe(globalThis);
    return mock.fetch(input, init);
  } as typeof fetch;
  try {
    const client = createOtpClient({ apiKey: "pk_fake", fetch: customFetch });
    expect(await client.issue(issueInput)).toEqual(issueOutput);
    expect(mock.calls).toHaveLength(1);
  } finally {
    globalThis.fetch = original;
  }
});
