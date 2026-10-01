import { afterEach, describe, expect, mock, test } from "bun:test";
import { OtpCodeInput, OtpForm } from "@k-otp/sdk/ui/svelte";
import { fireEvent, screen } from "@testing-library/dom";
import { part, segment, segments, sentPhone } from "./dom";
import BoundCode from "./fixtures/BoundCode.svelte";
import Custom from "./fixtures/Custom.svelte";
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

  test("is exported for direct use", () => {
    expect(OtpCodeInput).toBeDefined();
  });
});
