<!-- Hands the enclosing form controller to the test. -->
<script>
  import { getOtpFormContext } from "@k-otp/sdk/ui/svelte";

  export let onForm;
  onForm(getOtpFormContext().form);
</script>
