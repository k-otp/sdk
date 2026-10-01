import { afterEach, describe, expect, mock, test } from "bun:test";
import { OtpCodeInput, OtpForm } from "@k-otp/sdk/ui/vue";
import { createOtpPlugin } from "@k-otp/sdk/vue";
import { fireEvent, screen } from "@testing-library/dom";
import {
  type App,
  createApp,
  createSSRApp,
  defineComponent,
  h,
  ref,
} from "vue";
import { renderToString } from "vue/server-renderer";
import { part, segment, segments, sentPhone } from "./dom";
import { createMockApi, flush, MOCK_CODE } from "./mock-api";

const mounted: { app: App; el: HTMLElement }[] = [];
afterEach(() => {
  for (const { app, el } of mounted.splice(0)) {
    app.unmount();
    el.remove();
  }
});

const mountVue = (component: Parameters<typeof createApp>[0]): App => {
  const el = document.createElement("div");
  document.body.append(el);
  const app = createApp(component);
  mounted.push({ app, el });
  return app;
};

const typePhone = async (value: string): Promise<void> => {
  fireEvent.input(screen.getByLabelText("Phone number"), {
    target: { value },
  });
  await flush();
};

describe("<OtpForm /> preset (Vue)", () => {
  test("full flow with events, focus moves and the plugin client", async () => {
    const api = createMockApi();
    const onVerified = mock();
    const onSent = mock();
    const phases: string[] = [];
    const app = mountVue({
      render: () =>
        h(OtpForm, {
          purpose: "signup",
          locale: "en",
          onSent,
          onVerified,
          onPhaseChange: (phase: string) => phases.push(phase),
        }),
    });
    app.use(createOtpPlugin(api.client));
    app.mount(mounted[0]?.el as HTMLElement);
    expect(part("root").getAttribute("data-state")).toBe("phone");
    await typePhone("010 1234 5678");
    expect(
      (screen.getByLabelText("Phone number") as HTMLInputElement).value,
    ).toBe("010-1234-5678");
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await flush();
    expect(sentPhone(api)).toBe("01012345678");
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(part("root").getAttribute("data-state")).toBe("code");
    expect(document.activeElement).toBe(segment(0));
    fireEvent.paste(segment(0), {
      clipboardData: { getData: () => "111111" },
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

  test("change number unlocks the phone input and focuses it", async () => {
    const api = createMockApi();
    const app = mountVue({
      render: () =>
        h(OtpForm, { client: api.client, purpose: "signup", locale: "en" }),
    });
    app.mount(mounted[0]?.el as HTMLElement);
    await typePhone("01012345678");
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await flush();
    expect(screen.getByLabelText("Phone number").hasAttribute("readonly")).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Change number" }));
    await flush();
    expect(part("root").getAttribute("data-state")).toBe("phone");
    expect(screen.getByLabelText("Phone number").hasAttribute("readonly")).toBe(
      false,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Phone number"));
    expect(document.querySelector('[data-k-otp="code-field"]')).toBeNull();
  });

  test("server rendering performs no request", async () => {
    const api = createMockApi();
    const app = createSSRApp({
      render: () =>
        h(OtpForm, { client: api.client, purpose: "signup", id: "otp" }),
    });
    const html = await renderToString(app);
    expect(html).toContain('data-k-otp="root"');
    expect(html).toContain('id="otp-phone"');
    expect(api.calls).toHaveLength(0);
  });
});

describe("<OtpCodeInput /> (Vue)", () => {
  test("v-model, paste and complete", async () => {
    const value = ref("");
    const onComplete = mock();
    const app = mountVue(
      defineComponent({
        setup: () => () =>
          h(OtpCodeInput, {
            modelValue: value.value,
            "onUpdate:modelValue": (next: string) => {
              value.value = next;
            },
            onComplete,
            locale: "en",
            "aria-label": "Code",
          }),
      }),
    );
    app.mount(mounted[0]?.el as HTMLElement);
    expect(screen.getByLabelText("Digit 1 of 6")).toBe(segment(0));
    fireEvent.paste(segment(0), {
      clipboardData: { getData: () => "12 34 56" },
    });
    await flush();
    expect(value.value).toBe("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
    expect(segments().map((s) => s.value)).toEqual([..."123456"]);
  });
});
