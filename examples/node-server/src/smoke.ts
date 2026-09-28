/** Starts the handler on a random port with the mock API and runs the flow. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createOtpServerClient } from "@k-otp/sdk-server";
import { createHandler } from "./app.ts";
import { mockFetch } from "./mock-fetch.ts";

const server = createServer(
  createHandler(createOtpServerClient({ apiKey: "sk_mock", fetch: mockFetch })),
);
await new Promise<void>((resolve) => server.listen(0, resolve));
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
let cookie = "";
const post = async (path: string, body: unknown) => {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
};

try {
  assert.equal(
    (await post("/api/otp/send", { phoneNumber: "abc" })).status,
    400,
  );
  assert.equal(
    (await post("/api/otp/send", { phoneNumber: "010-1234-5678" })).status,
    200,
  );
  const wrong = await post("/api/otp/verify", { code: "000000" });
  assert.deepEqual(wrong.body, {
    verified: false,
    reasonCode: "MISMATCH",
    attemptsRemaining: 4,
  });
  const right = await post("/api/otp/verify", { code: "123456" });
  assert.equal(right.body.verified, true);
  console.log("ok - node-server send/verify (mock)");
} finally {
  server.close();
}
