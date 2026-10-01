import { SvelteComponent } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import type { OtpCodeInputEvents, OtpCodeInputProps } from "./runtime.js";

/** Standalone segmented one-time-code input (bind:value). */
export default class OtpCodeInput extends SvelteComponent<
  OtpCodeInputProps & Omit<HTMLAttributes<HTMLDivElement>, "id">,
  OtpCodeInputEvents,
  Record<string, never>
> {}
