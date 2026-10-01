import { SvelteComponent } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import type { OtpFormSlotProps } from "./runtime.js";

/** Label + phone input + description/error, wired with ARIA. */
export default class OtpFormPhoneField extends SvelteComponent<
  {
    label?: string | undefined;
    description?: string | undefined;
    placeholder?: string | undefined;
  } & HTMLAttributes<HTMLDivElement>,
  Record<string, never>,
  {
    default: OtpFormSlotProps & {
      labelProps: Record<string, unknown>;
      inputProps: Record<string, unknown>;
      descriptionProps: Record<string, unknown>;
      errorProps: Record<string, unknown>;
      onInput: (event: Event) => void;
      onBlur: () => void;
    };
  }
> {}
