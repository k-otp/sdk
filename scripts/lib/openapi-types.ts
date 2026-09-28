/**
 * Minimal, dependency-free OpenAPI 3.1 -> TypeScript type generator.
 *
 * It only supports the JSON Schema subset the K-OTP spec uses (objects,
 * arrays, primitives, `const`, `enum`, `oneOf`/`anyOf`, local `$ref`). Anything
 * else fails loudly so a spec change can never silently produce `unknown`.
 *
 * We do not use `openapi-typescript` because it drives the TypeScript JS
 * compiler API, which TypeScript 7 (the Go-native compiler used here) does not
 * ship.
 *
 * The output is deterministic so the drift test can regenerate it in memory
 * and compare it byte-for-byte with the committed file.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export type OpenApiDocument = JsonObject & {
  info: { title: string; version: string };
  paths: Record<string, Record<string, JsonObject>>;
  components?: { schemas?: Record<string, JsonObject> };
};

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SCHEMA_REF_PREFIX = "#/components/schemas/";

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const quoteKey = (key: string): string =>
  IDENTIFIER.test(key) ? key : JSON.stringify(key);

const docComment = (text: unknown, indent: string): string => {
  if (typeof text !== "string" || text.trim() === "") return "";
  const lines = text
    .replaceAll("*/", "*\\/")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd());
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines
    .map((line) => (line ? `${indent} * ${line}` : `${indent} *`))
    .join("\n")}\n${indent} */\n`;
};

/** JSON value equality that ignores documentation-only keywords. */
const stripDocs = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(stripDocs);
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "description" || key === "example" || key === "examples") {
      continue;
    }
    out[key] = stripDocs(value[key] as Json);
  }
  return out;
};

const sameSchema = (a: Json, b: Json): boolean =>
  JSON.stringify(stripDocs(a)) === JSON.stringify(stripDocs(b));

export class OpenApiTypeRenderer {
  readonly #schemas: Record<string, JsonObject>;

  constructor(doc: OpenApiDocument) {
    this.#schemas = doc.components?.schemas ?? {};
  }

  /** Component name whose schema is identical to `schema`, if any. */
  componentNameFor(schema: Json): string | undefined {
    if (isObject(schema) && typeof schema.$ref === "string") {
      return this.refName(schema.$ref);
    }
    for (const [name, component] of Object.entries(this.#schemas)) {
      if (sameSchema(component, schema)) return name;
    }
    return undefined;
  }

  refName(ref: string): string {
    if (!ref.startsWith(SCHEMA_REF_PREFIX)) {
      throw new Error(`Unsupported $ref: ${ref}`);
    }
    const name = ref.slice(SCHEMA_REF_PREFIX.length);
    if (!(name in this.#schemas)) throw new Error(`Unknown $ref: ${ref}`);
    return name;
  }

  /** Renders a schema as a TypeScript type expression. */
  type(schema: Json, indent = ""): string {
    if (
      schema === true ||
      (isObject(schema) && Object.keys(schema).length === 0)
    ) {
      return "unknown";
    }
    if (!isObject(schema)) throw new Error(`Unsupported schema: ${schema}`);

    if (typeof schema.$ref === "string") return this.refName(schema.$ref);
    if ("const" in schema) return JSON.stringify(schema.const);
    if (Array.isArray(schema.enum)) {
      return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
    }
    const union = schema.oneOf ?? schema.anyOf;
    if (Array.isArray(union)) {
      return union.map((member) => this.type(member, indent)).join(" | ");
    }
    if (Array.isArray(schema.allOf)) {
      return schema.allOf
        .map((member) => this.wrap(this.type(member, indent)))
        .join(" & ");
    }
    if (Array.isArray(schema.type)) {
      return schema.type
        .map((type) => this.type({ ...schema, type }, indent))
        .join(" | ");
    }

    switch (schema.type) {
      case "string":
        return "string";
      case "number":
      case "integer":
        return "number";
      case "boolean":
        return "boolean";
      case "null":
        return "null";
      case "array":
        return `${this.wrap(this.type(schema.items ?? {}, indent))}[]`;
      case "object":
      case undefined:
        return this.objectType(schema, indent);
      default:
        throw new Error(`Unsupported schema type: ${String(schema.type)}`);
    }
  }

  objectType(schema: JsonObject, indent: string): string {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = new Set(
      Array.isArray(schema.required) ? (schema.required as string[]) : [],
    );
    const names = Object.keys(properties);
    const extra = schema.additionalProperties;
    const inner = `${indent}  `;
    const members: string[] = [];

    for (const name of names) {
      const property = properties[name] as Json;
      const optional = required.has(name) ? "" : "?";
      members.push(
        `${docComment(isObject(property) ? property.description : undefined, inner)}${inner}${quoteKey(name)}${optional}: ${this.type(property, inner)};`,
      );
    }
    if (extra !== undefined && extra !== false) {
      members.push(
        `${inner}[key: string]: ${extra === true ? "unknown" : this.type(extra, inner)};`,
      );
    }
    if (members.length === 0) return "Record<string, never>";
    return `{\n${members.join("\n")}\n${indent}}`;
  }

  private wrap(type: string): string {
    return /[|&]/.test(type) && !type.startsWith("{") ? `(${type})` : type;
  }
}

export type OperationSummary = {
  operationId: string;
  method: Uppercase<(typeof HTTP_METHODS)[number]>;
  path: string;
  security: string[];
  pathParams: { name: string; required: boolean }[];
  queryParams: { name: string; required: boolean }[];
  headerParams: { name: string; required: boolean }[];
  requestBody?: { required: boolean; requiredFields: string[] };
  responseStatuses: string[];
};

const resolve = (doc: OpenApiDocument, schema: Json): JsonObject => {
  if (isObject(schema) && typeof schema.$ref === "string") {
    const name = schema.$ref.slice(SCHEMA_REF_PREFIX.length);
    const target = doc.components?.schemas?.[name];
    if (!target) throw new Error(`Unknown $ref: ${schema.$ref}`);
    return target;
  }
  if (!isObject(schema)) throw new Error("Expected schema object");
  return schema;
};

/** Flat, comparable view of every operation in the document. */
export const summarizeOperations = (
  doc: OpenApiDocument,
): OperationSummary[] => {
  const operations: OperationSummary[] = [];
  const globalSecurity = Array.isArray(doc.security) ? doc.security : [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const parameters = (
        Array.isArray(operation.parameters) ? operation.parameters : []
      ) as JsonObject[];
      const params = (location: string) =>
        parameters
          .filter((parameter) => parameter.in === location)
          .map((parameter) => ({
            name: String(parameter.name),
            required: parameter.required === true,
          }));
      const body = isObject(operation.requestBody)
        ? operation.requestBody
        : undefined;
      const bodySchema = body
        ? ((body.content as JsonObject)["application/json"] as JsonObject)
            .schema
        : undefined;
      const security = (
        Array.isArray(operation.security) ? operation.security : globalSecurity
      ) as JsonObject[];
      operations.push({
        operationId: String(operation.operationId),
        method: method.toUpperCase() as OperationSummary["method"],
        path,
        security: security.flatMap((requirement) => Object.keys(requirement)),
        pathParams: params("path"),
        queryParams: params("query"),
        headerParams: params("header"),
        ...(body && bodySchema !== undefined
          ? {
              requestBody: {
                required: body.required === true,
                requiredFields: [
                  ...((resolve(doc, bodySchema).required as string[]) ?? []),
                ],
              },
            }
          : {}),
        responseStatuses: Object.keys(
          isObject(operation.responses) ? operation.responses : {},
        ),
      });
    }
  }
  return operations;
};

const operationKey = (operationId: string): string => {
  // `otp.issue` -> `issue`
  const segments = operationId.split(".");
  return segments[segments.length - 1] ?? operationId;
};

const paramsObject = (
  renderer: OpenApiTypeRenderer,
  parameters: JsonObject[],
  location: string,
  indent: string,
): string => {
  const selected = parameters.filter((parameter) => parameter.in === location);
  if (selected.length === 0) return "undefined";
  const inner = `${indent}  `;
  const members = selected.map((parameter) => {
    const name =
      location === "header"
        ? String(parameter.name).toLowerCase()
        : String(parameter.name);
    const optional = parameter.required === true ? "" : "?";
    return `${docComment(parameter.description, inner)}${inner}${quoteKey(name)}${optional}: ${renderer.type(parameter.schema ?? {}, inner)};`;
  });
  return `{\n${members.join("\n")}\n${indent}}`;
};

/** Renders the full generated module. */
export const renderOpenApiTypes = (doc: OpenApiDocument): string => {
  const renderer = new OpenApiTypeRenderer(doc);
  const out: string[] = [];
  out.push(
    "// This file is generated by `bun run gen:types` from spec/openapi.json.",
    "// Do not edit by hand: the OpenAPI drift test fails when it is stale.",
    `// Source: ${doc.info.title} ${doc.info.version}`,
    "",
    `export const OPENAPI_VERSION = ${JSON.stringify(doc.info.version)};`,
    "",
  );

  for (const [name, schema] of Object.entries(doc.components?.schemas ?? {})) {
    out.push(
      `${docComment(schema.description, "")}export type ${name} = ${renderer.type(schema)};`,
      "",
    );
  }

  out.push(
    "/** Wire-level request/response types for every OpenAPI operation, keyed by operation name. */",
    "export interface OpenApiOperations {",
  );
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const parameters = (
        Array.isArray(operation.parameters) ? operation.parameters : []
      ) as JsonObject[];
      const body = isObject(operation.requestBody)
        ? ((operation.requestBody.content as JsonObject)[
            "application/json"
          ] as JsonObject)
        : undefined;
      const responses = isObject(operation.responses)
        ? operation.responses
        : {};
      const ok = responses["200"] ?? responses["201"];
      const okSchema =
        isObject(ok) && isObject(ok.content)
          ? (ok.content["application/json"] as JsonObject | undefined)?.schema
          : undefined;
      const typeOf = (schema: Json | undefined, indent: string): string => {
        if (schema === undefined) return "undefined";
        return (
          renderer.componentNameFor(schema) ?? renderer.type(schema, indent)
        );
      };
      const indent = "    ";
      out.push(
        `${docComment(`${method.toUpperCase()} ${path} (\`${String(operation.operationId)}\`)`, "  ")}  ${quoteKey(operationKey(String(operation.operationId)))}: {`,
        `    operationId: ${JSON.stringify(operation.operationId)};`,
        `    method: ${JSON.stringify(method.toUpperCase())};`,
        `    path: ${JSON.stringify(path)};`,
        `    params: ${paramsObject(renderer, parameters, "path", indent)};`,
        `    query: ${paramsObject(renderer, parameters, "query", indent)};`,
        `    headers: ${paramsObject(renderer, parameters, "header", indent)};`,
        `    body: ${typeOf(body?.schema, indent)};`,
        `    response: ${typeOf(okSchema, indent)};`,
        "  };",
      );
    }
  }
  out.push("}", "");
  return out.join("\n");
};
