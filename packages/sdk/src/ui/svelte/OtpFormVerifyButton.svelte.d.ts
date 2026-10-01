import { SvelteComponent } from "svelte";
import type { HTMLButtonAttributes } from "svelte/elements";
import type { OtpFormSlotProps } from "./runtime.js";

/**
 * Verifies the entered code.
 *
 * Svelte 4: slot props with `let:`. Svelte 5: also a `children` snippet
 * receiving the same object.
 */
export default class OtpFormVerifyButton extends SvelteComponent<
  Omit<HTMLButtonAttributes, "children"> & {
    children?: ((props: OtpFormSlotProps) => unknown) | undefined;
  },
  Record<string, never>,
  { default: OtpFormSlotProps }
> {}
