import type { OtpPublicContract } from "./contract";
import { normalizeIdempotencyKey } from "./idempotency";
import type { OtpRequestOptions, OtpTransport } from "./transport";
import type {
  IssueInput,
  IssueResult,
  VerifyInput,
  VerifyResult,
} from "./types";

/**
 * `POST /issue`. Validates the idempotency key before any network request and
 * sends it as both the `Idempotency-Key` header and the body field (the API
 * requires them to match when both are present).
 */
export const issueWith = async (
  transport: OtpTransport<OtpPublicContract>,
  input: IssueInput,
  options?: OtpRequestOptions,
): Promise<IssueResult> => {
  const idempotencyKey = normalizeIdempotencyKey(input?.idempotencyKey);
  const body = { ...input, idempotencyKey };
  return transport.call(
    "issue",
    (callOptions) =>
      transport.client.issue(
        { headers: { "idempotency-key": idempotencyKey }, body },
        callOptions,
      ),
    options,
  );
};

/** `POST /verify`. Wrong codes resolve with `verified: false` + `reasonCode`. */
export const verifyWith = async (
  transport: OtpTransport<OtpPublicContract>,
  input: VerifyInput,
  options?: OtpRequestOptions,
): Promise<VerifyResult> =>
  transport.call(
    "verify",
    (callOptions) => transport.client.verify(input, callOptions),
    options,
  );
