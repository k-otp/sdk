/**
 * Compiles `.svelte` imports for the server (SSR) under `bun test`, with the
 * installed Svelte 4 or 5, so tests can import `src/ui/svelte` without a DOM.
 * Registered once per test process, whichever test file loads it first.
 */
import { plugin } from "bun";
import { VERSION as SVELTE_VERSION } from "svelte/compiler";

const REGISTERED = Symbol.for("k-otp.test.svelte-server-plugin");

export const registerSvelteServerPlugin = (): void => {
  const globals = globalThis as Record<symbol, unknown>;
  if (globals[REGISTERED]) return;
  globals[REGISTERED] = true;
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
};
