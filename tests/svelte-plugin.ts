/**
 * Preload for the `*.browser.test.*` files: compiles `.svelte` imports for
 * the DOM with the installed Svelte (4 or 5), like an app's bundler would.
 * Those tests run with `--conditions=browser` so that `svelte` resolves to
 * its client runtime.
 */
import { plugin } from "bun";

plugin({
  name: "svelte-client",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      const { compile, VERSION } = await import("svelte/compiler");
      const svelte4 = VERSION.startsWith("4.");
      const options = {
        filename: path,
        generate: svelte4 ? "dom" : "client",
      } as unknown as Parameters<typeof compile>[1];
      const { js } = compile(await Bun.file(path).text(), options);
      return { contents: js.code, loader: "js" };
    });
  },
});
