/**
 * UI parity: the React, Vue and Svelte presets must render the same parts
 * with the same `data-*`, ARIA and text for the same scenario. Each step's
 * DOM snapshot is compared across the three frameworks.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { OtpForm as ReactOtpForm } from "@k-otp/sdk/ui/react";
import { OtpForm as SvelteOtpForm } from "@k-otp/sdk/ui/svelte";
import { OtpForm as VueOtpForm } from "@k-otp/sdk/ui/vue";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createApp, h } from "vue";
import { segment } from "./dom";
import { createMockApi, flush, type MockApi, rateLimited } from "./mock-api";
import { mountSvelte } from "./svelte-mount";

type Mounted = { destroy: () => void };
type Framework = {
  name: string;
  mount: (props: Record<string, unknown>) => Mounted;
};

const frameworks: Framework[] = [
  {
    name: "react",
    mount: (props) => {
      render(<ReactOtpForm {...(props as { purpose: string })} />);
      return { destroy: cleanup };
    },
  },
  {
    name: "vue",
    mount: (props) => {
      const el = document.createElement("div");
      document.body.append(el);
      const app = createApp({
        render: () => h(VueOtpForm, props as { purpose: string }),
      });
      app.mount(el);
      return {
        destroy: () => {
          app.unmount();
          el.remove();
        },
      };
    },
  },
  { name: "svelte", mount: (props) => mountSvelte(SvelteOtpForm, props) },
];

let current: Mounted | undefined;
afterEach(() => {
  current?.destroy();
  current = undefined;
});

const settle = async (): Promise<void> => {
  await act(async () => {
    await flush();
  });
};

/** Attributes that describe state, plus the text of leaf parts. */
const STATE_ATTRIBUTE =
  /^(data-|aria-|role$|type$|readonly$|tabindex$|id$|for$|autocomplete$|inputmode$)/;
const LEAF = /label|description|error|button|countdown|message|edit-phone/;

const snapshot = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-k-otp]")).map(
    (element) => {
      const part = element.getAttribute("data-k-otp") ?? "";
      const attributes = Object.fromEntries(
        Array.from(element.attributes)
          .filter((attribute) => STATE_ATTRIBUTE.test(attribute.name))
          .map((attribute) => [attribute.name, attribute.value])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      );
      return {
        tag: element.tagName.toLowerCase(),
        part,
        attributes,
        ...(LEAF.test(part) ? { text: element.textContent?.trim() } : {}),
        ...(element instanceof HTMLInputElement
          ? {
              value: element.value,
              focused: document.activeElement === element,
            }
          : {}),
        ...(part === "message"
          ? { focused: document.activeElement === element }
          : {}),
      };
    },
  );

type Step = (api: MockApi) => Promise<void> | void;

const typePhone =
  (value: string): Step =>
  () => {
    const input = document.querySelector<HTMLInputElement>(
      '[data-k-otp="phone-input"]',
    );
    if (!input) throw new Error("no phone input");
    fireEvent.input(input, { target: { value } });
  };
const click =
  (part: string): Step =>
  () => {
    const button = document.querySelector<HTMLElement>(
      `[data-k-otp="${part}"]`,
    );
    if (!button) throw new Error(`no ${part}`);
    fireEvent.click(button);
  };
const paste =
  (text: string): Step =>
  () => {
    fireEvent.paste(segment(0), { clipboardData: { getData: () => text } });
  };
/**
 * Waits (polling) until a button's retry wait is over, instead of sleeping
 * a fixed time: the wait starts when the mocked 429 lands, which a loaded
 * runner can delay.
 */
const waitUntilIdle =
  (part: string): Step =>
  async () => {
    const deadline = Date.now() + 10_000;
    while (
      document
        .querySelector(`[data-k-otp="${part}"]`)
        ?.getAttribute("data-state") === "cooldown"
    ) {
      if (Date.now() > deadline) throw new Error(`${part} stayed in cooldown`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

const typeCode =
  (code: string): Step =>
  async () => {
    for (const [i, digit] of [...code].entries()) {
      fireEvent.input(segment(i), { target: { value: digit } });
      await flush();
    }
  };

/** Runs `steps` on a framework and returns a snapshot after each. */
const run = async (
  framework: Framework,
  steps: Step[],
  setup?: (api: MockApi) => void,
) => {
  const api = createMockApi();
  setup?.(api);
  current = framework.mount({
    client: api.client,
    purpose: "parity",
    locale: "en",
    id: "parity",
  });
  await settle();
  const snapshots = [snapshot()];
  for (const step of steps) {
    // act() also covers the cooldown ticks of the React form while waiting.
    await act(async () => {
      await step(api);
    });
    await settle();
    snapshots.push(snapshot());
  }
  current.destroy();
  current = undefined;
  return { snapshots, requests: api.calls.map((call) => call.body) };
};

const scenarios: Record<
  string,
  { steps: Step[]; setup?: (api: MockApi) => void }
> = {
  "invalid number, send, wrong code, right code": {
    steps: [
      typePhone("02-123-4567"),
      click("send-button"),
      typePhone("010 1234 5678"),
      click("send-button"),
      paste("000000"),
      typeCode("123456"),
    ],
  },
  "429 on send, then change number after a send": {
    setup: (api) => api.next.issue.push(rateLimited(500)),
    steps: [
      typePhone("+82 10-1234-5678"),
      click("send-button"),
      waitUntilIdle("send-button"),
      click("send-button"),
      click("edit-phone"),
    ],
  },
  "429 on verify, then max attempts": {
    setup: (api) => {
      api.next.verify.push(rateLimited(500));
    },
    steps: [
      typePhone("01012345678"),
      click("send-button"),
      paste("111111"),
      waitUntilIdle("verify-button"),
      click("verify-button"),
      paste("222222"),
      paste("333333"),
      paste("444444"),
      paste("555555"),
    ],
  },
};

describe("UI parity (React, Vue, Svelte presets)", () => {
  for (const [name, scenario] of Object.entries(scenarios)) {
    test(name, async () => {
      const results = [];
      for (const framework of frameworks) {
        results.push({
          framework: framework.name,
          ...(await run(framework, scenario.steps, scenario.setup)),
        });
      }
      const [reference, ...others] = results;
      if (!reference) throw new Error("no framework");
      // Sanity: the scenario really exercised the UI.
      expect(reference.snapshots.length).toBe(scenario.steps.length + 1);
      for (const other of others) {
        for (const [step, expected] of reference.snapshots.entries()) {
          expect({
            framework: other.framework,
            step,
            parts: other.snapshots[step],
          }).toEqual({ framework: other.framework, step, parts: expected });
        }
        expect(other.requests.length).toBe(reference.requests.length);
      }
    }, 20_000);
  }
});
