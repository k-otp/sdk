<!-- Headless composition with slot props (Svelte 4 syntax, works in 4 and 5). -->
<script>
  import {
    OtpFormCodeField,
    OtpFormEditPhoneButton,
    OtpFormMessage,
    OtpFormPhoneField,
    OtpFormRoot,
    OtpFormSendButton,
    OtpFormVerifyButton,
  } from "@k-otp/sdk/ui/svelte";

  export let client;
  export let onVerified = undefined;
</script>

<OtpFormRoot {client} purpose="custom" locale="en" id="custom" {onVerified} class="my-form" let:state>
  <OtpFormPhoneField let:inputProps let:labelProps let:phoneInput>
    <label {...labelProps}>Mobile</label>
    <input {...inputProps} class="my-input" use:phoneInput />
  </OtpFormPhoneField>
  <OtpFormSendButton let:parts>Send ({parts.text.sendButton})</OtpFormSendButton>
  {#if state.issued}
    <OtpFormCodeField />
    <OtpFormVerifyButton />
    <OtpFormEditPhoneButton />
  {/if}
  <OtpFormMessage />
  <output data-phase={state.phase}>{state.phase}</output>
</OtpFormRoot>
