import { describe, expect, test } from "bun:test";
import {
  createOtpClient,
  OtpProvider,
  useOtpClient,
  useOtpFlow,
  useOtpIssue,
  useOtpVerify,
} from "@k-otp/sdk/react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { renderToString } from "react-dom/server";
import {
  issueOutput,
  json,
  mockFetch,
  verifyOutput,
} from "../packages/sdk/test/helpers";

const issueInput = {
  phoneNumber: "01012345678",
  purpose: "signup",
  idempotencyKey: "react-1",
};

describe("OtpProvider", () => {
  test("creates the client from options (lazily, no I/O)", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const wrapper = ({ children }: { children?: ReactNode }) => (
      <OtpProvider options={{ apiKey: "pk_test", fetch }}>
        {children}
      </OtpProvider>
    );
    const { result } = renderHook(() => useOtpIssue(), { wrapper });
    expect(calls).toHaveLength(0);
    await act(async () => {
      await result.current.run(issueInput);
    });
    expect(result.current.data).toEqual(issueOutput);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer pk_test");
  });

  test("keeps the same client across re-renders", () => {
    const { fetch } = mockFetch(() => json(200, issueOutput));
    const wrapper = ({ children }: { children?: ReactNode }) => (
      <OtpProvider options={{ apiKey: "pk_test", fetch }}>
        {children}
      </OtpProvider>
    );
    const { result, rerender } = renderHook(() => useOtpClient(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  test("switching from client to options after mount still provides a client", () => {
    const { fetch } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    let useOptions = false;
    const wrapper = ({ children }: { children?: ReactNode }) =>
      useOptions ? (
        <OtpProvider options={{ apiKey: "pk_test", fetch }}>
          {children}
        </OtpProvider>
      ) : (
        <OtpProvider client={client}>{children}</OtpProvider>
      );
    const { result, rerender } = renderHook(() => useOtpClient(), { wrapper });
    expect(result.current).toBe(client);
    useOptions = true;
    rerender();
    expect(result.current).not.toBe(client);
    expect(typeof result.current.issue).toBe("function");
  });

  test("a provider without client or options throws the shared TypeError", () => {
    const props = {} as unknown as Parameters<typeof OtpProvider>[0];
    // React logs the render error; keep the test output clean.
    const error = console.error;
    console.error = () => {};
    try {
      expect(() => render(<OtpProvider {...props} />)).toThrow(
        /Pass an OTP client or createOtpClient options/,
      );
    } finally {
      console.error = error;
    }
  });

  test("hooks throw a TypeError without a provider or client", () => {
    expect(() => renderHook(() => useOtpVerify())).toThrow(TypeError);
  });

  test("a hook-level client overrides the provider", async () => {
    const { fetch, calls } = mockFetch(() => json(200, verifyOutput));
    const client = createOtpClient({ apiKey: "pk_hook", fetch });
    const { result } = renderHook(() => useOtpVerify({ client }));
    await act(async () => {
      await result.current.run({ issueId: "i", code: "123456" });
    });
    expect(result.current.status).toBe("success");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer pk_hook");
  });
});

describe("hooks", () => {
  test("run and reset are stable across renders", async () => {
    const { fetch } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const { result } = renderHook(() => useOtpIssue({ client }));
    const { run, reset } = result.current;
    await act(async () => {
      await result.current.run(issueInput);
    });
    expect(result.current.run).toBe(run);
    expect(result.current.reset).toBe(reset);
  });

  test("works under StrictMode (double-invoked effects)", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const { result } = renderHook(() => useOtpIssue(), {
      wrapper: ({ children }) => (
        <StrictMode>
          <OtpProvider client={client}>{children}</OtpProvider>
        </StrictMode>
      ),
    });
    await act(async () => {
      await result.current.run(issueInput);
    });
    expect(result.current.data).toEqual(issueOutput);
    expect(calls).toHaveLength(1);
  });

  test("renders in a component: loading, then data", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { fetch } = mockFetch(async () => {
      await gate;
      return json(200, issueOutput);
    });
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const Send = () => {
      const issue = useOtpIssue();
      return (
        <button type="button" onClick={() => void issue.run(issueInput)}>
          {issue.isLoading ? "sending" : (issue.data?.issueId ?? "send")}
        </button>
      );
    };
    const { container } = render(
      <OtpProvider client={client}>
        <Send />
      </OtpProvider>,
    );
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("send");
    act(() => {
      button?.click();
    });
    expect(button?.textContent).toBe("sending");
    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(button?.textContent).toBe(issueOutput.issueId));
  });

  test("useOtpFlow ticks the cooldown and re-enables sending", async () => {
    const { fetch } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const { result } = renderHook(() =>
      useOtpFlow({ client, resendCooldownMs: 1_100 }),
    );
    await act(async () => {
      await result.current.send({ phoneNumber: "01012345678", purpose: "x" });
    });
    expect(result.current.canSend).toBe(false);
    const first = result.current.cooldownRemainingMs;
    await waitFor(
      () => expect(result.current.cooldownRemainingMs).toBeLessThan(first),
      { timeout: 1_500 },
    );
    await waitFor(() => expect(result.current.canSend).toBe(true), {
      timeout: 2_000,
    });
  });
});

describe("SSR", () => {
  test("renderToString performs no request and renders idle state", () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const View = () => {
      const issue = useOtpIssue();
      const flow = useOtpFlow();
      return <p>{`${issue.status}/${String(flow.canSend)}`}</p>;
    };
    const html = renderToString(
      <OtpProvider options={{ apiKey: "pk_test", fetch }}>
        <View />
      </OtpProvider>,
    );
    expect(html).toContain("idle/true");
    expect(calls).toHaveLength(0);
  });
});
