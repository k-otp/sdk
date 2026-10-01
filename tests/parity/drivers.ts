/**
 * One driver per adapter. Each mounts the adapter the idiomatic way (React
 * hooks under <OtpProvider>, Vue composables inside an app + effect scope,
 * Svelte stores) and exposes the same imperative API and state snapshot, so
 * the parity suite can run identical scenarios against all of them.
 */
import type {
  IssueInput,
  IssueResult,
  OtpApiError,
  OtpClient,
  VerifyInput,
  VerifyResult,
} from "@k-otp/sdk";
import type {
  OtpFlowOptions,
  OtpFlowResult,
  OtpFlowSendInput,
  OtpFlowState,
  OtpOperationState,
  OtpRunResult,
} from "@k-otp/sdk/headless";
import {
  OtpProvider,
  useOtpFlow,
  useOtpIssue,
  useOtpVerify,
} from "@k-otp/sdk/react";
import { createOtpStores } from "@k-otp/sdk/svelte";
import {
  createOtpPlugin,
  useOtp,
  useOtpFlow as useVueOtpFlow,
} from "@k-otp/sdk/vue";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { get } from "svelte/store";
import { createApp, effectScope } from "vue";

/** The uniform API every adapter is driven through. */
export type Api = {
  issue: (input: IssueInput) => Promise<OtpRunResult<IssueResult>>;
  verify: (input: VerifyInput) => Promise<OtpRunResult<VerifyResult>>;
  reset: () => void;
  send: (input: OtpFlowSendInput) => Promise<OtpFlowResult<IssueResult>>;
  resend: () => Promise<OtpFlowResult<IssueResult>>;
  verifyCode: (code: string) => Promise<OtpFlowResult<VerifyResult>>;
  resetFlow: () => void;
};

/** What every adapter exposes, read back into plain values. */
export type Snapshot = {
  issue: OtpOperationState<IssueResult>;
  verify: OtpOperationState<VerifyResult>;
  /** Either operation loading. */
  loading: boolean;
  /** `verify` error, else `issue` error. */
  error: OtpApiError | undefined;
  flow: OtpFlowState;
};

export type Harness = {
  /** Runs `fn` and waits for it (and the adapter's re-render) to settle. */
  run: <T>(fn: (api: Api) => Promise<T>) => Promise<T>;
  /** Starts `fn` without waiting; state updates are flushed before returning. */
  start: <T>(fn: (api: Api) => Promise<T>) => Promise<T>;
  /** Waits for a started promise and flushes the adapter. */
  settle: <T>(promise: Promise<T>) => Promise<T>;
  snapshot: () => Snapshot;
  /** Unmount / dispose the scope / tear the stores down. */
  unmount: () => void;
};

export type Driver = {
  name: "react" | "vue" | "svelte";
  mount: (client: OtpClient, flowOptions: OtpFlowOptions) => Harness;
};

const react: Driver = {
  name: "react",
  mount: (client, flowOptions) => {
    const wrapper = ({ children }: { children?: ReactNode }) =>
      createElement(OtpProvider, { client }, children);
    const { result, unmount } = renderHook(
      () => ({
        issue: useOtpIssue(),
        verify: useOtpVerify(),
        flow: useOtpFlow(flowOptions),
      }),
      { wrapper },
    );
    const api = (): Api => {
      const { issue, verify, flow } = result.current;
      return {
        issue: issue.run,
        verify: verify.run,
        reset: () => {
          issue.reset();
          verify.reset();
        },
        send: flow.send,
        resend: flow.resend,
        verifyCode: flow.verify,
        resetFlow: flow.reset,
      };
    };
    const settle = async <T>(promise: Promise<T>): Promise<T> => {
      let value!: T;
      await act(async () => {
        value = await promise;
      });
      return value;
    };
    return {
      run: (fn) => settle(Promise.resolve().then(() => fn(api()))),
      start: <T>(fn: (api: Api) => Promise<T>) => {
        let promise!: Promise<T>;
        act(() => {
          promise = fn(api());
        });
        return promise;
      },
      settle,
      snapshot: () => {
        const { issue, verify, flow } = result.current;
        const { run: _run, reset: _reset, ...issueState } = issue;
        const { run: _vrun, reset: _vreset, ...verifyState } = verify;
        const {
          send: _send,
          resend: _resend,
          verify: _verify,
          reset: _freset,
          ...flowState
        } = flow;
        return {
          issue: issueState,
          verify: verifyState,
          loading: issue.isLoading || verify.isLoading,
          error: verify.error ?? issue.error,
          flow: flowState,
        };
      },
      unmount,
    };
  },
};

const vue: Driver = {
  name: "vue",
  mount: (client, flowOptions) => {
    const app = createApp({});
    app.use(createOtpPlugin(client));
    const scope = effectScope();
    const composables = app.runWithContext(() =>
      scope.run(() => ({ otp: useOtp(), flow: useVueOtpFlow(flowOptions) })),
    );
    if (!composables) throw new Error("effect scope did not run");
    const { otp, flow } = composables;
    const api: Api = {
      issue: otp.issue.run,
      verify: otp.verify.run,
      reset: otp.reset,
      send: flow.send,
      resend: flow.resend,
      verifyCode: flow.verify,
      resetFlow: flow.reset,
    };
    const op = <T>(o: {
      status: { value: OtpOperationState<T>["status"] };
      loading: { value: boolean };
      result: { value: T | undefined };
      error: { value: OtpApiError | undefined };
    }): OtpOperationState<T> => ({
      status: o.status.value,
      isLoading: o.loading.value,
      data: o.result.value,
      error: o.error.value,
    });
    return {
      run: (fn) => fn(api),
      start: (fn) => fn(api),
      settle: (promise) => promise,
      snapshot: () => ({
        issue: op(otp.issue),
        verify: op(otp.verify),
        loading: otp.loading.value,
        error: otp.error.value,
        flow: flow.state.value,
      }),
      unmount: () => scope.stop(),
    };
  },
};

const svelte: Driver = {
  name: "svelte",
  mount: (client, flowOptions) => {
    const stores = createOtpStores(client);
    const flow = stores.createFlow(flowOptions);
    const api: Api = {
      issue: stores.issue.run,
      verify: stores.verify.run,
      reset: stores.reset,
      send: flow.send,
      resend: flow.resend,
      verifyCode: flow.verify,
      resetFlow: flow.reset,
    };
    return {
      run: (fn) => fn(api),
      start: (fn) => fn(api),
      settle: (promise) => promise,
      snapshot: () => ({
        issue: get(stores.issue),
        verify: get(stores.verify),
        loading: get(stores.loading),
        error: get(stores.error),
        flow: get(flow),
      }),
      unmount: () => {
        stores.abort();
        flow.abort();
      },
    };
  },
};

export const drivers: readonly Driver[] = [react, vue, svelte];
