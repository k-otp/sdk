import { getContext, onDestroy, setContext } from "svelte";
import {
  createOtpStores,
  type OtpClientSource,
  type OtpStores,
} from "./stores";

const CONTEXT_KEY: unique symbol = Symbol("k-otp");

const isStores = (value: unknown): value is OtpStores =>
  typeof value === "object" &&
  value !== null &&
  "issue" in value &&
  "createFlow" in value;

/**
 * Creates (or takes) the OTP stores and shares them with descendants via
 * Svelte context. Call it during component initialization (e.g. in the root
 * layout). In-flight requests are aborted when that component is destroyed.
 */
export const setOtpContext = (
  source: OtpStores | OtpClientSource,
): OtpStores => {
  const stores = isStores(source) ? source : createOtpStores(source);
  setContext(CONTEXT_KEY, stores);
  onDestroy(() => stores.abort());
  return stores;
};

/**
 * Returns the stores set by an ancestor's `setOtpContext`. Call it during
 * component initialization; throws a `TypeError` when there are none.
 */
export const getOtpContext = (): OtpStores => {
  const stores = getContext<OtpStores | undefined>(CONTEXT_KEY);
  if (!stores) {
    throw new TypeError(
      "No K-OTP stores found. Call setOtpContext() in an ancestor component.",
    );
  }
  return stores;
};
