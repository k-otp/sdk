import { useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  IssueInput,
  IssueResult,
  OtpRequestOptions,
  VerifyInput,
  VerifyResult,
} from "../core";
import {
  createOtpFlow,
  createOtpOperation,
  type OtpFlowController,
  type OtpFlowOptions,
  type OtpFlowState,
  type OtpOperationController,
  type OtpOperationState,
  type OtpRunResult,
} from "../headless";
import { type OtpClientLike, useOtpClient } from "./context";

export type UseOtpOperationOptions = {
  /** Use this client instead of the one from `OtpProvider`. */
  client?: OtpClientLike;
};

/** State of one operation plus `run` and `reset` (both stable). */
export type UseOtpOperationResult<TInput, TResult> =
  OtpOperationState<TResult> & {
    /**
     * Calls the API. Resolves `{ data }` or `{ error }` (never rejects with
     * an API error). Results of superseded calls are not written to state.
     */
    run: (
      input: TInput,
      options?: OtpRequestOptions,
    ) => Promise<OtpRunResult<TResult>>;
    /** Aborts an in-flight call and clears `data`/`error`. */
    reset: () => void;
  };

type Store<TState> = {
  getState: () => TState;
  subscribe: (listener: () => void) => () => void;
  abort: () => void;
};

/** Subscribes to a headless store and aborts its requests on unmount. */
const useStore = <TState>(store: Store<TState>): TState => {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  );
  useEffect(() => () => store.abort(), [store]);
  return state;
};

const useOperation = <TInput, TResult>(
  operation: OtpOperationController<TInput, TResult>,
): UseOtpOperationResult<TInput, TResult> => {
  const state = useStore(operation);
  return useMemo(
    () => ({ ...state, run: operation.run, reset: operation.reset }),
    [state, operation],
  );
};

/** `POST /v1/issue` with loading/error state. Requires `input.idempotencyKey`. */
export const useOtpIssue = (
  options: UseOtpOperationOptions = {},
): UseOtpOperationResult<IssueInput, IssueResult> => {
  const client = useOtpClient(options.client);
  const operation = useMemo(
    () =>
      createOtpOperation<IssueInput, IssueResult>((input, o) =>
        client.issue(input, o),
      ),
    [client],
  );
  return useOperation(operation);
};

/** `POST /v1/verify` with loading/error state. */
export const useOtpVerify = (
  options: UseOtpOperationOptions = {},
): UseOtpOperationResult<VerifyInput, VerifyResult> => {
  const client = useOtpClient(options.client);
  const operation = useMemo(
    () =>
      createOtpOperation<VerifyInput, VerifyResult>((input, o) =>
        client.verify(input, o),
      ),
    [client],
  );
  return useOperation(operation);
};

export type UseOtpFlowOptions = OtpFlowOptions & UseOtpOperationOptions;

export type UseOtpFlowResult = OtpFlowState & {
  send: OtpFlowController["send"];
  resend: OtpFlowController["resend"];
  verify: OtpFlowController["verify"];
  reset: OtpFlowController["reset"];
};

/**
 * The common issue -> verify flow: manages the idempotency key (reused when
 * retrying after an ambiguous failure), the resend cooldown (`resendCooldownMs`
 * and server `retryAfterMs`) and verification state. Options are read when
 * the flow is created (and again if the client changes).
 */
export const useOtpFlow = (
  options: UseOtpFlowOptions = {},
): UseOtpFlowResult => {
  const client = useOtpClient(options.client);
  // biome-ignore lint/correctness/useExhaustiveDependencies: options are read once per client.
  const flow = useMemo(() => createOtpFlow(client, options), [client]);
  const state = useStore(flow);
  return useMemo(
    () => ({
      ...state,
      send: flow.send,
      resend: flow.resend,
      verify: flow.verify,
      reset: flow.reset,
    }),
    [state, flow],
  );
};
