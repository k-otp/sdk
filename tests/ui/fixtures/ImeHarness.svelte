<script>
  import { OtpFormCodeField, OtpFormRoot } from "@k-otp/sdk/ui/svelte";
  import CaptureForm from "./CaptureForm.svelte";

  export let client;
  export let onForm;
</script>

<OtpFormRoot {client} purpose="ime" locale="en" let:state>
  <CaptureForm {onForm} />
  {#if state.issued}
    <OtpFormCodeField />
  {/if}
</OtpFormRoot>
