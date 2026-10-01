<!-- OtpFormCountdown: default copy unless the default slot is given. -->
<script>
  import { attrs, getOtpFormContext, slotProps } from "./runtime.js";

  const context = getOtpFormContext();
  const { state, parts, t } = context;
</script>

<span {...attrs($parts.countdown)} {...$$restProps}><slot {...slotProps(context, $state, $parts, $t)}>{$parts.text.countdown ?? ""}</slot></span>
