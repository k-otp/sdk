import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createOtpClient,
  createOtpFlowStore,
  createOtpStores,
  otpForm,
} from "@k-otp/sdk-svelte";
import { compile, VERSION } from "svelte/compiler";
import { get } from "svelte/store";
import {
  issueOutput,
  json,
  mockFetch,
  verifyOutput,
} from "../packages/sdk-core/test/helpers";

const issueInput = {
  phoneNumber: "01012345678",
  purpose: "signup",
  idempotencyKey: "svelte-1",
};

describe("createOtpStores", () => {
  test("accepts client options and performs no I/O on creation", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const stores = createOtpStores({ apiKey: "pk_svelte", fetch });
    expect(calls).toHaveLength(0);
    expect(get(stores.otpClientStore)).toBe(stores.client);
    const result = await stores.issue.run(issueInput);
    expect(result.data).toEqual(issueOutput);
    expect(get(stores.issue).data).toEqual(issueOutput);
  });

  test("stores follow the Svelte store contract", async () => {
    const { fetch } = mockFetch(() => json(200, verifyOutput));
    const stores = createOtpStores(createOtpClient({ apiKey: "pk_s", fetch }));
    const seen: string[] = [];
    const loading: boolean[] = [];
    const stop = stores.verify.subscribe((s) => seen.push(s.status));
    const stopLoading = stores.loading.subscribe((l) => loading.push(l));
    await stores.verify.run({ issueId: "i", code: "123456" });
    stop();
    stopLoading();
    expect(seen).toEqual(["idle", "loading", "success"]);
    expect(loading).toEqual([false, true, false]);
  });

  test("createOtpFlowStore works standalone", async () => {
    const { fetch } = mockFetch(() => json(200, issueOutput));
    const flow = createOtpFlowStore(
      { apiKey: "pk_s", fetch },
      { resendCooldownMs: 1_000, now: () => 0 },
    );
    await flow.send({ phoneNumber: "01012345678", purpose: "x" });
    expect(get(flow)).toMatchObject({
      issueId: issueOutput.issueId,
      canSend: false,
      cooldownRemainingMs: 1_000,
    });
  });
});

describe("otpForm action", () => {
  test("passes FormData, prevents navigation and ignores re-submits while busy", async () => {
    const form = document.createElement("form");
    form.innerHTML = '<input name="code" value="123456" />';
    document.body.append(form);
    let release!: () => void;
    const calls: string[] = [];
    const action = otpForm(form, (data) => {
      calls.push(String(data.get("code")));
      return new Promise<void>((r) => {
        release = r;
      });
    });
    const submit = () => {
      const event = new Event("submit", { cancelable: true });
      form.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(submit()).toBe(true);
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(submit()).toBe(true);
    expect(calls).toEqual(["123456"]);
    release();
    await Bun.sleep(0);
    expect(form.hasAttribute("aria-busy")).toBe(false);
    action.update(() => calls.push("updated"));
    submit();
    expect(calls).toEqual(["123456", "updated"]);
    action.destroy();
    submit();
    expect(calls).toHaveLength(2);
    form.remove();
  });
});

describe("Svelte components (SSR)", () => {
  let dir: string | undefined;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const svelte4 = VERSION.startsWith("4.");

  /** Compiles a component for the server and imports it (Svelte 4 or 5). */
  const load = async (name: string, source: string) => {
    dir ??= await mkdtemp(path.join(import.meta.dir, ".svelte-tmp-"));
    const options = {
      filename: name,
      generate: svelte4 ? "ssr" : "server",
    } as unknown as Parameters<typeof compile>[1];
    const { js } = compile(source, options);
    const file = path.join(dir, `${name}.js`);
    await writeFile(file, js.code);
    return file;
  };

  test("setOtpContext/getOtpContext share stores; render is idle with no request", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    (globalThis as { __otpFetch?: typeof fetch }).__otpFetch = fetch;
    const child = await load(
      "Child",
      `<script>
        import { getOtpContext } from "@k-otp/sdk-svelte";
        const { issue, loading } = getOtpContext();
      </script>
      <p>{$issue.status}/{$loading}</p>`,
    );
    const parent = await load(
      "Parent",
      `<script>
        import { setOtpContext } from "@k-otp/sdk-svelte";
        import Child from ${JSON.stringify(child)};
        setOtpContext({ apiKey: "pk_ssr", fetch: globalThis.__otpFetch });
      </script>
      <Child />`,
    );
    const Parent = (await import(parent)).default;
    let body: string;
    if (svelte4) {
      // Svelte 4 SSR components expose a static render().
      body = (Parent as { render: () => { html: string } }).render().html;
    } else {
      const server = "svelte/server";
      const { render } = (await import(server)) as {
        render: (component: unknown) => { body: string };
      };
      body = render(Parent).body;
    }
    expect(body).toContain("idle/false");
    expect(calls).toHaveLength(0);
  });
});
