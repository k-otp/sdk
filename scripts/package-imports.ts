import { isBuiltin } from "node:module";

const scanner = new Bun.Transpiler({ loader: "js" });
/** Inspect real imports without treating JSON keys or strings as syntax. */
export function bareImports(code: string, svelte = false): string[] {
  const scripts = svelte
    ? [...code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(
        (match) => match[1] ?? "",
      )
    : [code];
  return [
    ...new Set(
      scripts
        .flatMap((script) =>
          scanner.scanImports(script).map((item) => item.path),
        )
        .filter(
          (specifier) => !specifier.startsWith(".") && !isBuiltin(specifier),
        ),
    ),
  ];
}
