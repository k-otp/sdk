#!/usr/bin/env bun
/**
 * End-to-end check of the UI components in the framework examples: builds
 * react-vite, vue-vite and svelte-vite against the built package, serves
 * each with `vite preview`, and drives the full flow in Chromium (Playwright)
 * against the examples' in-browser mock API (the code is 123456):
 *
 * - preset (default theme): typing formats the number, Enter/click sends,
 *   focus moves to the first code segment, a wrong code shows the attempts
 *   left and refocuses, the right code verifies and focuses the result;
 * - headless (custom CSS): the same flow with a pasted code, then "change
 *   number" returns to the phone step;
 * - keyboard: Tab / Shift+Tab walk the whole form (phone, send, the code
 *   input as one tab stop, verify, resend, change number) without a trap;
 * - IME: digits composed through an input method (CDP) are entered once.
 *
 *   bun run e2e:examples                          # all frameworks
 *   bun run e2e:examples --only react             # one framework
 *   bun run e2e:examples --screenshots ./shots    # + light/dark desktop/mobile
 *
 * Needs `bun run build` first and a Chromium for Playwright
 * (`bunx playwright install chromium`).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { type Browser, chromium, type Page } from "playwright";

const root = path.resolve(import.meta.dir, "..");
const { values } = parseArgs({
  options: {
    only: { type: "string" },
    screenshots: { type: "string" },
  },
});

/** Example -> preview port (kept away from the dev server's 5173). */
const EXAMPLES: Record<string, number> = {
  react: 4371,
  vue: 4372,
  svelte: 4373,
};

const DEVICES = {
  desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
} as const;

const shots = values.screenshots ? path.resolve(values.screenshots) : undefined;
if (shots) await mkdir(shots, { recursive: true });

const run = async (cmd: string[], cwd: string): Promise<void> => {
  const child = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(`${cmd.join(" ")} failed:\n${stdout}${stderr}`);
};

const waitForServer = async (url: string): Promise<void> => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await Bun.sleep(200);
  }
  throw new Error(`${url} did not start`);
};

/** Waits until `predicate` holds in the page (polling). */
const until = async (
  page: Page,
  description: string,
  predicate: string,
): Promise<void> => {
  try {
    await page.waitForFunction(predicate, undefined, { timeout: 5_000 });
  } catch {
    const message = await page
      .locator('[data-k-otp="message"]')
      .first()
      .textContent()
      .catch(() => "?");
    throw new Error(
      `timed out waiting for ${description} (message: ${message})`,
    );
  }
};

const rootState = (state: string) =>
  `document.querySelector('[data-k-otp="root"]')?.dataset.state === ${JSON.stringify(state)}`;
const messageIs = (text: string) =>
  `document.querySelector('[data-k-otp="message"]')?.textContent?.trim() === ${JSON.stringify(text)}`;
const focusedSegment = (index: number) =>
  `document.activeElement?.dataset?.kOtp === "code-segment" && document.activeElement.dataset.index === "${index}"`;

const screenshot = async (page: Page, name: string): Promise<void> => {
  if (!shots) return;
  await page.screenshot({
    path: path.join(shots, `${name}.png`),
    fullPage: true,
  });
};

/** Pastes `text` into the focused element like a clipboard paste. */
const paste = (page: Page, text: string) =>
  page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData("text", value);
    document.activeElement?.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);

const presetFlow = async (page: Page, base: string): Promise<void> => {
  await page.goto(`${base}/?variant=preset&lang=en`);
  const phone = page.getByLabel("Phone number");
  await phone.click();
  await page.keyboard.type("01012345678");
  if ((await phone.inputValue()) !== "010-1234-5678") {
    throw new Error(`phone formatted as ${await phone.inputValue()}`);
  }
  // Enter in the phone input submits the form (send).
  await page.keyboard.press("Enter");
  await until(page, "code step", rootState("code"));
  await until(
    page,
    "sent message",
    messageIs("We sent a code to 010-****-5678."),
  );
  await until(page, "focus on segment 1", focusedSegment(0));
  await until(
    page,
    "resend cooldown",
    `document.querySelector('[data-k-otp="send-button"]')?.dataset.state === "cooldown"`,
  );
  await page.keyboard.type("111111");
  await until(
    page,
    "mismatch message",
    messageIs("The code is incorrect. 4 attempts remaining."),
  );
  await until(page, "refocus segment 1", focusedSegment(0));
  await page.keyboard.type("1234");
  await page.keyboard.press("Backspace");
  await until(page, "Backspace moves back", focusedSegment(3));
  await page.keyboard.type("456");
  await until(page, "verified", rootState("verified"));
  await until(
    page,
    "verified message",
    messageIs("Your phone number is verified."),
  );
  await until(
    page,
    "focus on the result",
    `document.activeElement?.dataset?.kOtp === "message"`,
  );
};

const headlessFlow = async (page: Page, base: string): Promise<void> => {
  await page.goto(`${base}/?variant=headless&lang=en`);
  await page.getByLabel("Mobile").fill("+82 10 9876 5432");
  await page.getByRole("button", { name: "Send code" }).click();
  await until(page, "code step", rootState("code"));
  await until(
    page,
    "sent message",
    messageIs("We sent a code to 010-****-5432."),
  );
  await until(page, "focus on segment 1", focusedSegment(0));
  await paste(page, "123 456");
  await until(page, "verified", rootState("verified"));
  // Back to the start: a new form, then "change number".
  await page.goto(`${base}/?variant=headless&lang=en`);
  await page.getByLabel("Mobile").fill("01011112222");
  await page.getByRole("button", { name: "Send code" }).click();
  await until(page, "code step", rootState("code"));
  await page.getByRole("button", { name: "Change number" }).click();
  await until(page, "phone step", rootState("phone"));
  await until(
    page,
    "focus on the phone input",
    `document.activeElement?.dataset?.kOtp === "phone-input"`,
  );
};

/** Describes the focused element (`code-segment#2`, `send-button`, ...). */
const focused = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    const part = element?.dataset?.kOtp ?? element?.tagName ?? "none";
    return element?.dataset?.index ? `${part}#${element.dataset.index}` : part;
  });

const expectFocus = async (
  page: Page,
  key: "Tab" | "Shift+Tab" | undefined,
  expected: string,
): Promise<void> => {
  if (key) await page.keyboard.press(key);
  const actual = await focused(page);
  if (actual !== expected) {
    throw new Error(`${key ?? "focus"}: expected ${expected}, got ${actual}`);
  }
};

const keyboardFlow = async (page: Page, base: string): Promise<void> => {
  await page.goto(`${base}/?variant=preset&lang=en`);
  await page.getByLabel("Phone number").focus();
  await expectFocus(page, "Tab", "send-button");
  await expectFocus(page, "Shift+Tab", "phone-input");
  await page.keyboard.type("01012345678");
  await page.keyboard.press("Enter");
  await until(page, "code step", rootState("code"));
  await until(page, "focus on segment 1", focusedSegment(0));
  // Empty code: the code input is one stop, no trap.
  await expectFocus(page, "Tab", "verify-button");
  await expectFocus(page, "Tab", "send-button");
  await expectFocus(page, "Tab", "edit-phone");
  await expectFocus(page, "Shift+Tab", "send-button");
  await expectFocus(page, "Shift+Tab", "verify-button");
  await expectFocus(page, "Shift+Tab", "code-segment#0");
  await expectFocus(page, "Shift+Tab", "phone-input");
  await expectFocus(page, "Tab", "code-segment#0");
  // Partly filled: Tab still leaves, also from an earlier segment.
  await page.keyboard.type("12");
  await expectFocus(page, undefined, "code-segment#2");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expectFocus(page, undefined, "code-segment#0");
  await expectFocus(page, "Tab", "verify-button");
  await expectFocus(page, "Shift+Tab", "code-segment#2");
  await expectFocus(page, "Shift+Tab", "phone-input");
};

/** Digits composed with an input method (CDP), as on IME keyboards. */
const imeFlow = async (page: Page, base: string): Promise<void> => {
  await page.goto(`${base}/?variant=preset&lang=en`);
  await page.getByLabel("Phone number").fill("01012345678");
  await page.keyboard.press("Enter");
  await until(page, "code step", rootState("code"));
  await until(page, "focus on segment 1", focusedSegment(0));
  const cdp = await page.context().newCDPSession(page);
  for (const digit of ["１", "２", "３"]) {
    await cdp.send("Input.imeSetComposition", {
      text: digit,
      selectionStart: 1,
      selectionEnd: 1,
    });
    await cdp.send("Input.insertText", { text: digit });
  }
  const values = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '[data-k-otp="code-segment"]',
      ),
      (segment) => segment.value,
    ).join("|"),
  );
  if (values !== "1|2|3|||") throw new Error(`IME entered ${values}`);
  await until(page, "focus on segment 4", focusedSegment(3));
};

/** Screenshots of a variant in the code step (and verified for the preset). */
const capture = async (
  browser: Browser,
  framework: string,
  base: string,
): Promise<void> => {
  if (!shots) return;
  for (const scheme of ["light", "dark"] as const) {
    for (const [device, options] of Object.entries(DEVICES)) {
      const context = await browser.newContext({
        ...options,
        colorScheme: scheme,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      for (const variant of ["preset", "headless"] as const) {
        await page.goto(`${base}/?variant=${variant}&lang=ko`);
        await page.locator('[data-k-otp="phone-input"]').fill("01012345678");
        await page.locator('[data-k-otp="send-button"]').click();
        await until(page, "code step", rootState("code"));
        await page.keyboard.type("123");
        await screenshot(
          page,
          `${framework}-${variant}-code-${scheme}-${device}`,
        );
        if (variant === "preset" && framework === "react") {
          await page.keyboard.type("999");
          await until(
            page,
            "mismatch",
            `document.querySelector('[data-k-otp="message"]')?.dataset.state === "error"`,
          );
          await screenshot(
            page,
            `${framework}-${variant}-error-${scheme}-${device}`,
          );
          await page.keyboard.type("123456");
          await until(page, "verified", rootState("verified"));
          await screenshot(
            page,
            `${framework}-${variant}-verified-${scheme}-${device}`,
          );
          await page.goto(`${base}/?variant=${variant}&lang=ko`);
          await screenshot(
            page,
            `${framework}-${variant}-phone-${scheme}-${device}`,
          );
        }
      }
      await context.close();
    }
  }
};

const selected = Object.entries(EXAMPLES).filter(
  ([name]) => !values.only || values.only === name,
);
const browser = await chromium.launch();
let failed = false;
try {
  for (const [framework, port] of selected) {
    const dir = path.join(root, "examples", `${framework}-vite`);
    const vite = path.join(dir, "node_modules", ".bin", "vite");
    await run([vite, "build", "--logLevel", "error"], dir);
    const server = Bun.spawn(
      [
        vite,
        "preview",
        "--port",
        String(port),
        "--strictPort",
        "--host",
        "127.0.0.1",
      ],
      { cwd: dir, stdout: "ignore", stderr: "pipe" },
    );
    // Drained continuously (a full pipe would block the server) and printed
    // when something fails.
    const serverLog = new Response(server.stderr).text();
    const base = `http://127.0.0.1:${port}`;
    let frameworkFailed = true;
    try {
      await waitForServer(base);
      frameworkFailed = false;
      for (const [name, flow] of [
        ["preset", presetFlow],
        ["headless", headlessFlow],
        ["keyboard", keyboardFlow],
        ["ime", imeFlow],
      ] as const) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        try {
          await flow(page, base);
          if (errors.length) throw new Error(errors.join("\n"));
          console.log(`[e2e] ${framework} ${name}: ok`);
        } catch (error) {
          failed = true;
          frameworkFailed = true;
          console.log(`[e2e] ${framework} ${name}: FAILED\n  ${String(error)}`);
          await screenshot(page, `failure-${framework}-${name}`);
        } finally {
          await context.close();
        }
      }
      await capture(browser, framework, base);
    } finally {
      server.kill();
      await server.exited;
      if (frameworkFailed) {
        const log = (await serverLog).trim();
        if (log) {
          console.log(`[e2e] ${framework} preview server stderr:\n${log}`);
        }
      }
    }
  }
} finally {
  await browser.close();
}
if (shots) console.log(`[e2e] screenshots: ${shots}`);
process.exitCode = failed ? 1 : 0;
