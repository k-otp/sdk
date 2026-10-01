import { SvelteComponent } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import type { OtpFormSlotProps } from "./runtime.js";

/** Polite live region with the current status or error. */
export default class OtpFormMessage extends SvelteComponent<
  HTMLAttributes<HTMLParagraphElement>,
  Record<string, never>,
  { default: OtpFormSlotProps }
> {}
