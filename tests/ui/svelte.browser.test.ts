import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OtpFormController } from "@k-otp/sdk/ui";
import { OtpCodeInput, OtpForm } from "@k-otp/sdk/ui/svelte";
import { fireEvent, screen } from "@testing-library/dom";
import { part, segment, segments, sentPhone } from "./dom";
import BoundCode from "./fixtures/BoundCode.svelte";
import Custom from "./fixtures/Custom.svelte";
import ImeHarness from "./fixtures/ImeHarness.svelte";
import { createMockApi, flush, MOCK_CODE } from "./mock-api";
import { mountSvelte } from "./svelte-mount";

const mounted: { destroy: () => void }[] = [];
afterEach(() => {
  for (const instance of mounted.splice(0)) instance.destroy();
});
const mount = (component: unknown, props: Record<string, unknown>) => {
  const instance = mountSvelte(component, props);
  mounted.push(instance);
  return instance;
};

describe("<OtpForm /> preset (Svelte)", () => {
  test("full flow with callbacks and focus moves", async () => {
    const api = createMockApi();
    const onVerified = mock();
    const phases: string[] = [];
    mount(OtpForm, {
      client: api.client,
      purpose: "signup",
      locale: "en",
      onVerified,
      onPhaseChange: (phase: string) => phases.push(phase),
    });
    await flush();
    expect(part("root").getAttribute("data-state")).toBe("phone");
    const phone = screen.getByLabelText("Phone number") as HTMLInputElement;
    fireEvent.input(phone, { target: { value: "0082 10 1234 5678" } });
    await flush();
    expect(phone.value).toBe("0082 10 1234 5678".replace(/\D/g, ""));
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await flush();
    expect(sentPhone(api)).toBe("01012345678");
    expect(part("root").getAttribute("data-state")).toBe("code");
    expect(phone.hasAttribute("readonly")).toBe(true);
    expect(document.activeElement).toBe(segment(0));
    expect(part("message").textContent).toBe(
      "We sent a code to 010-****-5678.",
    );
    fireEvent.paste(segment(0), {
      clipboardData: { getData: () => "999999" },
    });
    await flush();
    expect(part("message").textContent).toBe(
      "The code is incorrect. 4 attempts remaining.",
    );
    expect(document.activeElement).toBe(segment(0));
    for (const [i, digit] of [...MOCK_CODE].entries()) {
      fireEvent.input(segment(i), {
        target: { value: digit },
      });
      await flush(1);
    }
    await flush();
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(part("root").getAttribute("data-state")).toBe("verified");
    expect(document.activeElement).toBe(part("message"));
    expect(phases).toEqual([
      "sending",
      "code",
      "verifying",
      "code",
      "verifying",
      "verified",
    ]);
  });

  test("headless parts with slot props and restProps", async () => {
    const api = createMockApi();
    mount(Custom, { client: api.client });
    await flush();
    const root = part("root");
    expect(root.id).toBe("custom");
    expect(root.classList.contains("my-form")).toBe(true);
    const input = screen.getByLabelText("Mobile") as HTMLInputElement;
    expect(input.classList.contains("my-input")).toBe(true);
    expect(input.getAttribute("data-k-otp")).toBe("phone-input");
    fireEvent.input(input, { target: { value: "01012345678" } });
    await flush();
    expect(input.value).toBe("010-1234-5678");
    expect(part("send-button").textContent).toBe("Send (Send code)");
    fireEvent.click(part("send-button"));
    await flush();
    expect(document.querySelector("output")?.textContent).toBe("code");
    expect(segments()).toHaveLength(6);
    // use:phoneInput keeps readonly in sync with the phase.
    expect(input.readOnly).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Change number" }));
    await flush();
    expect(input.readOnly).toBe(false);
  });
});

describe("Svelte IME and locale", () => {
  test("IME: a re-render in the middle of a composition keeps it", async () => {
    const api = createMockApi();
    let form!: OtpFormController;
    mount(ImeHarness, {
      client: api.client,
      onForm: (captured: OtpFormController) => {
        form = captured;
      },
    });
    await flush();
    form.setPhoneNumber("01012345678");
    await form.send();
    await flush();
    fireEvent.compositionStart(segment(0));
    segment(0).value = "３";
    fireEvent.input(segment(0), { isComposing: true });
    // A state change re-renders the field (like the countdown tick).
    form.configure({ allowInternational: true });
    await flush();
    expect(segment(0).value).toBe("３");
    fireEvent.compositionEnd(segment(0));
    await flush();
    expect(form.getState().code).toBe("3");
    expect(segment(0).value).toBe("3");
    expect(document.activeElement).toBe(segment(1));
  });

  test('locale="auto" follows <html lang> after mount', async () => {
    const api = createMockApi();
    document.documentElement.lang = "en-GB";
    try {
      mount(OtpForm, { client: api.client, purpose: "x", locale: "auto" });
      await flush();
      expect(part("send-button").textContent).toBe("Send code");
      document.documentElement.lang = "ko";
      await flush();
      expect(part("send-button").textContent).toBe("인증번호 받기");
    } finally {
      document.documentElement.lang = "";
    }
  });
});

describe("Svelte hydration", () => {
  let dir: string | undefined;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /**
   * Server-renders the preset like an SSR build: a separate bundle of the
   * `.svelte` sources compiled for the server, with Svelte's server runtime
   * (this test process resolves `svelte` to the client runtime).
   */
  const serverRender = async (props: Record<string, unknown>) => {
    const { compile, VERSION } = await import("svelte/compiler");
    const svelte4 = VERSION.startsWith("4.");
    dir ??= await mkdtemp(path.join(import.meta.dir, "..", ".svelte-tmp-"));
    const entry = path.join(dir, "entry.js");
    const index = path.resolve(
      import.meta.dir,
      "../../packages/sdk/src/ui/svelte/index.js",
    );
    await writeFile(
      entry,
      svelte4
        ? `export { OtpForm } from ${JSON.stringify(index)};\n`
        : `export { OtpForm } from ${JSON.stringify(index)};\nexport { render } from "svelte/server";\n`,
    );
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: dir,
      naming: "server-[hash].js",
      target: "bun",
      plugins: [
        {
          name: "svelte-server",
          setup(build) {
            build.onLoad({ filter: /\.svelte$/ }, async ({ path: file }) => {
              const options = {
                filename: file,
                generate: svelte4 ? "ssr" : "server",
              } as unknown as Parameters<typeof compile>[1];
              const { js } = compile(await Bun.file(file).text(), options);
              return { contents: js.code, loader: "js" };
            });
          },
        },
      ],
    });
    if (!result.success) throw new Error(result.logs.join("\n"));
    const output = result.outputs[0]?.path ?? "";
    const server = (await import(output)) as {
      OtpForm: { render?: (p: unknown) => { html: string } };
      render?: (c: unknown, o: unknown) => { body: string };
    };
    return svelte4
      ? (server.OtpForm.render?.(props).html ?? "")
      : (server.render?.(server.OtpForm, { props }).body ?? "");
  };

  test("hydrates server markup (explicit id), reusing the server nodes", async () => {
    const api = createMockApi();
    const props = {
      client: api.client,
      purpose: "signup",
      id: "otp",
      locale: "en",
    };
    const html = await serverRender(props);
    expect(html).toContain('id="otp-phone"');
    const target = document.createElement("div");
    target.innerHTML = html;
    document.body.append(target);
    const serverInput = target.querySelector('[data-k-otp="phone-input"]');
    mounted.push(mountSvelte(OtpForm, props, { target, hydrate: true }));
    await flush();
    expect(part("phone-input")).toBe(serverInput as HTMLElement);
    expect(part("phone-input").id).toBe("otp-phone");
    fireEvent.input(part("phone-input"), {
      target: { value: "01012345678" },
    });
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await flush();
    expect(part("root").getAttribute("data-state")).toBe("code");
    expect(api.calls).toHaveLength(1);
  });
});

describe("<OtpCodeInput /> (Svelte)", () => {
  test("bind:value, paste and onComplete", async () => {
    const onComplete = mock();
    mount(BoundCode, { onComplete });
    await flush();
    const group = screen.getByRole("group", { name: "Code" });
    expect(group.getAttribute("data-k-otp")).toBe("code-input");
    fireEvent.paste(segment(0), {
      clipboardData: { getData: () => "Your code: 123-456" },
    });
    await flush();
    expect(document.querySelector("output")?.textContent).toBe("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
    expect(segments().map((s) => s.value)).toEqual([..."123456"]);
    fireEvent.keyDown(segment(5), { key: "Backspace" });
    await flush();
    expect(document.querySelector("output")?.textContent).toBe("12345");
  });

  test("a raw bound value is sanitized before it reaches the segments", async () => {
    mount(OtpCodeInput, { value: "123 456", name: "code", locale: "en" });
    await flush();
    expect(segments().map((s) => s.value)).toEqual([..."123456"]);
    expect(
      (document.querySelector('input[name="code"]') as HTMLInputElement).value,
    ).toBe("123456");
  });

  test("is exported for direct use", () => {
    expect(OtpCodeInput).toBeDefined();
  });
});
