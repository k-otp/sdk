import { SvelteComponent } from "svelte";
import type { HTMLFormAttributes } from "svelte/elements";
import type {
  OtpFormRootEvents,
  OtpFormRootProps,
  OtpFormSlotProps,
} from "./runtime.js";

/**
 * The <form> that owns one OTP flow and shares it with the parts.
 *
 * Svelte 4: slot props with `let:`. Svelte 5: also a `children` snippet
 * receiving the same object.
 */
export default class OtpFormRoot extends SvelteComponent<
  OtpFormRootProps &
    Omit<HTMLFormAttributes, "id" | "children"> & {
      children?: ((props: OtpFormSlotProps) => unknown) | undefined;
    },
  OtpFormRootEvents,
  { default: OtpFormSlotProps }
> {}
