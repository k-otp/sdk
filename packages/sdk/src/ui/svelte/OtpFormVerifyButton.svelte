<!-- OtpFormVerifyButton: default copy unless the default slot is given. -->
<script>
  import {
    attrs,
    buttonHandlers,
    getOtpFormContext,
    slotProps,
  } from "./runtime.js";

  const context = getOtpFormContext();
  const { state, parts, t } = context;
  const handlers = buttonHandlers(context);
</script>

<button {...attrs($parts.verifyButton)} {...$$restProps} on:click={handlers.verify}><slot {...slotProps(context, $state, $parts, $t)}>{$parts.text.verifyButton}</slot></button>
