/** Generation-only adaptation. The vendored OpenAPI is never modified. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
type ObjectValue = { [key: string]: Json };
export function object(value: Json | undefined): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function compatibilityOverlay(input: ObjectValue) {
  const spec = structuredClone(input);
  const changes: {
    pointer: string;
    reason: string;
    before: Json;
    after: Json;
  }[] = [];
  const inferType = (value: Json) =>
    value === null
      ? "null"
      : typeof value === "number"
        ? Number.isInteger(value)
          ? "integer"
          : "number"
        : typeof value;
  function visit(node: Json, pointer: string): void {
    if (Array.isArray(node)) {
      node.forEach((child, index) => {
        visit(child, `${pointer}/${index}`);
      });
      return;
    }
    if (!object(node)) return;
    const alternatives = node.oneOf;
    if (
      Array.isArray(alternatives) &&
      alternatives.length > 0 &&
      alternatives.every(
        (child) =>
          object(child) &&
          "const" in child &&
          Object.keys(child).every((key) => key === "const" || key === "type"),
      )
    ) {
      const values = alternatives.map(
        (child) => (child as ObjectValue).const as Json,
      );
      const types = new Set(values.map(inferType));
      if (
        types.size === 1 &&
        new Set(values.map((value) => JSON.stringify(value))).size ===
          values.length
      ) {
        const before = structuredClone(node);
        node.type = [...types][0] as string;
        node.enum = values;
        delete node.oneOf;
        changes.push({
          pointer,
          reason:
            "Equivalent homogeneous oneOf/const enumeration with an explicit primitive type",
          before,
          after: structuredClone(node),
        });
      }
    }
    if ("const" in node && !node.type) {
      const before = structuredClone(node);
      node.type = inferType(node.const as Json);
      changes.push({
        pointer,
        reason: "Infer type of const without removing its value constraint",
        before,
        after: structuredClone(node),
      });
    }
    for (const [key, child] of Object.entries(node))
      visit(
        child,
        `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      );
  }
  visit(spec, "");
  if (
    !object(spec.components) ||
    !object(spec.components.schemas) ||
    !object(spec.paths)
  )
    throw new Error("Expected components.schemas and paths");
  const errorEnvelope: ObjectValue = {
    type: "object",
    description:
      "Generation-only common K-OTP error view. Branch-specific const/data validation remains in the raw contract; this projection deliberately relaxes that discrimination.",
    properties: {
      defined: { type: "boolean" },
      code: { type: "string" },
      status: { type: "number" },
      message: { type: "string", "x-ms-primary-error-message": true },
      data: {},
    },
    required: ["defined", "code", "status", "message"],
    additionalProperties: true,
  };
  spec.components.schemas.KotpErrorEnvelope = errorEnvelope;
  for (const [url, methods] of Object.entries(spec.paths)) {
    if (!object(methods)) continue;
    for (const [method, operation] of Object.entries(methods)) {
      if (!object(operation) || !object(operation.responses)) continue;
      for (const [status, response] of Object.entries(operation.responses)) {
        if (
          !/^[45]\d\d$/.test(status) ||
          !object(response) ||
          !object(response.content)
        )
          continue;
        const content = response.content["application/json"];
        if (
          !object(content) ||
          !object(content.schema) ||
          !Array.isArray(content.schema.oneOf)
        )
          continue;
        const branches = content.schema.oneOf;
        if (
          !branches.every(
            (branch) =>
              object(branch) &&
              object(branch.properties) &&
              ["defined", "code", "status", "message"].every(
                (key) => key in (branch.properties as ObjectValue),
              ),
          )
        )
          throw new Error(
            `Unrecognized error envelope ${url}/${method}/${status}`,
          );
        const before = structuredClone(content.schema);
        content.schema = { $ref: "#/components/schemas/KotpErrorEnvelope" };
        changes.push({
          pointer: `/paths/${url.replaceAll("/", "~1")}/${method}/responses/${status}/content/application~1json/schema`,
          reason:
            "Relaxed generation-only object error view: keeps all envelope fields and arbitrary data, loses branch-specific validation/typed data",
          before,
          after: structuredClone(content.schema),
        });
      }
    }
  }
  return { spec, changes };
}
