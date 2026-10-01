/**
 * Guards the CI compatibility matrix: when EXPECT_REACT_MAJOR /
 * EXPECT_SVELTE_MAJOR / EXPECT_VUE_MINOR are set, the suite must really run
 * on those versions.
 */
import { expect, test } from "bun:test";
import { version as reactVersion } from "react";
import { VERSION as svelteVersion } from "svelte/compiler";
import { version as vueVersion } from "vue";

const major = (version: string): string => version.split(".")[0] ?? "";

test("runs on the expected framework majors", () => {
  console.log(
    `React ${reactVersion}, Svelte ${svelteVersion}, Vue ${vueVersion}`,
  );
  const expectReact = process.env.EXPECT_REACT_MAJOR;
  const expectSvelte = process.env.EXPECT_SVELTE_MAJOR;
  if (expectReact) expect(major(reactVersion)).toBe(expectReact);
  if (expectSvelte) expect(major(svelteVersion)).toBe(expectSvelte);
  const expectVue = process.env.EXPECT_VUE_MINOR;
  if (expectVue) {
    expect(vueVersion.split(".").slice(0, 2).join(".")).toBe(expectVue);
  }
});
