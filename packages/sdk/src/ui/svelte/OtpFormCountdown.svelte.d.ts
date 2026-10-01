import { SvelteComponent } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import type { OtpFormSlotProps } from "./runtime.js";

/**
 * Time left before the code expires (role="timer", not announced).
 *
 * Svelte 4: slot props with `let:`. Svelte 5: also a `children` snippet
 * receiving the same object.
 */
export default class OtpFormCountdown extends SvelteComponent<
  Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
    children?: ((props: OtpFormSlotProps) => unknown) | undefined;
  },
  Record<string, never>,
  { default: OtpFormSlotProps }
> {}
