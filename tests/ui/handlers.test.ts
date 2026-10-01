/**
 * The shared code input handlers against real DOM segments (happy-dom):
 * IME edge cases that depend on the browser's event order.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createOtpCodeInputHandlers } from "@k-otp/sdk/ui";

let group: HTMLDivElement | undefined;
afterEach(() => group?.remove());

const setup = (initial = "") => {
  group = document.createElement("div");
  for (let i = 0; i < 6; i++) {
    const input = document.createElement("input");
    input.setAttribute("data-k-otp", "code-segment");
    group.append(input);
  }
  document.body.append(group);
  const container = group;
  let value = initial;
  const handlers = createOtpCodeInputHandlers({
    getValue: () => value,
    getLength: () => 6,
    isReadOnly: () => false,
    onChange: (next) => {
      value = next;
    },
    getContainer: () => container,
  });
  const segment = (i: number) =>
    container.querySelectorAll("input")[i] as HTMLInputElement;
  const input = (i: number, text: string, isComposing?: boolean) => {
    segment(i).value = text;
    handlers.input(i, {
      currentTarget: segment(i),
      target: segment(i),
      isComposing,
    });
  };
  const focused = () =>
    Array.from(container.querySelectorAll("input")).indexOf(
      document.activeElement as HTMLInputElement,
    );
  return {
    handlers,
    segment,
    input,
    focused,
    value: () => value,
    setValue: (next: string) => {
      value = next;
    },
  };
};

describe("code input handlers: IME", () => {
  test("input during a composition is ignored until compositionend", () => {
    const { handlers, input, segment, value, focused } = setup();
    handlers.compositionstart();
    input(0, "３", true);
    expect(value()).toBe("");
    handlers.compositionend(0, {
      currentTarget: segment(0),
      target: segment(0),
    });
    expect(value()).toBe("3");
    expect(focused()).toBe(1);
  });

  test("a non-composing input ends a composition left open (no compositionend)", () => {
    const { handlers, input, value } = setup();
    handlers.compositionstart();
    expect(handlers.isComposing()).toBe(true);
    // e.g. a cancelled composition: the next input says it is not composing.
    input(0, "4", false);
    expect(handlers.isComposing()).toBe(false);
    expect(value()).toBe("4");
  });

  test("blur and a non-composing keydown clear a stuck composition", () => {
    const { handlers, input, value } = setup();
    handlers.compositionstart();
    handlers.blur();
    expect(handlers.isComposing()).toBe(false);
    handlers.compositionstart();
    handlers.keydown(0, {
      key: "1",
      isComposing: false,
      preventDefault: () => {},
    });
    expect(handlers.isComposing()).toBe(false);
    // An input without isComposing (older browsers) is applied now.
    input(0, "1");
    expect(value()).toBe("1");
  });

  test("WebKit order: the input after compositionend does not re-apply or move focus back", () => {
    const { handlers, segment, input, value, focused } = setup();
    handlers.compositionstart();
    segment(0).value = "123";
    handlers.compositionend(0, {
      currentTarget: segment(0),
      target: segment(0),
    });
    expect(value()).toBe("123");
    expect(focused()).toBe(3);
    // WebKit: the composition's final input arrives after compositionend,
    // on segment 0, whose value is now "1".
    input(0, segment(0).value, false);
    expect(value()).toBe("123");
    expect(focused()).toBe(3);
  });

  test("a sync skipped during a composition is replayed when it ends", () => {
    const state = setup("123456");
    const { handlers, segment } = state;
    handlers.sync();
    handlers.compositionstart();
    segment(2).value = "ａ";
    // The code changes meanwhile (WebOTP, reset, a controlled parent).
    state.setValue("");
    handlers.sync();
    expect(segment(0).value).toBe("1");
    handlers.compositionend(2, {
      currentTarget: segment(2),
      target: segment(2),
    });
    expect([0, 1, 2, 3, 4, 5].map((i) => segment(i).value)).toEqual([
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  });

  test("a non-composing input after a skipped sync keeps the typed digit", () => {
    const state = setup("12");
    const { handlers, segment, input } = state;
    handlers.sync();
    handlers.compositionstart();
    state.setValue("98");
    handlers.sync();
    // No compositionend: the next input says it is not composing.
    input(2, "7", false);
    expect(state.value()).toBe("987");
    expect([0, 1, 2].map((i) => segment(i).value)).toEqual(["9", "8", "7"]);
  });

  test("blur also replays a skipped sync", () => {
    const state = setup("12");
    const { handlers, segment } = state;
    handlers.sync();
    handlers.compositionstart();
    state.setValue("98");
    handlers.sync();
    handlers.blur();
    expect(segment(0).value).toBe("9");
    expect(segment(1).value).toBe("8");
  });

  test("sync() writes the value unless composing", () => {
    const { handlers, segment } = setup("12");
    handlers.sync();
    expect(segment(1).value).toBe("2");
    handlers.compositionstart();
    segment(2).value = "３";
    handlers.sync();
    expect(segment(2).value).toBe("３");
  });
});
