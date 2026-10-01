<!-- OtpFormSendButton: default copy unless the default slot is given. -->
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

<button {...attrs($parts.sendButton)} {...$$restProps} on:click={handlers.send}><slot {...slotProps(context, $state, $parts, $t)}>{$parts.text.sendButton}</slot></button>
