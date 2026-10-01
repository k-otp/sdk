import { SvelteComponent } from "svelte";
import type { HTMLButtonAttributes } from "svelte/elements";
import type { OtpFormSlotProps } from "./runtime.js";

/** Goes back to the phone step to change the number. */
export default class OtpFormEditPhoneButton extends SvelteComponent<
  HTMLButtonAttributes,
  Record<string, never>,
  { default: OtpFormSlotProps }
> {}
