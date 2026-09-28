import { describe, expect, test } from "bun:test";
import {
  createOtpClient,
  createOtpPlugin,
  provideOtpClient,
  useOtp,
  useOtpClient,
  useOtpFlow,
} from "@k-otp/sdk-vue";
import {
  createApp,
  createSSRApp,
  defineComponent,
  effectScope,
  h,
  nextTick,
} from "vue";
import { renderToString } from "vue/server-renderer";
import {
  hangUntilAborted,
  issueOutput,
  json,
  mockFetch,
} from "../packages/sdk-core/test/helpers";

const issueInput = {
  phoneNumber: "01012345678",
  purpose: "signup",
  idempotencyKey: "vue-1",
};

describe("plugin and injection", () => {
  test("createOtpPlugin(options) provides one client per app", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const app = createApp({});
    app.use(createOtpPlugin({ apiKey: "pk_vue", fetch }));
    const otp = app.runWithContext(() => effectScope().run(() => useOtp()));
    expect(calls).toHaveLength(0);
    const result = await otp?.issue.run(issueInput);
    expect(result?.data).toEqual(issueOutput);
    expect(otp?.issue.result.value).toEqual(issueOutput);
    expect(otp?.issue.status.value).toBe("success");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer pk_vue");
  });

  test("useOtpClient throws a TypeError without an injected client", () => {
    expect(() => useOtpClient()).toThrow(TypeError);
    expect(() => createApp({}).runWithContext(() => useOtp())).toThrow(
      TypeError,
    );
  });

  test("provideOtpClient outside setup() and missing sources throw TypeErrors", () => {
    const { fetch } = mockFetch(() => json(200, issueOutput));
    expect(() => provideOtpClient({ apiKey: "pk_vue", fetch })).toThrow(
      /inside a component's setup/,
    );
    expect(() =>
      createOtpPlugin(undefined as unknown as { apiKey: string }),
    ).toThrow(TypeError);
  });

  test("provideOtpClient provides to descendants", async () => {
    const { fetch } = mockFetch(() => json(200, issueOutput));
    let injected: unknown;
    const Child = defineComponent({
      setup: () => {
        injected = useOtpClient();
        return () => null;
      },
    });
    const Parent = defineComponent({
      setup: () => {
        const client = provideOtpClient({ apiKey: "pk_vue", fetch });
        return () => h("div", [h(Child), String(typeof client.issue)]);
      },
    });
    const html = await renderToString(createSSRApp(Parent));
    expect(html).toContain("function");
    expect(typeof (injected as { verify?: unknown }).verify).toBe("function");
  });
});

describe("components", () => {
  test("refs drive the template; unmount aborts in-flight calls", async () => {
    const { fetch, calls } = mockFetch((r) => hangUntilAborted(r.signal));
    let otp!: ReturnType<typeof useOtp>;
    const Comp = defineComponent({
      setup: () => {
        otp = useOtp();
        return () => h("span", otp.issue.loading.value ? "sending" : "idle");
      },
    });
    const el = document.createElement("div");
    const app = createApp(Comp);
    app.use(createOtpPlugin(createOtpClient({ apiKey: "pk_vue", fetch })));
    app.mount(el);
    expect(el.textContent).toBe("idle");
    const pending = otp.issue.run(issueInput);
    await nextTick();
    expect(el.textContent).toBe("sending");
    expect(otp.loading.value).toBe(true);
    app.unmount();
    const result = await pending;
    expect(result.error?.code).toBe("ABORTED");
    expect(calls[0]?.signal.aborted).toBe(true);
  });

  test("SSR render is idle and performs no request", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const Comp = defineComponent({
      setup: () => {
        const otp = useOtp();
        const flow = useOtpFlow({ resendCooldownMs: 30_000 });
        return () =>
          h("p", `${otp.issue.status.value}/${String(flow.canSend.value)}`);
      },
    });
    const app = createSSRApp(Comp);
    app.use(createOtpPlugin({ apiKey: "pk_vue", fetch }));
    expect(await renderToString(app)).toContain("idle/true");
    expect(calls).toHaveLength(0);
  });
});

describe("useOtpFlow", () => {
  test("exposes computed refs that follow the flow", async () => {
    const { fetch } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({ apiKey: "pk_vue", fetch });
    const scope = effectScope();
    const flow = scope.run(() =>
      useOtpFlow({ client, resendCooldownMs: 10_000, now: () => 0 }),
    );
    if (!flow) throw new Error("scope did not run");
    expect(flow.canVerify.value).toBe(false);
    await flow.send({ phoneNumber: "01012345678", purpose: "x" });
    expect(flow.issueId.value).toBe(issueOutput.issueId);
    expect(flow.canSend.value).toBe(false);
    expect(flow.cooldownRemainingMs.value).toBe(10_000);
    expect(flow.canVerify.value).toBe(true);
    expect(flow.state.value.issueState.status).toBe("success");
    scope.stop();
  });
});
