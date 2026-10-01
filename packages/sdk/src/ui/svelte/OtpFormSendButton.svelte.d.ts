import { SvelteComponent } from "svelte";
import type { HTMLButtonAttributes } from "svelte/elements";
import type { OtpFormSlotProps } from "./runtime.js";

/** Sends the code; becomes "resend" with the cooldown countdown. */
export default class OtpFormSendButton extends SvelteComponent<
  HTMLButtonAttributes,
  Record<string, never>,
  { default: OtpFormSlotProps }
> {}
