import { SvelteComponent } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import type { OtpFormPhoneFieldSlotProps } from "./runtime.js";

/**
 * Label + phone input + description/error, wired with ARIA. A custom input spreads `inputProps` and binds `readonly={state.phoneLocked}`, `on:input={onInput}` and `on:blur={onBlur}`.
 *
 * Svelte 4: slot props with `let:`. Svelte 5: also a `children` snippet
 * receiving the same object.
 */
export default class OtpFormPhoneField extends SvelteComponent<
  {
    label?: string | undefined;
    description?: string | undefined;
    placeholder?: string | undefined;
    children?: ((props: OtpFormPhoneFieldSlotProps) => unknown) | undefined;
  } & Omit<HTMLAttributes<HTMLDivElement>, "children">,
  Record<string, never>,
  { default: OtpFormPhoneFieldSlotProps }
> {}
