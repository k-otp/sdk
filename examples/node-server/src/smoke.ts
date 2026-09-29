/** Starts the handler on a random port with the mock API and runs the flow. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createOtpServerClient } from "@k-otp/sdk-server";
import { createHandler } from "./app.ts";
import { mockFetch } from "./mock-fetch.ts";

// Records the idempotency key of every issue request; `failNextIssue` makes
// the next one fail like a dropped connection (an ambiguous outcome).
const issueKeys: string[] = [];
let failNextIssue = false;
const apiFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  if (new URL(request.url).pathname.endsWith("/issue")) {
    const body = (await request.clone().json()) as { idempotencyKey: string };
    issueKeys.push(body.idempotencyKey);
    if (failNextIssue) {
      failNextIssue = false;
      throw new TypeError("fetch failed");
    }
  }
  return mockFetch(request);
};

const server = createServer(
  createHandler(createOtpServerClient({ apiKey: "sk_mock", fetch: apiFetch })),
);
await new Promise<void>((resolve) => server.listen(0, resolve));
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
let cookie = "";
const post = async (path: string, body: unknown) => {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
};

try {
  assert.equal((await post("/api/otp/send", "{not json")).status, 400);
  // An oversize body gets the 400 (drained), not a connection reset.
  const huge = await post("/api/otp/send", `"${"x".repeat(50_000)}"`);
  assert.deepEqual(huge, { status: 400, body: { error: "INVALID_BODY" } });
  assert.equal(
    (await post("/api/otp/send", { phoneNumber: "abc" })).status,
    400,
  );
  // Past the drain cap the server gives up and drops the connection without
  // writing to the destroyed socket.
  await assert.rejects(post("/api/otp/send", "x".repeat(2_000_000)));

  // An ambiguous failure keeps the key; the retry of the same send reuses it.
  failNextIssue = true;
  assert.equal(
    (await post("/api/otp/send", { phoneNumber: "010-1234-5678" })).status,
    503,
  );
  assert.equal(
    (await post("/api/otp/send", { phoneNumber: "010-1234-5678" })).status,
    200,
  );
  assert.equal(issueKeys.length, 2);
  assert.equal(issueKeys[1], issueKeys[0]);

  const wrong = await post("/api/otp/verify", { code: "000000" });
  assert.deepEqual(wrong.body, {
    verified: false,
    reasonCode: "MISMATCH",
    attemptsRemaining: 4,
  });
  const right = await post("/api/otp/verify", { code: "123456" });
  assert.equal(right.body.verified, true);
  // A double submit stays verified (the API would say ALREADY_VERIFIED).
  const again = await post("/api/otp/verify", { code: "123456" });
  assert.equal(again.body.verified, true);

  // A new send after success is a new attempt with a new key.
  assert.equal(
    (await post("/api/otp/send", { phoneNumber: "010-1234-5678" })).status,
    200,
  );
  assert.notEqual(issueKeys.at(-1), issueKeys[0]);
  console.log("ok - node-server send/verify (mock, ambiguous retry)");
} finally {
  server.close();
  // Keep-alive sockets of fetch would otherwise hold the process open.
  server.closeAllConnections();
}
