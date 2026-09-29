/**
 * Failure modes of the OpenAPI -> TypeScript generator
 * (`scripts/lib/openapi-types.ts`), with small inline specs.
 */
import { describe, expect, test } from "bun:test";
import {
  type OpenApiDocument,
  renderOpenApiTypes,
  summarizeOperations,
} from "../../../scripts/lib/openapi-types";

type Spec = {
  paths?: Record<string, unknown>;
  schemas?: Record<string, unknown>;
};

const ok = {
  "200": {
    description: "ok",
    content: { "application/json": { schema: { type: "string" } } },
  },
};

/** A one-operation document; override paths or component schemas. */
const doc = ({ paths, schemas }: Spec = {}): OpenApiDocument =>
  ({
    openapi: "3.1.0",
    info: { title: "test", version: "1.0.0" },
    paths: paths ?? {
      "/ping": { get: { operationId: "otp.ping", responses: ok } },
    },
    components: { schemas: schemas ?? {} },
  }) as unknown as OpenApiDocument;

const both = (spec: OpenApiDocument) => [
  () => renderOpenApiTypes(spec),
  () => summarizeOperations(spec),
];

describe("openapi generator", () => {
  test("a minimal document renders", () => {
    expect(renderOpenApiTypes(doc())).toContain("ping: {");
  });

  test("an operationId ending with '.' is rejected by render and summary", () => {
    const spec = doc({
      paths: { "/ping": { get: { operationId: "otp.", responses: ok } } },
    });
    for (const run of both(spec)) {
      expect(run).toThrow('GET /ping (otp.): operationId "otp." ends with "."');
    }
  });

  test("a missing operationId is rejected by render and summary", () => {
    const spec = doc({ paths: { "/ping": { get: { responses: ok } } } });
    for (const run of both(spec)) expect(run).toThrow("missing operationId");
  });

  test("duplicate operation names are rejected by render and summary", () => {
    const spec = doc({
      paths: {
        "/a": { get: { operationId: "a.ping", responses: ok } },
        "/b": { get: { operationId: "b.ping", responses: ok } },
      },
    });
    for (const run of both(spec)) {
      expect(run).toThrow('duplicate operation name "ping"');
    }
  });

  test("a JSON request body without a schema is rejected", () => {
    const spec = doc({
      paths: {
        "/ping": {
          post: {
            operationId: "otp.ping",
            requestBody: { content: { "application/json": {} } },
            responses: ok,
          },
        },
      },
    });
    for (const run of both(spec)) {
      expect(run).toThrow(
        'requestBody content["application/json"] has no schema',
      );
    }
  });

  test("a 2xx JSON response without a schema is rejected", () => {
    const spec = doc({
      paths: {
        "/ping": {
          get: {
            operationId: "otp.ping",
            responses: {
              "200": { description: "ok", content: { "application/json": {} } },
            },
          },
        },
      },
    });
    expect(() => renderOpenApiTypes(spec)).toThrow(
      '200 response content["application/json"] has no schema',
    );
  });

  test("a 2xx response with non-JSON content is rejected", () => {
    const spec = doc({
      paths: {
        "/ping": {
          get: {
            operationId: "otp.ping",
            responses: {
              "200": { description: "ok", content: { "text/plain": {} } },
            },
          },
        },
      },
    });
    expect(() => renderOpenApiTypes(spec)).toThrow(
      "200 response content must be application/json",
    );
  });

  test("a 204 response without content is allowed", () => {
    const spec = doc({
      paths: {
        "/ping": {
          delete: {
            operationId: "otp.ping",
            responses: { "204": { description: "gone" } },
          },
        },
      },
    });
    expect(renderOpenApiTypes(spec)).toContain("response: undefined;");
  });

  test.each(["string", "default", "OpenApiOperations"])(
    "reserved component name %s is rejected",
    (name) => {
      const spec = doc({ schemas: { [name]: { type: "string" } } });
      expect(() => renderOpenApiTypes(spec)).toThrow(
        `Component schema name "${name}" is reserved`,
      );
    },
  );

  test("an unsupported keyword names its location", () => {
    const spec = doc({
      schemas: {
        Issue: {
          type: "object",
          properties: { id: { type: "string", if: { type: "string" } } },
        },
      },
    });
    expect(() => renderOpenApiTypes(spec)).toThrow(
      'Unsupported schema keyword "if" at components.schemas.Issue.properties.id',
    );
  });

  test("an unsupported keyword in an operation names the operation", () => {
    const spec = doc({
      paths: {
        "/ping": {
          get: {
            operationId: "otp.ping",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": { schema: { not: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    });
    expect(() => renderOpenApiTypes(spec)).toThrow(
      'Unsupported schema keyword "not" at GET /ping (otp.ping) 200 response',
    );
  });

  test("properties with a typed additionalProperties stay unsupported", () => {
    const spec = doc({
      schemas: {
        Bag: {
          type: "object",
          properties: { a: { type: "number" } },
          additionalProperties: { type: "string" },
        },
      },
    });
    expect(() => renderOpenApiTypes(spec)).toThrow(
      "Unsupported schema at components.schemas.Bag: properties (a) combined with a typed additionalProperties",
    );
  });

  test("component matching does not strip docs inside const/enum values", () => {
    // Same schema except for a `description` key INSIDE the const value: the
    // response must not be treated as the component.
    const spec = doc({
      schemas: {
        Marker: { const: { description: "a" } },
      },
      paths: {
        "/ping": {
          get: {
            operationId: "otp.ping",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { const: { description: "b" } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const rendered = renderOpenApiTypes(spec);
    expect(rendered).toContain('response: {"description":"b"};');
    expect(rendered).not.toContain("response: Marker;");
  });

  test("component matching still ignores top-level descriptions", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    const spec = doc({
      schemas: { Thing: { ...schema, description: "component docs" } },
      paths: {
        "/ping": {
          get: {
            operationId: "otp.ping",
            responses: {
              "200": {
                description: "ok",
                content: { "application/json": { schema } },
              },
            },
          },
        },
      },
    });
    expect(renderOpenApiTypes(spec)).toContain("response: Thing;");
  });
});
