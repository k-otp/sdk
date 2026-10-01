import { SvelteComponent } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import type { OtpFormSlotProps } from "./runtime.js";

/** Time left before the code expires (role="timer", not announced). */
export default class OtpFormCountdown extends SvelteComponent<
  HTMLAttributes<HTMLSpanElement>,
  Record<string, never>,
  { default: OtpFormSlotProps }
> {}
