import {
  type App,
  getCurrentInstance,
  hasInjectionContext,
  type InjectionKey,
  inject,
  provide,
} from "vue";
import type { OtpClientOptions } from "../core";
import { toOtpClient } from "../core/internal";
import type { OtpIssueVerifyClient } from "../headless";

/** Any client with `issue`/`verify` (an `OtpClient` from `createOtpClient`). */
export type OtpClientLike = OtpIssueVerifyClient;

/** A client instance, or options for `createOtpClient`. */
export type OtpClientSource = OtpClientLike | OtpClientOptions;

/** Injection key of the OTP client (`app.provide` / `provide`). */
export const OTP_CLIENT_KEY: InjectionKey<OtpClientLike> = Symbol("k-otp");

/**
 * Vue plugin: `app.use(createOtpPlugin({ apiKey: "pk_..." }))`. The client is
 * provided per app (no globals), so create the plugin inside your
 * `createApp`/`createSSRApp` factory for SSR. Creation performs no I/O.
 */
export const createOtpPlugin = (
  source: OtpClientSource,
): { install: (app: App) => void } => {
  const client = toOtpClient(source);
  return {
    install: (app) => {
      app.provide(OTP_CLIENT_KEY, client);
    },
  };
};

/**
 * Provides a client to the current component's descendants. Must run inside
 * `setup()`; throws a `TypeError` elsewhere (where Vue's `provide` would
 * silently do nothing in production).
 */
export const provideOtpClient = (source: OtpClientSource): OtpClientLike => {
  if (!getCurrentInstance()) {
    throw new TypeError(
      "provideOtpClient() must be called inside a component's setup(). Use app.use(createOtpPlugin(...)) at the app level.",
    );
  }
  const client = toOtpClient(source);
  provide(OTP_CLIENT_KEY, client);
  return client;
};

/**
 * Returns `client`, or the injected client. Must run inside `setup()` (or
 * `app.runWithContext`) when no client is passed; throws a `TypeError` when
 * none is available.
 */
export const useOtpClient = (client?: OtpClientLike): OtpClientLike => {
  if (client) return client;
  const injected = hasInjectionContext() ? inject(OTP_CLIENT_KEY, null) : null;
  if (!injected) {
    throw new TypeError(
      "No K-OTP client found. Install createOtpPlugin(), call provideOtpClient() in an ancestor, or pass `client`.",
    );
  }
  return injected;
};
