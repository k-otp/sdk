import { SvelteComponent } from "svelte";
import type { HTMLFormAttributes } from "svelte/elements";
import type { OtpFormRootEvents, OtpFormRootProps } from "./runtime.js";

/**
 * The ready-made form (phone, send, code, countdown, verify, change number, message). The default slot renders between the fields and the message.
 *
 * Svelte 4: slot props with `let:`. Svelte 5: also a `children` snippet
 * receiving the same object.
 */
export default class OtpForm extends SvelteComponent<
  OtpFormRootProps &
    Omit<HTMLFormAttributes, "id" | "children"> & {
      children?: (() => unknown) | undefined;
    },
  OtpFormRootEvents,
  { default: Record<string, never> }
> {}
