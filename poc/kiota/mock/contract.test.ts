import { expect, test } from "bun:test";
import { config, redact, root } from "../scripts/common";
import { evaluate, fixture, startContractServer } from "./contract";

test("common fixtures cover exactly the input document's public operation count", async () => {
  const spec = await Bun.file(`${root}/${config.spec}`).json();
  const operations = Object.values(spec.paths).flatMap((methods) =>
    Object.entries(methods as object).filter(([method]) =>
      ["get", "post", "put", "patch", "delete"].includes(method),
    ),
  );
  expect(new Set(fixture.cases.map((value) => value.operation)).size).toBe(
    operations.length,
  );
  expect(operations.length).toBe(9);
});

test("mock refuses unexpected requests and reports counts; artifacts mask credentials and codes", async () => {
  const mock = startContractServer();
  try {
    const response = await fetch(`${mock.baseUrl}/surprise`);
    expect(response.status).toBe(418);
    expect(mock.violations).toContain(
      "missing-case: unexpected network request",
    );
    expect(
      evaluate([], mock.requests, mock.violations)
        .filter((value) => value.kind !== "retry-observation")
        .every((value) => value.status === "failed"),
    ).toBe(true);
    expect(
      redact(
        'Bearer sk_poc_fake_never_valid {"code":"001203","phoneNumber":"00000000000"}',
      ),
    ).not.toContain("001203");
    expect(redact("Bearer sk_poc_fake_never_valid")).not.toContain(
      "sk_poc_fake",
    );
  } finally {
    await mock.server.stop(true);
  }
});
