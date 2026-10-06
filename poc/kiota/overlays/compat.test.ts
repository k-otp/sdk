import { describe, expect, test } from "bun:test";
import { config, root, sha256 } from "../scripts/common";
import { compatibilityOverlay, type Json, object } from "./compat";

const original = await Bun.file(`${root}/spec/openapi.json`).json();
describe("reviewed generation overlay", () => {
  test("does not mutate, downgrade, drop operations or nullable/boolean unions", () => {
    const before = JSON.stringify(original);
    const { spec, changes } = compatibilityOverlay(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(spec.openapi).toBe(original.openapi);
    expect(Object.keys(spec.paths as object)).toEqual(
      Object.keys(original.paths),
    );
    expect(
      (spec.paths as typeof original.paths)["/issue"].post.requestBody.content[
        "application/json"
      ].schema.properties.webOtp,
    ).toEqual(
      original.paths["/issue"].post.requestBody.content["application/json"]
        .schema.properties.webOtp,
    );
    expect(
      (spec.paths as typeof original.paths)["/balance"].get.responses["200"]
        .content["application/json"].schema.properties.promoNextExpiry,
    ).toEqual(
      original.paths["/balance"].get.responses["200"].content[
        "application/json"
      ].schema.properties.promoNextExpiry,
    );
    expect(changes.filter((c) => c.reason.startsWith("Relaxed"))).toHaveLength(
      60,
    );
  });
  test("constant enum transformation has exactly the same permitted values", () => {
    const { changes } = compatibilityOverlay(original);
    for (const { before, after } of changes.filter((c) =>
      c.reason.startsWith("Equivalent"),
    )) {
      if (
        !object(before) ||
        !object(after) ||
        !Array.isArray(before.oneOf) ||
        !Array.isArray(after.enum)
      )
        throw new Error("Invalid enum transformation");
      const values = before.oneOf.map((b) => (object(b) ? b.const : null));
      const candidates: Json[] = [
        ...(values as Json[]),
        "unrecognized",
        null,
        false,
        7,
        {},
      ];
      for (const value of candidates)
        expect(after.enum.some((entry) => entry === value)).toBe(
          values.some((entry) => entry === value),
        );
    }
  });
  test("every error view preserves envelope keys and arbitrary data with documented relaxation", () => {
    const { spec, changes } = compatibilityOverlay(original);
    if (!object(spec.components) || !object(spec.components.schemas))
      throw new Error("Missing schemas");
    const error = spec.components.schemas.KotpErrorEnvelope;
    if (!object(error) || !object(error.properties))
      throw new Error("Missing error");
    expect(Object.keys(error.properties)).toEqual([
      "defined",
      "code",
      "status",
      "message",
      "data",
    ]);
    expect(error.properties.data).toEqual({});
    expect(
      changes.some((c) =>
        c.reason.includes("loses branch-specific validation/typed data"),
      ),
    ).toBe(true);
  });
  test("input hash is pinned to the actual vendored document", async () => {
    expect(sha256(await Bun.file(`${root}/${config.spec}`).bytes())).toBe(
      config.specSha256,
    );
  });
});
