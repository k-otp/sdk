/**
 * OpenAPI drift test: fails when the in-repo oRPC contract or the generated
 * types disagree with the vendored `spec/openapi.json`.
 *
 * When this fails after `bun run sync:openapi`, run `bun run gen:types`,
 * update `src/core/contract.ts` for added/removed operations, and review the diff.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isContractProcedure } from "@orpc/contract";
import {
  type OpenApiDocument,
  renderOpenApiTypes,
  summarizeOperations,
} from "../../../scripts/lib/openapi-types";
import { DEFAULT_BASE_URL, otpErrorCodeFromStatus } from "../src/core";
import {
  OPENAPI_VERSION,
  otpPublicContract,
  otpServerContract,
} from "../src/core/contract";

const root = path.resolve(import.meta.dir, "../../..");
const spec = JSON.parse(
  readFileSync(path.join(root, "spec/openapi.json"), "utf8"),
) as OpenApiDocument;
const operations = summarizeOperations(spec);

type Route = {
  method?: string;
  path?: string;
  operationId?: string;
  inputStructure?: string;
};
const routeOf = (procedure: unknown): Route =>
  (procedure as { "~orpc": { route: Route } })["~orpc"].route;

const contractEntries = Object.entries(otpServerContract).map(
  ([name, procedure]) => ({ name, procedure, route: routeOf(procedure) }),
);

const pathParams = (p: string): string[] =>
  [...p.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "").sort();

describe("OpenAPI drift", () => {
  test("generated types are up to date with spec/openapi.json", () => {
    const committed = readFileSync(
      path.join(import.meta.dir, "../src/core/generated/openapi.ts"),
      "utf8",
    );
    expect(committed).toBe(renderOpenApiTypes(spec));
    expect(OPENAPI_VERSION).toBe(spec.info.version);
  });

  test("every contract entry is a valid oRPC procedure", () => {
    for (const { procedure } of contractEntries) {
      expect(isContractProcedure(procedure)).toBe(true);
    }
  });

  test("contract and spec expose exactly the same operations", () => {
    expect(contractEntries.map((e) => e.route.operationId).sort()).toEqual(
      operations.map((o) => o.operationId).sort(),
    );
  });

  test("contract keys follow operationIds", () => {
    for (const { name, route } of contractEntries) {
      expect(route.operationId).toBe(`otp.${name}`);
    }
  });

  test.each(operations.map((o) => [o.operationId, o] as const))(
    "%s: method, path and parameters match",
    (_, operation) => {
      const entry = contractEntries.find(
        (e) => e.route.operationId === operation.operationId,
      );
      expect(entry).toBeDefined();
      const route = entry?.route ?? {};
      expect(route.method).toBe(operation.method);
      expect(route.path).toBe(operation.path);
      expect(pathParams(route.path ?? "")).toEqual(
        operation.pathParams.map((p) => p.name).sort(),
      );
      expect(operation.pathParams.every((p) => p.required)).toBe(true);

      // Header parameters can only be sent with the detailed input structure.
      if (operation.headerParams.length > 0) {
        expect(route.inputStructure).toBe("detailed");
      }
      // GET operations must not declare a request body.
      if (operation.method === "GET") {
        expect(operation.requestBody).toBeUndefined();
      }
    },
  );

  test("issue: Idempotency-Key header and required body fields", () => {
    const issue = operations.find((o) => o.operationId === "otp.issue");
    expect(issue?.headerParams.map((p) => p.name)).toEqual(["Idempotency-Key"]);
    expect(issue?.requestBody?.required).toBe(true);
    expect(issue?.requestBody?.requiredFields.sort()).toEqual([
      "phoneNumber",
      "purpose",
    ]);
    const verify = operations.find((o) => o.operationId === "otp.verify");
    expect(verify?.requestBody?.requiredFields.sort()).toEqual([
      "code",
      "issueId",
    ]);
  });

  test("public (pk_) contract matches the publicKey security scheme", () => {
    const publicOps = operations
      .filter((o) => o.security.includes("publicKey"))
      .map((o) => o.operationId)
      .sort();
    expect(
      Object.values(otpPublicContract)
        .map((p) => routeOf(p).operationId)
        .sort(),
    ).toEqual(publicOps);
    for (const operation of operations) {
      expect(operation.security).toContain("secretKey");
    }
  });

  test("every documented error status maps to a known error code", () => {
    for (const operation of operations) {
      for (const status of operation.responseStatuses) {
        const code = Number(status);
        if (code < 400) continue;
        expect(otpErrorCodeFromStatus(code)).not.toBe("UNKNOWN");
      }
    }
  });

  test("default base URL is the spec's production server", () => {
    const servers = (spec.servers ?? []) as { url: string }[];
    expect(servers[0]?.url).toBe(DEFAULT_BASE_URL);
  });
});
