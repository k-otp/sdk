<!-- OtpFormMessage: default copy unless the default slot is given. -->
<script>
  import { attrs, getOtpFormContext, slotProps } from "./runtime.js";

  const context = getOtpFormContext();
  const { state: formState, parts, t } = context;
</script>

<p {...attrs($parts.message)} {...$$restProps}><slot {...slotProps(context, $formState, $parts, $t)}>{$parts.text.message ?? ""}</slot></p>
