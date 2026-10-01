<!--
  The ready-made form: phone field, send button, code field with countdown,
  verify, change number and a status message. Takes every OtpFormRoot prop
  and event; the default slot renders between the fields and the message.
-->
<script>
  import OtpFormCodeField from "./OtpFormCodeField.svelte";
  import OtpFormCountdown from "./OtpFormCountdown.svelte";
  import OtpFormEditPhoneButton from "./OtpFormEditPhoneButton.svelte";
  import OtpFormMessage from "./OtpFormMessage.svelte";
  import OtpFormPhoneField from "./OtpFormPhoneField.svelte";
  import OtpFormRoot from "./OtpFormRoot.svelte";
  import OtpFormSendButton from "./OtpFormSendButton.svelte";
  import OtpFormVerifyButton from "./OtpFormVerifyButton.svelte";
</script>

<OtpFormRoot
  {...$$props}
  let:state
  on:sent
  on:verified
  on:error
  on:phaseChange
>
  <OtpFormPhoneField />
  {#if state.issued}
    <OtpFormCodeField />
  {/if}
  <!-- Once verified, only the fields and the result stay. -->
  {#if state.phase !== "verified"}
    {#if state.issued}
      <OtpFormCountdown />
      <OtpFormVerifyButton />
    {/if}
    <OtpFormSendButton />
    {#if state.issued}
      <OtpFormEditPhoneButton />
    {/if}
  {/if}
  <slot />
  <OtpFormMessage />
</OtpFormRoot>
