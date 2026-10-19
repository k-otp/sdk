/**
 * Source compatibility with `@k-otp/sdk` 2.0.0: 2.x minor releases may add
 * and deprecate, never remove.
 *
 * `test/compat-2.0/*.ts` re-export every name (values and types) each subpath
 * exported in 2.0.0, so `bun run typecheck` fails when one disappears and this
 * test fails when a value export is gone at runtime. The type-level checks
 * below keep the 2.0.0 shapes compiling (`channel: "sms"`, `webOtp`, the old
 * aliases, the optional balance fields); deprecated members stay until the
 * next major version.
 */
import { describe, expect, test } from "bun:test";
import {
  createOtpClient,
  type GetBalanceResult,
  getIssueRequestErrorCode,
  type IssueInput,
  type IssueResult,
  type OtpChannel,
  type OtpPaymentRequiredData,
  type OtpRateLimitedData,
  type PaymentRequiredData,
  type RateLimitedData,
} from "../src/core";
import type {
  IssueOtpInput,
  IssueOtpOutput,
  IssueWebOtpOptions,
  IssueWebOtpResult,
  OpenApiOperations,
} from "../src/core/contract";
import type { RequestOptions as KiotaRequestOptions } from "../src/kiota";
import type { OtpFormConfig, ReceiveWebOtpOptions } from "../src/ui";
import type { OtpCodeInputProps as ReactCodeInputProps } from "../src/ui/react";
import type { OtpCodeInputProps as VueCodeInputProps } from "../src/ui/vue";
import { errorEnvelope, mockFetch } from "./helpers";
import { registerSvelteServerPlugin } from "./svelte-server-plugin";

// `@k-otp/sdk/ui/svelte` exports `.svelte` sources: compile them for SSR.
registerSvelteServerPlugin();

const SUBPATHS = {
  "@k-otp/sdk": () => import("./compat-2.0/core"),
  "@k-otp/sdk/headless": () => import("./compat-2.0/headless"),
  "@k-otp/sdk/contract": () => import("./compat-2.0/contract"),
  "@k-otp/sdk/testing": () => import("./compat-2.0/testing"),
  "@k-otp/sdk/server": () => import("./compat-2.0/server"),
  "@k-otp/sdk/server (browser)": () => import("./compat-2.0/server-browser"),
  "@k-otp/sdk/react": () => import("./compat-2.0/react"),
  "@k-otp/sdk/vue": () => import("./compat-2.0/vue"),
  "@k-otp/sdk/svelte": () => import("./compat-2.0/svelte"),
  "@k-otp/sdk/ui": () => import("./compat-2.0/ui"),
  "@k-otp/sdk/ui/react": () => import("./compat-2.0/ui-react"),
  "@k-otp/sdk/ui/vue": () => import("./compat-2.0/ui-vue"),
  "@k-otp/sdk/ui/svelte": () => import("./compat-2.0/ui-svelte"),
};

describe("@k-otp/sdk 2.0.0 compatibility", () => {
  test.each(Object.entries(SUBPATHS))(
    "%s still exports every 2.0.0 value",
    async (_, load) => {
      const values = Object.entries(await load());
      expect(values.length).toBeGreaterThan(0);
      for (const [name, value] of values) {
        expect([name, value === undefined]).toEqual([name, false]);
      }
    },
  );

  test("deprecated issue options are still sent, so the API's 400 reaches the caller", async () => {
    const { fetch, calls } = mockFetch(({ body }) => {
      const { channel } = body as { channel?: string };
      const code =
        channel === "sms" ? "CHANNEL_NOT_SUPPORTED" : "WEB_OTP_NOT_SUPPORTED";
      return errorEnvelope(400, "BAD_REQUEST", `${code}: rejected`, { code });
    });
    const client = createOtpClient({ apiKey: "pk_test_compat", fetch });
    const base = { phoneNumber: "01012345678", purpose: "signup" };
    const inputs: IssueInput[] = [
      { ...base, idempotencyKey: "k1", channel: "sms" },
      { ...base, idempotencyKey: "k2", webOtp: true },
      {
        ...base,
        idempotencyKey: "k3",
        webOtp: { origin: "https://www.example.com" },
      },
    ];
    const codes: unknown[] = [];
    for (const input of inputs) {
      codes.push(
        getIssueRequestErrorCode(
          await client.issue(input).catch((error: unknown) => error),
        ),
      );
    }
    expect(codes).toEqual([
      "CHANNEL_NOT_SUPPORTED",
      "WEB_OTP_NOT_SUPPORTED",
      "WEB_OTP_NOT_SUPPORTED",
    ]);
    expect(calls.map((call) => call.body)).toEqual([
      { ...base, idempotencyKey: "k1", channel: "sms" },
      { ...base, idempotencyKey: "k2", webOtp: true },
      {
        ...base,
        idempotencyKey: "k3",
        webOtp: { origin: "https://www.example.com" },
      },
    ]);
  });

  test("2.0.0 type shapes still compile (compile-time)", () => {
    // Checked by `bun run typecheck`; the test body only has to run.
    const sms: OtpChannel = "sms";
    const alimtalk: OtpChannel = "alimtalk";
    const webOtpOptions: IssueWebOtpOptions = { origin: "https://a.example" };
    const webOtpResult: IssueWebOtpResult = {
      status: "skipped",
      reason: "channel_alimtalk",
    };
    const wire: IssueOtpInput = {
      phoneNumber: "01012345678",
      purpose: "signup",
      channel: "sms",
      webOtp: webOtpOptions,
    };
    const contractBody: OpenApiOperations["issue"]["body"] = wire;
    const wireResult: IssueOtpOutput = {
      issueId: "i",
      expiresAt: "",
      attemptsRemaining: 5,
      queuedAt: "",
      webOtp: webOtpResult,
    };
    const result: IssueResult = wireResult;
    const resultWebOtp: IssueWebOtpResult | undefined = result.webOtp;
    // @ts-expect-error channel names stay limited to the two channels
    const unknownChannel: OtpChannel = "kakao";

    const payment: PaymentRequiredData = {
      code: "TRIAL_DAILY_LIMIT_EXCEEDED",
      resetAt: "2026-10-11T15:00:00.000Z",
    };
    const openPayment: OtpPaymentRequiredData = payment;
    const rateLimited: RateLimitedData = {
      limit: "perKey",
      policy: "key",
      retryAfterMs: 1000,
    };
    const openRateLimited: OtpRateLimitedData = rateLimited;

    // The wallet fields stay optional, as in 2.0.0.
    const balance: GetBalanceResult = {
      appId: "app_1",
      balance: 42,
      currency: "CREDIT",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const scope = balance.walletScope ?? "app";

    const kiota: KiotaRequestOptions = { origin: "https://a.example" };
    const receive: ReceiveWebOtpOptions = { length: 6 };
    const form: Pick<OtpFormConfig, "webOtp"> = { webOtp: true };
    const reactInput: Pick<ReactCodeInputProps, "webOtp"> = { webOtp: true };
    const vueInput: Pick<VueCodeInputProps, "webOtp"> = { webOtp: true };

    void [
      sms,
      alimtalk,
      contractBody,
      resultWebOtp,
      unknownChannel,
      openPayment,
      openRateLimited,
      scope,
      kiota,
      receive,
      form,
      reactInput,
      vueInput,
    ];
  });
});
