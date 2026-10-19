/**
 * SSR safety of every UI subpath: importing and server-rendering them with
 * no DOM at all (the package tests run without happy-dom) performs no
 * request, starts no timer and never touches `window`/`document`.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { VERSION as SVELTE_VERSION } from "svelte/compiler";
import { createSSRApp, h } from "vue";
import { renderToString as renderVue } from "vue/server-renderer";
import { createOtpClient } from "../src/core";
import { issueOutput, json, mockFetch } from "./helpers";

const svelte4 = SVELTE_VERSION.startsWith("4.");

plugin({
  name: "svelte-server",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      const { compile } = await import("svelte/compiler");
      const options = {
        filename: path,
        generate: svelte4 ? "ssr" : "server",
      } as unknown as Parameters<typeof compile>[1];
      const { js } = compile(await Bun.file(path).text(), options);
      return { contents: js.code, loader: "js" };
    });
  },
});

const realSetTimeout = globalThis.setTimeout;
const timers = mock();
beforeAll(() => {
  expect(typeof (globalThis as { window?: unknown }).window).toBe("undefined");
  expect(typeof (globalThis as { document?: unknown }).document).toBe(
    "undefined",
  );
  globalThis.setTimeout = timers as unknown as typeof setTimeout;
});
afterAll(() => {
  globalThis.setTimeout = realSetTimeout;
});

const client = () => {
  const { fetch, calls } = mockFetch(() => json(200, issueOutput));
  return { client: createOtpClient({ apiKey: "pk_ssr", fetch }), calls };
};

const expectMarkup = (html: string): void => {
  expect(html).toContain('data-k-otp="root"');
  expect(html).toContain('data-state="phone"');
  expect(html).toContain('id="otp-phone"');
  expect(html).toContain('data-k-otp="message"');
  expect(html).not.toContain('data-k-otp="code-field"');
};

describe("UI subpaths without a DOM", () => {
  test("@k-otp/sdk/ui imports and runs on the server", async () => {
    const ui = await import("../src/ui");
    const { client: c, calls } = client();
    const form = ui.createOtpForm(c, { purpose: "ssr" });
    expect(form.getState().phase).toBe("phone");
    expect(ui.isWebOtpSupported()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("@k-otp/sdk/ui/react renders the preset", async () => {
    const { OtpForm } = await import("../src/ui/react");
    const { client: c, calls } = client();
    const html = renderToString(
      createElement(OtpForm, { client: c, purpose: "ssr", id: "otp" }),
    );
    expectMarkup(html);
    expect(calls).toHaveLength(0);
  });

  test("@k-otp/sdk/ui/vue renders the preset", async () => {
    const { OtpForm } = await import("../src/ui/vue");
    const { client: c, calls } = client();
    const app = createSSRApp({
      render: () => h(OtpForm, { client: c, purpose: "ssr", id: "otp" }),
    });
    expectMarkup(await renderVue(app));
    expect(calls).toHaveLength(0);
  });

  test("@k-otp/sdk/ui/svelte renders the preset", async () => {
    const { OtpForm } = await import("../src/ui/svelte/index.js");
    const { client: c, calls } = client();
    const props = { client: c, purpose: "ssr", id: "otp" };
    let html: string;
    if (svelte4) {
      html = (
        OtpForm as unknown as { render: (p: unknown) => { html: string } }
      ).render(props).html;
    } else {
      const server = "svelte/server";
      const { render } = (await import(server)) as {
        render: (c: unknown, o: unknown) => { body: string };
      };
      html = render(OtpForm, { props }).body;
    }
    expectMarkup(html);
    expect(calls).toHaveLength(0);
  });

  test("no timer was started", () => {
    expect(timers).not.toHaveBeenCalled();
  });
});
