/**
 * Guards the CI compatibility matrix: when EXPECT_REACT_MAJOR /
 * EXPECT_SVELTE_MAJOR are set, the suite must really run on those versions.
 */
import { expect, test } from "bun:test";
import { version as reactVersion } from "react";
import { VERSION as svelteVersion } from "svelte/compiler";

const major = (version: string): string => version.split(".")[0] ?? "";

test("runs on the expected framework majors", () => {
  console.log(`React ${reactVersion}, Svelte ${svelteVersion}`);
  const expectReact = process.env.EXPECT_REACT_MAJOR;
  const expectSvelte = process.env.EXPECT_SVELTE_MAJOR;
  if (expectReact) expect(major(reactVersion)).toBe(expectReact);
  if (expectSvelte) expect(major(svelteVersion)).toBe(expectSvelte);
});
