import {
  createOtpClient,
  type IssueInput,
  type IssueResult,
  type OtpApiError,
  type OtpClientOptions,
  type OtpRequestOptions,
  type VerifyInput,
  type VerifyResult,
} from "@k-otp/sdk-core";
import {
  createOtpFlow,
  createOtpOperation,
  type OtpFlowController,
  type OtpFlowOptions,
  type OtpFlowState,
  type OtpIssueVerifyClient,
  type OtpOperationState,
  type OtpRunResult,
} from "@k-otp/sdk-core/internal";
import { derived, type Readable, readable } from "svelte/store";

/** Any client with `issue`/`verify` (an `OtpClient` from `createOtpClient`). */
export type OtpClientLike = OtpIssueVerifyClient;

/** A client instance, or options for `createOtpClient`. */
export type OtpClientSource = OtpClientLike | OtpClientOptions;

const toOtpClient = (source: OtpClientSource): OtpClientLike =>
  typeof (source as OtpClientLike).issue === "function" &&
  typeof (source as OtpClientLike).verify === "function"
    ? (source as OtpClientLike)
    : createOtpClient(source as OtpClientOptions);

type Store<TState> = {
  getState: () => TState;
  subscribe: (listener: () => void) => () => void;
};

/** A Svelte readable store over a headless store (subscribes lazily). */
const toReadable = <TState>(store: Store<TState>): Readable<TState> =>
  readable(store.getState(), (set) => {
    set(store.getState());
    return store.subscribe(() => set(store.getState()));
  });

/** A readable store of one operation's state, plus `run`/`reset`/`abort`. */
export type OtpOperationStore<TInput, TResult> = Readable<
  OtpOperationState<TResult>
> & {
  /**
   * Calls the API. Resolves `{ data }` or `{ error }` (never rejects with an
   * API error). Results of superseded calls are not written to the store.
   */
  run: (
    input: TInput,
    options?: OtpRequestOptions,
  ) => Promise<OtpRunResult<TResult>>;
  /** Aborts an in-flight call and clears `data`/`error`. */
  reset: () => void;
  /** Aborts an in-flight call without updating the store (teardown). */
  abort: () => void;
};

const operationStore = <TInput, TResult>(
  execute: (input: TInput, options: OtpRequestOptions) => Promise<TResult>,
): OtpOperationStore<TInput, TResult> => {
  const operation = createOtpOperation(execute);
  return {
    subscribe: toReadable(operation).subscribe,
    run: operation.run,
    reset: operation.reset,
    abort: operation.abort,
  };
};

/** A readable store of the flow state, plus its actions. */
export type OtpFlowStore = Readable<OtpFlowState> & {
  send: OtpFlowController["send"];
  resend: OtpFlowController["resend"];
  verify: OtpFlowController["verify"];
  reset: OtpFlowController["reset"];
  /** Aborts in-flight calls (teardown). */
  abort: OtpFlowController["abort"];
};

/**
 * The common issue -> verify flow as a store: idempotency key reuse after
 * ambiguous failures, resend cooldown (`resendCooldownMs` and server
 * `retryAfterMs`, ticking about once a second while subscribed) and
 * verification state.
 */
export const createOtpFlowStore = (
  source: OtpClientSource,
  options: OtpFlowOptions = {},
): OtpFlowStore => {
  const flow = createOtpFlow(toOtpClient(source), options);
  return {
    subscribe: toReadable(flow).subscribe,
    send: flow.send,
    resend: flow.resend,
    verify: flow.verify,
    reset: flow.reset,
    abort: flow.abort,
  };
};

export type OtpStores = {
  client: OtpClientLike;
  /** Readable store holding the client. */
  otpClientStore: Readable<OtpClientLike>;
  /** `POST /v1/issue`. Requires `input.idempotencyKey`. */
  issue: OtpOperationStore<IssueInput, IssueResult>;
  /** `POST /v1/verify`. */
  verify: OtpOperationStore<VerifyInput, VerifyResult>;
  /** `true` while either operation is in flight. */
  loading: Readable<boolean>;
  /** `verify`'s error, else `issue`'s. */
  error: Readable<OtpApiError | undefined>;
  /** Resets both operations. */
  reset: () => void;
  /** Aborts in-flight calls of both operations (call it on teardown). */
  abort: () => void;
  /** Creates an issue -> verify flow store bound to the same client. */
  createFlow: (options?: OtpFlowOptions) => OtpFlowStore;
};

/**
 * Creates the OTP stores for a client (or client options). Nothing is shared
 * between calls, so it is SSR-safe: create the stores per component (or per
 * request via `setOtpContext`), not in a module-level singleton on the server.
 * Creation performs no I/O.
 */
export const createOtpStores = (source: OtpClientSource): OtpStores => {
  const client = toOtpClient(source);
  const issue = operationStore<IssueInput, IssueResult>((input, o) =>
    client.issue(input, o),
  );
  const verify = operationStore<VerifyInput, VerifyResult>((input, o) =>
    client.verify(input, o),
  );
  return {
    client,
    otpClientStore: readable(client),
    issue,
    verify,
    loading: derived(
      [issue, verify],
      ([$issue, $verify]) => $issue.isLoading || $verify.isLoading,
    ),
    error: derived(
      [issue, verify],
      ([$issue, $verify]) => $verify.error ?? $issue.error,
    ),
    reset: () => {
      issue.reset();
      verify.reset();
    },
    abort: () => {
      issue.abort();
      verify.abort();
    },
    createFlow: (options) => createOtpFlowStore(client, options),
  };
};
