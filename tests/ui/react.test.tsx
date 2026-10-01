import { afterEach, describe, expect, mock, test } from "bun:test";
import { OtpProvider } from "@k-otp/sdk/react";
import { OtpCodeInput, OtpForm, type OtpFormPhase } from "@k-otp/sdk/ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import { renderToString } from "react-dom/server";
import { part, segment, segments, sentPhone } from "./dom";
import { createMockApi, flush, MOCK_CODE, rateLimited } from "./mock-api";

afterEach(cleanup);

const settle = async (): Promise<void> => {
  await act(async () => {
    await flush();
  });
};

const typePhone = (value: string): void => {
  fireEvent.change(screen.getByLabelText("Phone number"), {
    target: { value },
  });
};

const sendCode = async (): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  await settle();
};

describe("<OtpForm /> preset (React)", () => {
  test("labels, roles and the initial data-state", () => {
    const api = createMockApi();
    render(<OtpForm client={api.client} purpose="signup" locale="en" />);
    const input = screen.getByLabelText("Phone number");
    expect(input.getAttribute("type")).toBe("tel");
    expect(input.getAttribute("autocomplete")).toBe("tel");
    expect(input.getAttribute("aria-describedby")).toBe(
      part("phone-description").id,
    );
    expect(part("root").getAttribute("data-state")).toBe("phone");
    expect(part("root").tagName).toBe("FORM");
    expect(screen.getByRole("status")).toBe(part("message"));
    expect(part("message").getAttribute("aria-live")).toBe("polite");
    expect(part("message").hasAttribute("data-empty")).toBe(true);
    expect(document.querySelector('[data-k-otp="code-field"]')).toBeNull();
    expect(api.calls).toHaveLength(0);
  });

  test("an invalid number shows the error, sets aria-invalid and keeps focus", async () => {
    const api = createMockApi();
    render(<OtpForm client={api.client} purpose="signup" locale="en" />);
    typePhone("02-123-4567");
    await sendCode();
    const input = screen.getByLabelText("Phone number");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(part("phone-field").hasAttribute("data-invalid")).toBe(true);
    expect(part("phone-error").textContent).toBe(
      "Enter a mobile number (010-...).",
    );
    expect(input.getAttribute("aria-describedby")).toContain(
      part("phone-error").id,
    );
    expect(document.activeElement).toBe(input);
    expect(api.calls).toHaveLength(0);
  });

  test("full flow: send (canonical number), focus moves to the code, wrong code, verify", async () => {
    const api = createMockApi();
    const phases: OtpFormPhase[] = [];
    const onSent = mock();
    const onVerified = mock();
    render(
      <OtpForm
        client={api.client}
        purpose="signup"
        locale="en"
        onSent={onSent}
        onVerified={onVerified}
        onPhaseChange={(phase) => phases.push(phase)}
      />,
    );
    typePhone("+82 10 1234 5678");
    expect(
      (screen.getByLabelText("Phone number") as HTMLInputElement).value,
    ).toBe("+82 10-1234-5678");
    await sendCode();
    expect(sentPhone(api)).toBe("01012345678");
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(part("root").getAttribute("data-state")).toBe("code");
    expect(part("root").hasAttribute("data-issued")).toBe(true);
    expect(screen.getByLabelText("Phone number").hasAttribute("readonly")).toBe(
      true,
    );
    expect(part("message").textContent).toBe(
      "We sent a code to 010-****-5678.",
    );
    expect(part("countdown").getAttribute("role")).toBe("timer");
    expect(part("countdown").getAttribute("aria-live")).toBe("off");
    expect(part("countdown").textContent).toBe("Code expires in 3:00");
    expect(part("send-button").getAttribute("data-state")).toBe("cooldown");
    expect(part("send-button").getAttribute("aria-disabled")).toBe("true");
    expect(part("send-button").textContent).toBe("Resend in 0:30");
    // Focus moved to the first segment after the send.
    expect(document.activeElement).toBe(segment(0));
    expect(segment(0).getAttribute("autocomplete")).toBe("one-time-code");
    expect(segment(0).getAttribute("inputmode")).toBe("numeric");
    expect(screen.getByRole("group").getAttribute("aria-labelledby")).toBe(
      part("code-label").id,
    );

    // Paste a wrong code: auto-submit, MISMATCH, code cleared, focus back.
    fireEvent.paste(segment(0), {
      clipboardData: { getData: () => "654 321" },
    });
    await settle();
    expect(part("message").textContent).toBe(
      "The code is incorrect. 4 attempts remaining.",
    );
    expect(part("message").getAttribute("data-state")).toBe("error");
    expect(part("code-field").hasAttribute("data-invalid")).toBe(true);
    expect(segments().map((s) => s.value)).toEqual(["", "", "", "", "", ""]);
    expect(document.activeElement).toBe(segment(0));

    // Type the right code digit by digit.
    for (const [i, digit] of [...MOCK_CODE].entries()) {
      fireEvent.change(segment(i), {
        target: { value: digit },
      });
    }
    await settle();
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(part("root").getAttribute("data-state")).toBe("verified");
    expect(part("message").textContent).toBe("Your phone number is verified.");
    expect(part("message").getAttribute("data-state")).toBe("success");
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

  test("keyboard: Backspace and arrows move between segments", async () => {
    const api = createMockApi();
    render(
      <OtpForm
        client={api.client}
        purpose="signup"
        locale="en"
        autoSubmit={false}
      />,
    );
    typePhone("01012345678");
    await sendCode();
    for (const [i, digit] of ["1", "2", "3"].entries()) {
      fireEvent.change(segment(i), {
        target: { value: digit },
      });
    }
    expect(document.activeElement).toBe(segment(3));
    // Focusing a segment past the first empty one redirects to it.
    fireEvent.focus(segment(5));
    expect(document.activeElement).toBe(segment(3));
    fireEvent.keyDown(segment(3), { key: "Backspace" });
    expect(segments().map((s) => s.value)).toEqual(["1", "2", "", "", "", ""]);
    expect(document.activeElement).toBe(segment(2));
    fireEvent.keyDown(segment(2), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(segment(1));
    fireEvent.keyDown(segment(1), { key: "Home" });
    expect(document.activeElement).toBe(segment(0));
    fireEvent.keyDown(segment(0), { key: "End" });
    expect(document.activeElement).toBe(segment(2));
    // An incomplete code is not sent; the field reports it.
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await settle();
    expect(part("code-error").textContent).toBe("Enter all 6 digits.");
    expect(api.calls).toHaveLength(1);
  });

  test("429 on send: retry countdown on the button, error message", async () => {
    const api = createMockApi();
    api.next.issue.push(rateLimited(5_000));
    render(<OtpForm client={api.client} purpose="signup" locale="en" />);
    typePhone("010-1234-5678");
    await sendCode();
    expect(part("root").getAttribute("data-state")).toBe("phone");
    expect(part("message").textContent).toBe(
      "Too many attempts. Please wait and try again.",
    );
    expect(part("send-button").textContent).toBe("Resend in 0:05");
    expect(part("send-button").getAttribute("data-state")).toBe("cooldown");
  });

  test("works under StrictMode with OtpProvider and Korean defaults", async () => {
    const api = createMockApi();
    render(
      <StrictMode>
        <OtpProvider client={api.client}>
          <OtpForm purpose="signup" />
        </OtpProvider>
      </StrictMode>,
    );
    fireEvent.change(screen.getByLabelText("휴대폰 번호"), {
      target: { value: "01012345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "인증번호 받기" }));
    await settle();
    expect(part("message").textContent).toBe(
      "010-****-5678(으)로 인증번호를 보냈습니다.",
    );
    expect(api.calls).toHaveLength(1);
  });

  test("server rendering: no request, stable markup", () => {
    const api = createMockApi();
    const html = renderToString(
      <OtpForm client={api.client} purpose="signup" id="otp" />,
    );
    expect(html).toContain('data-k-otp="root"');
    expect(html).toContain('id="otp-phone"');
    expect(api.calls).toHaveLength(0);
  });
});

describe("<OtpCodeInput /> (React)", () => {
  test("standalone: controlled value, paste and onComplete", async () => {
    const onComplete = mock();
    const Harness = () => {
      const [value, setValue] = useState("");
      return (
        <>
          <span id="label">Code</span>
          <OtpCodeInput
            aria-labelledby="label"
            value={value}
            onValueChange={setValue}
            onComplete={onComplete}
            name="code"
            locale="en"
          />
          <output>{value}</output>
        </>
      );
    };
    render(<Harness />);
    const group = screen.getByRole("group", { name: "Code" });
    expect(group.getAttribute("data-k-otp")).toBe("code-input");
    expect(screen.getByLabelText("Digit 1 of 6")).toBe(segment(0));
    fireEvent.paste(segment(2), {
      clipboardData: { getData: () => "１２-３" },
    });
    expect(document.querySelector("output")?.textContent).toBe("123");
    fireEvent.change(segment(3), {
      target: { value: "456" },
    });
    expect(onComplete).toHaveBeenCalledWith("123456");
    expect(
      (document.querySelector('input[name="code"]') as HTMLInputElement).value,
    ).toBe("123456");
    expect(group.getAttribute("data-state")).toBe("filled");
    await waitFor(() => expect(document.activeElement).toBe(segment(5)));
  });
});
