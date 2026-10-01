import { SvelteComponent } from "svelte";
import type { HTMLButtonAttributes } from "svelte/elements";
import type { OtpFormSlotProps } from "./runtime.js";

/** Verifies the entered code. */
export default class OtpFormVerifyButton extends SvelteComponent<
  HTMLButtonAttributes,
  Record<string, never>,
  { default: OtpFormSlotProps }
> {}
