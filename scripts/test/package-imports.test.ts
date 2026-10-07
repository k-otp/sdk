import { expect, test } from "bun:test";
import { bareImports } from "../package-imports";

test("dependency checks distinguish the API's from field from real imports", () => {
  expect(
    bareImports(
      'writer.writeStringValue("from", value.from); import {x} from "pkg"; const note = \'from "not-a-package"\';',
    ),
  ).toEqual(["pkg"]);
  expect(
    bareImports(
      'const x=require("@scope/pkg"); import("dynamic-pkg"); export {a} from "./local"; import "node:fs";',
    ),
  ).toEqual(["@scope/pkg", "dynamic-pkg"]);
});
