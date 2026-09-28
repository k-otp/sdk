import { createOtpClient, type OtpClientOptions } from "@k-otp/sdk-core";
import type { OtpIssueVerifyClient } from "@k-otp/sdk-core/headless";
import {
  type App,
  hasInjectionContext,
  type InjectionKey,
  inject,
  provide,
} from "vue";

/** Any client with `issue`/`verify` (an `OtpClient` from `createOtpClient`). */
export type OtpClientLike = OtpIssueVerifyClient;

/** A client instance, or options for `createOtpClient`. */
export type OtpClientSource = OtpClientLike | OtpClientOptions;

/** Injection key of the OTP client (`app.provide` / `provide`). */
export const OTP_CLIENT_KEY: InjectionKey<OtpClientLike> = Symbol("k-otp");

const toClient = (source: OtpClientSource): OtpClientLike =>
  typeof (source as OtpClientLike).issue === "function" &&
  typeof (source as OtpClientLike).verify === "function"
    ? (source as OtpClientLike)
    : createOtpClient(source as OtpClientOptions);

/**
 * Vue plugin: `app.use(createOtpPlugin({ apiKey: "pk_..." }))`. The client is
 * provided per app (no globals), so create the plugin inside your
 * `createApp`/`createSSRApp` factory for SSR. Creation performs no I/O.
 */
export const createOtpPlugin = (
  source: OtpClientSource,
): { install: (app: App) => void } => {
  const client = toClient(source);
  return {
    install: (app) => {
      app.provide(OTP_CLIENT_KEY, client);
    },
  };
};

/** Provides a client to the current component's descendants. */
export const provideOtpClient = (source: OtpClientSource): OtpClientLike => {
  const client = toClient(source);
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
