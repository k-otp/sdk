import { SvelteComponent } from "svelte";
import type { HTMLAttributes } from "svelte/elements";

/** Label + segmented code input + description/error of the form. */
export default class OtpFormCodeField extends SvelteComponent<
  {
    label?: string | undefined;
    /** Help text under the input; `""` hides it. */
    description?: string | undefined;
  } & Omit<HTMLAttributes<HTMLDivElement>, "children">,
  Record<string, never>,
  Record<string, never>
> {}
