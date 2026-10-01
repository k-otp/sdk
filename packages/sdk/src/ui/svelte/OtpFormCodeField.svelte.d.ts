import { SvelteComponent } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import type { OtpFormSlotProps } from "./runtime.js";

/** Label + segmented code input + description/error of the form. */
export default class OtpFormCodeField extends SvelteComponent<
  {
    label?: string | undefined;
    description?: string | undefined;
  } & HTMLAttributes<HTMLDivElement>,
  Record<string, never>,
  { label: OtpFormSlotProps & { labelProps: Record<string, unknown> } }
> {}
