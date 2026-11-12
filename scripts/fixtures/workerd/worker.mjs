import { createOtpClient } from "../../../packages/sdk/dist/core.js";
import {
  KotpClient,
  KotpTransportError,
} from "../../../packages/sdk/dist/kiota.js";
import { createOtpServerClient } from "../../../packages/sdk/dist/server.js";

const baseUrl = "https://sdk.test/v1";
const input = {
  phoneNumber: "01000000000",
  purpose: "login",
  idempotencyKey: "workerd-receiver",
};
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export const nativeReceiver = {
  async test() {
    // A negative control proves this runtime actually rejects the original
    // calling convention; permissive Node/Bun mocks cannot provide that proof.
    const holder = { fetch: globalThis.fetch };
    let rejected = false;
    try {
      await holder.fetch("data:text/plain,receiver");
    } catch (error) {
      rejected =
        error instanceof TypeError &&
        error.message.includes("Illegal invocation");
    }
    assert(rejected, "Runtime did not enforce the native fetch receiver");
  },
};
export const core = {
  async test() {
    const client = createOtpClient({ apiKey: "pk_test_receiver", baseUrl });
    assert(
      (await client.issue(input)).attemptsRemaining === 5,
      "Default core fetch failed",
    );
    assert(
      (await client.verify({ issueId: "i_receiver", code: "000000" }))
        .verified === false,
      "Default core verify failed",
    );
  },
};
export const server = {
  async test() {
    const client = createOtpServerClient({
      apiKey: "sk_test_receiver",
      baseUrl,
    });
    assert(
      (await client.issue(input)).attemptsRemaining === 5,
      "Default server fetch failed",
    );
    assert(
      (await client.getBalance()).balance === 42,
      "Default server balance failed",
    );
  },
};
export const kiota = {
  async test() {
    const client = new KotpClient({ apiKey: "sk_test_receiver", baseUrl });
    assert(
      (await client.issue(input)).attemptsRemaining === 5,
      "Default Kiota fetch failed",
    );
    assert(
      (await client.balance()).balance === 42,
      "Default Kiota balance failed",
    );
  },
};
export const redirects = {
  async test() {
    const options = { apiKey: "sk_test_receiver", baseUrl };
    for (const client of [
      createOtpClient(options),
      createOtpServerClient(options),
      new KotpClient(options),
    ]) {
      let rejected = false;
      try {
        await client.issue({ ...input, purpose: "redirect" });
      } catch (error) {
        rejected =
          error instanceof KotpTransportError
            ? error.outcome === "unknown" &&
              error.cause?.message === "Unexpected K-OTP API redirect"
            : error.code === "UNKNOWN" && error.status === 307;
      }
      assert(
        rejected,
        "Redirect must be rejected without following its destination",
      );
    }
  },
};
export const customFetch = {
  async test() {
    let calls = 0;
    const custom = (request, init) => {
      calls++;
      return globalThis.fetch(request, init);
    };
    const options = { apiKey: "sk_test_receiver", baseUrl, fetch: custom };
    for (const client of [
      createOtpClient(options),
      createOtpServerClient(options),
      new KotpClient(options),
    ])
      await client.issue(input);
    assert(calls === 3, "Custom fetch was not used exactly once per client");
  },
};
