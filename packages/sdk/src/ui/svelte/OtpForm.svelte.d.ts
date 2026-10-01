import { SvelteComponent } from "svelte";
import type { HTMLFormAttributes } from "svelte/elements";
import type { OtpFormRootEvents, OtpFormRootProps } from "./runtime.js";

/** The ready-made form (phone, send, code, countdown, verify, change number, message). */
export default class OtpForm extends SvelteComponent<
  OtpFormRootProps & Omit<HTMLFormAttributes, "id">,
  OtpFormRootEvents,
  { default: Record<string, never> }
> {}
