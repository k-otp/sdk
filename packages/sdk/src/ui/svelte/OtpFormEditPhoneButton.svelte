<!-- OtpFormEditPhoneButton: default copy unless the default slot is given. -->
<script>
  import {
    attrs,
    buttonHandlers,
    getOtpFormContext,
    slotProps,
  } from "./runtime.js";

  const context = getOtpFormContext();
  const { state: formState, parts, t } = context;
  const handlers = buttonHandlers(context);
</script>

<button {...attrs($parts.editPhone)} {...$$restProps} on:click={handlers.editPhone}><slot {...slotProps(context, $formState, $parts, $t)}>{$parts.text.editPhone}</slot></button>
