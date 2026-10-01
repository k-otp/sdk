import { SvelteComponent } from "svelte";
import type { HTMLFormAttributes } from "svelte/elements";
import type {
  OtpFormRootEvents,
  OtpFormRootProps,
  OtpFormSlotProps,
} from "./runtime.js";

/** The <form> that owns one OTP flow and shares it with the parts. */
export default class OtpFormRoot extends SvelteComponent<
  OtpFormRootProps & Omit<HTMLFormAttributes, "id">,
  OtpFormRootEvents,
  { default: OtpFormSlotProps }
> {}
