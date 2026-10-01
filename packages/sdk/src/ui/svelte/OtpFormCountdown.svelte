<!-- OtpFormCountdown: default copy unless the default slot is given. -->
<script>
  import { attrs, getOtpFormContext, slotProps } from "./runtime.js";

  const context = getOtpFormContext();
  const { state: formState, parts, t } = context;
</script>

<span {...attrs($parts.countdown)} {...$$restProps}><slot {...slotProps(context, $formState, $parts, $t)}>{$parts.text.countdown ?? ""}</slot></span>
