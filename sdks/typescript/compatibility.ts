import {
  isUntypedNode,
  type Parsable,
  type ParsableFactory,
} from "@microsoft/kiota-abstractions";
import {
  JsonParseNode,
  JsonParseNodeFactory,
} from "@microsoft/kiota-serialization-json";

// Use the real generated deserializers to construct dictionary/union models.
export function model<T extends Parsable>(
  input: unknown,
  factory: ParsableFactory<T>,
): T {
  const value = new JsonParseNode(input).getObjectValue(factory);
  if (!value) throw new TypeError("Generated request model could not be read");
  return value;
}

// UntypedNode is the runtime's parsed representation, not the public JSON view.
// Checking the callable getter preserves user objects with a `value` key.
export function jsonValue(value: unknown): unknown {
  if (isUntypedNode(value) && typeof value.getValue === "function")
    return jsonValue(value.getValue());
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, jsonValue(child)]),
    );
  return value;
}

// A null object otherwise becomes an empty generated model. Restore it from
// this response's actual parse input; there is no shared last-response state.
export class KotpJsonParseNodeFactory extends JsonParseNodeFactory {
  override getRootParseNode(contentType: string, content: ArrayBuffer) {
    const raw = JSON.parse(new TextDecoder().decode(content)) as {
      promoNextExpiry?: unknown;
    } | null;
    const node = super.getRootParseNode(contentType, content);
    node.onAfterAssignFieldValues = (instance) => {
      if (
        raw !== null &&
        raw.promoNextExpiry === null &&
        Object.hasOwn(instance, "promoNextExpiry")
      )
        (instance as { promoNextExpiry?: unknown }).promoNextExpiry = null;
    };
    return node;
  }
}
