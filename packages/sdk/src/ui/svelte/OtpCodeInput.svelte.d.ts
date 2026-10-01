import { SvelteComponent } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import type { OtpCodeInputEvents, OtpCodeInputProps } from "./runtime.js";

/**
 * Standalone segmented one-time-code input (bind:value).
 *
 * Svelte 4: slot props with `let:`. Svelte 5: also a `children` snippet
 * receiving the same object.
 */
export default class OtpCodeInput extends SvelteComponent<
  OtpCodeInputProps & Omit<HTMLAttributes<HTMLDivElement>, "id" | "children">,
  OtpCodeInputEvents,
  Record<string, never>
> {}
