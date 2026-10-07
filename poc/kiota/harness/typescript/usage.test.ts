import { expect, test } from "bun:test";
import { createUntypedNodeFromDiscriminatorValue } from "@microsoft/kiota-abstractions";
import { JsonParseNode } from "@microsoft/kiota-serialization-json";
import {
  type BalanceGetResponse,
  createBalanceGetResponseFromDiscriminatorValue,
} from "./generated/balance";
import { jsonValue, KotpJsonParseNodeFactory } from "./usage";

test("untyped runtime data keeps numeric-looking strings, false, null and user value/getValue keys", () => {
  const value = { value: { getValue: "001" }, nested: [null, false, 3, "001"] };
  const parsed = new JsonParseNode(value).getObjectValue(
    createUntypedNodeFromDiscriminatorValue,
  );
  expect(jsonValue(parsed)).toEqual(value);
});

test("actual null and an empty object remain distinct with interleaved response parse nodes", () => {
  const factory = new KotpJsonParseNodeFactory();
  const node = (value: unknown) =>
    factory.getRootParseNode(
      "application/json",
      new TextEncoder().encode(JSON.stringify(value)).buffer,
    );
  const absent = node({ promoNextExpiry: null });
  const empty = node({ promoNextExpiry: {} });
  const object = node({
    promoNextExpiry: { at: "2026-10-08T00:00:00Z", amount: 20 },
  });
  expect(
    empty.getObjectValue<BalanceGetResponse>(
      createBalanceGetResponseFromDiscriminatorValue,
    )?.promoNextExpiry,
  ).toEqual({});
  expect(
    object.getObjectValue<BalanceGetResponse>(
      createBalanceGetResponseFromDiscriminatorValue,
    )?.promoNextExpiry?.amount,
  ).toBe(20);
  expect(
    absent.getObjectValue<BalanceGetResponse>(
      createBalanceGetResponseFromDiscriminatorValue,
    )?.promoNextExpiry,
  ).toBeNull();
});
