<script>
  import { OtpCodeInput } from "@k-otp/sdk/ui/svelte";

  export let onComplete = undefined;
  let value = "";
</script>

<span id="code-label">Code</span>
<OtpCodeInput bind:value aria-labelledby="code-label" name="code" locale="en" {onComplete} />
<output>{value}</output>
