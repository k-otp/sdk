import { SvelteComponent } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import type { OtpFormSlotProps } from "./runtime.js";

/**
 * Polite live region with the current status or error.
 *
 * Svelte 4: slot props with `let:`. Svelte 5: also a `children` snippet
 * receiving the same object.
 */
export default class OtpFormMessage extends SvelteComponent<
  Omit<HTMLAttributes<HTMLParagraphElement>, "children"> & {
    children?: ((props: OtpFormSlotProps) => unknown) | undefined;
  },
  Record<string, never>,
  { default: OtpFormSlotProps }
> {}
