import type {
  IssueInput,
  IssueResult,
  OtpApiError,
  OtpRequestOptions,
  VerifyInput,
  VerifyReasonCode,
  VerifyResult,
} from "@k-otp/sdk-core";
import {
  createOtpFlow,
  createOtpOperation,
  type OtpFlowController,
  type OtpFlowOptions,
  type OtpFlowState,
  type OtpOperationStatus,
  type OtpRunResult,
} from "@k-otp/sdk-core/headless";
import {
  type ComputedRef,
  computed,
  getCurrentScope,
  onScopeDispose,
  type ShallowRef,
  shallowRef,
} from "vue";
import { type OtpClientLike, useOtpClient } from "./plugin";

type Store<TState> = {
  getState: () => TState;
  subscribe: (listener: () => void) => () => void;
  abort: () => void;
};

/**
 * Mirrors a headless store into a shallow ref. Inside an effect scope
 * (component `setup`), the subscription is removed and in-flight requests
 * are aborted when the scope is disposed (unmount).
 */
const useStoreRef = <TState>(
  store: Store<TState>,
): Readonly<ShallowRef<TState>> => {
  const state = shallowRef(store.getState());
  const unsubscribe = store.subscribe(() => {
    state.value = store.getState();
  });
  if (getCurrentScope()) {
    onScopeDispose(() => {
      unsubscribe();
      store.abort();
    });
  }
  return state;
};

/** Refs of one operation plus `run` and `reset`. */
export type UseOtpOperation<TInput, TResult> = {
  status: ComputedRef<OtpOperationStatus>;
  loading: ComputedRef<boolean>;
  /** Normalized error of the latest call. */
  error: ComputedRef<OtpApiError | undefined>;
  /** Result of the latest successful call. */
  result: ComputedRef<TResult | undefined>;
  /**
   * Calls the API. Resolves `{ data }` or `{ error }` (never rejects with an
   * API error). Results of superseded calls are not written to the refs.
   */
  run: (
    input: TInput,
    options?: OtpRequestOptions,
  ) => Promise<OtpRunResult<TResult>>;
  /** Aborts an in-flight call and clears `result`/`error`. */
  reset: () => void;
};

const useOperation = <TInput, TResult>(
  execute: (input: TInput, options: OtpRequestOptions) => Promise<TResult>,
): UseOtpOperation<TInput, TResult> => {
  const operation = createOtpOperation(execute);
  const state = useStoreRef(operation);
  return {
    status: computed(() => state.value.status),
    loading: computed(() => state.value.isLoading),
    error: computed(() => state.value.error),
    result: computed(() => state.value.data),
    run: operation.run,
    reset: operation.reset,
  };
};

export type UseOtpOptions = {
  /** Use this client instead of the injected one. */
  client?: OtpClientLike;
};

export type UseOtpReturn = {
  client: OtpClientLike;
  /** `POST /v1/issue`. Requires `input.idempotencyKey`. */
  issue: UseOtpOperation<IssueInput, IssueResult>;
  /** `POST /v1/verify`. */
  verify: UseOtpOperation<VerifyInput, VerifyResult>;
  /** `true` while either operation is in flight. */
  loading: ComputedRef<boolean>;
  /** `verify.error`, else `issue.error`. */
  error: ComputedRef<OtpApiError | undefined>;
  /** Resets both operations. */
  reset: () => void;
};

/**
 * Issue/verify operations as refs. Call it in `setup()` (the client is
 * injected from `createOtpPlugin`/`provideOtpClient` unless `client` is
 * given). In-flight requests are aborted when the component unmounts.
 */
export const useOtp = (options: UseOtpOptions = {}): UseOtpReturn => {
  const client = useOtpClient(options.client);
  const issue = useOperation<IssueInput, IssueResult>((input, o) =>
    client.issue(input, o),
  );
  const verify = useOperation<VerifyInput, VerifyResult>((input, o) =>
    client.verify(input, o),
  );
  return {
    client,
    issue,
    verify,
    loading: computed(() => issue.loading.value || verify.loading.value),
    error: computed(() => verify.error.value ?? issue.error.value),
    reset: () => {
      issue.reset();
      verify.reset();
    },
  };
};

export type UseOtpFlowOptions = OtpFlowOptions & UseOtpOptions;

export type UseOtpFlowReturn = {
  /** The full immutable flow snapshot. */
  state: Readonly<ShallowRef<OtpFlowState>>;
  issueId: ComputedRef<string | undefined>;
  expiresAt: ComputedRef<string | undefined>;
  attemptsRemaining: ComputedRef<number | undefined>;
  verified: ComputedRef<boolean>;
  reasonCode: ComputedRef<VerifyReasonCode | undefined>;
  loading: ComputedRef<boolean>;
  sending: ComputedRef<boolean>;
  verifying: ComputedRef<boolean>;
  error: ComputedRef<OtpApiError | undefined>;
  idempotencyKey: ComputedRef<string | undefined>;
  cooldownRemainingMs: ComputedRef<number>;
  /** Remaining verify cooldown after a verify answered with a retry hint (429, or 503 with `Retry-After`), in ms. */
  verifyCooldownRemainingMs: ComputedRef<number>;
  canSend: ComputedRef<boolean>;
  canVerify: ComputedRef<boolean>;
  send: OtpFlowController["send"];
  resend: OtpFlowController["resend"];
  verify: OtpFlowController["verify"];
  reset: OtpFlowController["reset"];
};

/**
 * The common issue -> verify flow: manages the idempotency key (reused when
 * retrying after an ambiguous failure), the resend cooldown and verification
 * state.
 */
export const useOtpFlow = (
  options: UseOtpFlowOptions = {},
): UseOtpFlowReturn => {
  const flow = createOtpFlow(useOtpClient(options.client), options);
  const state = useStoreRef(flow);
  const pick = <K extends keyof OtpFlowState>(
    key: K,
  ): ComputedRef<OtpFlowState[K]> => computed(() => state.value[key]);
  return {
    state,
    issueId: pick("issueId"),
    expiresAt: pick("expiresAt"),
    attemptsRemaining: pick("attemptsRemaining"),
    verified: pick("verified"),
    reasonCode: pick("reasonCode"),
    loading: pick("isLoading"),
    sending: computed(() => state.value.issueState.isLoading),
    verifying: computed(() => state.value.verifyState.isLoading),
    error: pick("error"),
    idempotencyKey: pick("idempotencyKey"),
    cooldownRemainingMs: pick("cooldownRemainingMs"),
    verifyCooldownRemainingMs: pick("verifyCooldownRemainingMs"),
    canSend: pick("canSend"),
    canVerify: pick("canVerify"),
    send: flow.send,
    resend: flow.resend,
    verify: flow.verify,
    reset: flow.reset,
  };
};
