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

export const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
] as const;

/** Schema keywords `type()` understands (shaping the rendered type). */
const TYPE_KEYWORDS = new Set([
  "$ref",
  "const",
  "enum",
  "oneOf",
  "anyOf",
  "allOf",
  "type",
  "items",
  "properties",
  "required",
  "additionalProperties",
]);
/** Keywords that only document or constrain values (no effect on the TS type). */
const IGNORED_KEYWORDS = new Set([
  "description",
  "example",
  "examples",
  "title",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "format",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "contentEncoding",
  "contentMediaType",
  "$comment",
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/**
 * Names a component schema cannot take: `export type <name> = ...` is invalid
 * (reserved words, predefined type names) or would clash with the other
 * declarations of the generated module.
 */
const RESERVED_TYPE_NAMES = new Set([
  // Reserved words and strict-mode reserved words.
  ...[
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "new",
    "null",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "implements",
    "interface",
    "let",
    "package",
    "private",
    "protected",
    "public",
    "static",
    "yield",
    "await",
  ],
  // Predefined type names (`type string = ...` is an error).
  ...[
    "any",
    "unknown",
    "never",
    "object",
    "string",
    "number",
    "bigint",
    "boolean",
    "symbol",
    "undefined",
  ],
  // Declared by the generated module itself.
  "OpenApiOperations",
  "OPENAPI_VERSION",
]);
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

/** Keywords whose values are data, not schemas: compared verbatim. */
const VALUE_KEYWORDS = new Set(["const", "enum", "default"]);

/**
 * JSON value equality that ignores documentation-only keywords. Keys of
 * `properties` / `patternProperties` maps are property NAMES (a property may
 * well be called `description`), so those are never stripped, and the values
 * of `const` / `enum` / `default` are data (`{ const: { description: "x" } }`
 * is a different type than `{ const: {} }`), so those are never recursed into.
 */
const stripDocs = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(stripDocs);
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "description" || key === "example" || key === "examples") {
      continue;
    }
    const child = value[key] as Json;
    if (VALUE_KEYWORDS.has(key)) {
      out[key] = child;
    } else if (
      (key === "properties" || key === "patternProperties") &&
      isObject(child)
    ) {
      const map: JsonObject = {};
      for (const name of Object.keys(child).sort()) {
        map[name] = stripDocs(child[name] as Json);
      }
      out[key] = map;
    } else {
      out[key] = stripDocs(child);
    }
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

  /**
   * Renders a schema as a TypeScript type expression. `at` names the schema's
   * location (e.g. `components.schemas.Issue.properties.id`) for errors.
   */
  type(schema: Json, indent = "", at = "schema"): string {
    if (
      schema === true ||
      (isObject(schema) && Object.keys(schema).length === 0)
    ) {
      return "unknown";
    }
    if (!isObject(schema)) {
      throw new Error(`Unsupported schema at ${at}: ${JSON.stringify(schema)}`);
    }
    for (const key of Object.keys(schema)) {
      if (!TYPE_KEYWORDS.has(key) && !IGNORED_KEYWORDS.has(key)) {
        throw new Error(`Unsupported schema keyword "${key}" at ${at}`);
      }
    }

    if (typeof schema.$ref === "string") return this.refName(schema.$ref);
    if ("const" in schema) return JSON.stringify(schema.const);
    if (Array.isArray(schema.enum)) {
      return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
    }
    const unionKey = schema.oneOf !== undefined ? "oneOf" : "anyOf";
    const union = schema[unionKey];
    if (Array.isArray(union)) {
      return union
        .map((member, i) =>
          this.type(member, indent, `${at}.${unionKey}[${i}]`),
        )
        .join(" | ");
    }
    if (Array.isArray(schema.allOf)) {
      return schema.allOf
        .map((member, i) =>
          this.wrap(this.type(member, indent, `${at}.allOf[${i}]`)),
        )
        .join(" & ");
    }
    if (Array.isArray(schema.type)) {
      return schema.type
        .map((type) => this.type({ ...schema, type }, indent, at))
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
        return `${this.wrap(this.type(schema.items ?? {}, indent, `${at}.items`))}[]`;
      case "object":
      case undefined:
        return this.objectType(schema, indent, at);
      default:
        throw new Error(
          `Unsupported schema type "${String(schema.type)}" at ${at}`,
        );
    }
  }

  objectType(schema: JsonObject, indent: string, at = "schema"): string {
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
        `${docComment(isObject(property) ? property.description : undefined, inner)}${inner}${quoteKey(name)}${optional}: ${this.type(property, inner, `${at}.properties.${name}`)};`,
      );
    }
    if (extra !== undefined && extra !== false) {
      if (extra !== true && names.length > 0) {
        // An index signature must accept every declared property's type, so
        // `{ a: number; [key: string]: string }` does not compile. It could be
        // rendered soundly (widen the index type to include the property
        // types, or an intersection), but the spec never needs it: stay
        // conservative and fail until it does.
        throw new Error(
          `Unsupported schema at ${at}: properties (${names.join(", ")}) combined with a typed additionalProperties`,
        );
      }
      members.push(
        `${inner}[key: string]: ${extra === true ? "unknown" : this.type(extra, inner, `${at}.additionalProperties`)};`,
      );
    }
    if (members.length === 0) return "Record<string, never>";
    return `{\n${members.join("\n")}\n${indent}}`;
  }

  /** Parenthesizes unions/intersections (legal around object literals too). */
  private wrap(type: string): string {
    return /[|&]/.test(type) ? `(${type})` : type;
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

/** The `application/json` request body of an operation, if any. */
const jsonRequestBody = (
  operation: JsonObject,
  where: string,
): { body: JsonObject; media: JsonObject } | undefined => {
  if (operation.requestBody === undefined) return undefined;
  const body = operation.requestBody;
  const media =
    isObject(body) && isObject(body.content)
      ? body.content["application/json"]
      : undefined;
  if (!isObject(body) || !isObject(media)) {
    throw new Error(
      `${where}: requestBody must have content["application/json"]`,
    );
  }
  if (media.schema === undefined) {
    throw new Error(
      `${where}: requestBody content["application/json"] has no schema`,
    );
  }
  return { body, media };
};

/**
 * Status and JSON schema of the first 2xx response. A response without
 * `content` (e.g. 204) has no schema; a response WITH content must be
 * `application/json` with a schema.
 */
const successResponse = (
  operation: JsonObject,
  where: string,
): { status: string; schema: Json | undefined } => {
  const responses = isObject(operation.responses) ? operation.responses : {};
  const status = Object.keys(responses)
    .filter((code) => /^2\d\d$/.test(code))
    .sort()[0];
  if (status === undefined) throw new Error(`${where}: no 2xx response`);
  const response = responses[status];
  if (!isObject(response) || response.content === undefined) {
    return { status, schema: undefined };
  }
  const media = isObject(response.content)
    ? response.content["application/json"]
    : undefined;
  if (!isObject(media)) {
    throw new Error(
      `${where}: ${status} response content must be application/json`,
    );
  }
  if (media.schema === undefined) {
    throw new Error(
      `${where}: ${status} response content["application/json"] has no schema`,
    );
  }
  return { status, schema: media.schema };
};

/** `METHOD /path (operationId)`, for error messages. */
const describeOperation = (
  method: string,
  path: string,
  operation: JsonObject,
): string =>
  `${method.toUpperCase()} ${path} (${String(operation.operationId)})`;

/** `otp.issue` -> `issue`. */
const operationKey = (operationId: unknown, where: string): string => {
  if (typeof operationId !== "string" || operationId === "") {
    throw new Error(`${where}: missing operationId`);
  }
  const key = operationId.slice(operationId.lastIndexOf(".") + 1);
  if (key === "") {
    throw new Error(`${where}: operationId "${operationId}" ends with "."`);
  }
  return key;
};

/**
 * Every operation with its validated, unique operation key. Shared by the
 * summary and the renderer so both enforce the same operationId rules.
 */
type OperationEntry = {
  path: string;
  method: (typeof HTTP_METHODS)[number];
  operation: JsonObject;
  where: string;
  key: string;
};

const eachOperation = (doc: OpenApiDocument): OperationEntry[] => {
  const out: OperationEntry[] = [];
  const keys = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const where = describeOperation(method, path, operation);
      const key = operationKey(operation.operationId, where);
      if (keys.has(key)) {
        throw new Error(`${where}: duplicate operation name "${key}"`);
      }
      keys.add(key);
      out.push({ path, method, operation, where, key });
    }
  }
  return out;
};

/** Flat, comparable view of every operation in the document. */
export const summarizeOperations = (
  doc: OpenApiDocument,
): OperationSummary[] => {
  const operations: OperationSummary[] = [];
  const globalSecurity = Array.isArray(doc.security) ? doc.security : [];
  for (const { path, method, operation, where } of eachOperation(doc)) {
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
    const json = jsonRequestBody(operation, where);
    const body = json?.body;
    const bodySchema = json?.media.schema;
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
  return operations;
};

const paramsObject = (
  renderer: OpenApiTypeRenderer,
  parameters: JsonObject[],
  location: string,
  indent: string,
  where: string,
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
    const at = `${where} ${location} parameter ${String(parameter.name)}`;
    return `${docComment(parameter.description, inner)}${inner}${quoteKey(name)}${optional}: ${renderer.type(parameter.schema ?? {}, inner, at)};`;
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
    if (!IDENTIFIER.test(name)) {
      throw new Error(
        `Component schema name "${name}" is not a valid TypeScript identifier`,
      );
    }
    if (RESERVED_TYPE_NAMES.has(name)) {
      throw new Error(
        `Component schema name "${name}" is reserved and cannot be a generated type name`,
      );
    }
    out.push(
      `${docComment(schema.description, "")}export type ${name} = ${renderer.type(schema, "", `components.schemas.${name}`)};`,
      "",
    );
  }

  out.push(
    "/** Wire-level request/response types for every OpenAPI operation, keyed by operation name. */",
    "export interface OpenApiOperations {",
  );
  for (const { path, method, operation, where, key } of eachOperation(doc)) {
    const parameters = (
      Array.isArray(operation.parameters) ? operation.parameters : []
    ) as JsonObject[];
    const body = jsonRequestBody(operation, where)?.media;
    const ok = successResponse(operation, where);
    const typeOf = (
      schema: Json | undefined,
      indent: string,
      at: string,
    ): string => {
      if (schema === undefined) return "undefined";
      return (
        renderer.componentNameFor(schema) ?? renderer.type(schema, indent, at)
      );
    };
    const indent = "    ";
    out.push(
      `${docComment(`${method.toUpperCase()} ${path} (\`${String(operation.operationId)}\`)`, "  ")}  ${quoteKey(key)}: {`,
      `    operationId: ${JSON.stringify(operation.operationId)};`,
      `    method: ${JSON.stringify(method.toUpperCase())};`,
      `    path: ${JSON.stringify(path)};`,
      `    params: ${paramsObject(renderer, parameters, "path", indent, where)};`,
      `    query: ${paramsObject(renderer, parameters, "query", indent, where)};`,
      `    headers: ${paramsObject(renderer, parameters, "header", indent, where)};`,
      `    body: ${typeOf(body?.schema, indent, `${where} requestBody`)};`,
      `    response: ${typeOf(ok.schema, indent, `${where} ${ok.status} response`)};`,
      "  };",
    );
  }
  out.push("}", "");
  return out.join("\n");
};
