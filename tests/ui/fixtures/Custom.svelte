<!-- Headless composition with slot props (Svelte 4 syntax, works in 4 and 5). -->
<script>
  import {
    OtpFormCodeField,
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
  <OtpFormPhoneField let:inputProps let:labelProps let:onInput>
    <label {...labelProps}>Mobile</label>
    <input {...inputProps} class="my-input" on:input={onInput} />
  </OtpFormPhoneField>
  <OtpFormSendButton let:parts>Send ({parts.text.sendButton})</OtpFormSendButton>
  {#if state.issued}
    <OtpFormCodeField />
    <OtpFormVerifyButton />
  {/if}
  <OtpFormMessage />
  <output data-phase={state.phase}>{state.phase}</output>
</OtpFormRoot>
