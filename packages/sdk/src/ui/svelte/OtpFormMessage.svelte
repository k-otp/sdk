<!-- OtpFormMessage: default copy unless the default slot is given. -->
<script>
  import { attrs, getOtpFormContext, slotProps } from "./runtime.js";

  const context = getOtpFormContext();
  const { state, parts, t } = context;
</script>

<p {...attrs($parts.message)} {...$$restProps}><slot {...slotProps(context, $state, $parts, $t)}>{$parts.text.message ?? ""}</slot></p>
