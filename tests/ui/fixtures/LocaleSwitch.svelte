<!-- An OtpCodeInput whose locale the test changes after mount. -->
<script>
  import { OtpCodeInput } from "@k-otp/sdk/ui/svelte";

  export let onSet;
  let locale = "ko";
  onSet((next) => {
    locale = next;
  });
</script>

<OtpCodeInput {locale} />
