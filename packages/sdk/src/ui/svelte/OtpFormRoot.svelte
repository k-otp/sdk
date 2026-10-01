<!--
  The <form> that owns one OTP flow and shares it with the parts.
  Written in Svelte 4 syntax (no runes, no TypeScript) so that Svelte 4 and
  Svelte 5 can both compile it; the logic lives in runtime.js.
-->
<script>
  import { attrs, createOtpFormRoot, slotProps } from "./runtime.js";

  /** @type {import("./runtime.js").OtpFormRootProps["client"]} */
  export let client = undefined;
  /** @type {import("./runtime.js").OtpFormRootProps["options"]} */
  export let options = undefined;
  /** @type {string | undefined} */
  export let id = undefined;
  /** @type {string} */
  export let purpose;
  /** @type {import("./runtime.js").OtpFormRootProps["issue"]} */
  export let issue = undefined;
  /** @type {boolean | undefined} */
  export let autoSubmit = undefined;
  /** @type {boolean | undefined} */
  export let webOtp = undefined;
  /** @type {boolean | undefined} */
  export let clearCodeOnMismatch = undefined;
  /** @type {boolean | undefined} */
  export let allowInternational = undefined;
  /** @type {number | undefined} */
  export let codeLength = undefined;
  /** @type {string | undefined} */
  export let defaultPhoneNumber = undefined;
  /** @type {number | undefined} */
  export let resendCooldownMs = undefined;
  /** @type {string | undefined} */
  export let idempotencyKeyPrefix = undefined;
  /** @type {(() => string) | undefined} */
  export let createIdempotencyKey = undefined;
  /** @type {import("./runtime.js").OtpFormRootProps["locale"]} */
  export let locale = undefined;
  /** @type {import("./runtime.js").OtpFormRootProps["messages"]} */
  export let messages = undefined;
  /** @type {import("./runtime.js").OtpFormRootProps["onSent"]} */
  export let onSent = undefined;
  /** @type {import("./runtime.js").OtpFormRootProps["onVerified"]} */
  export let onVerified = undefined;
  /** @type {import("./runtime.js").OtpFormRootProps["onError"]} */
  export let onError = undefined;
  /** @type {import("./runtime.js").OtpFormRootProps["onPhaseChange"]} */
  export let onPhaseChange = undefined;

  const context = createOtpFormRoot({
    client,
    options,
    id,
    purpose,
    issue,
    autoSubmit,
    webOtp,
    clearCodeOnMismatch,
    allowInternational,
    codeLength,
    defaultPhoneNumber,
    resendCooldownMs,
    idempotencyKeyPrefix,
    createIdempotencyKey,
    locale,
    messages,
    onSent,
    onVerified,
    onError,
    onPhaseChange,
  });
  const { state: formState, parts, t, root, submit } = context;

  $: context.update({
    id,
    purpose,
    issue,
    autoSubmit,
    webOtp,
    clearCodeOnMismatch,
    allowInternational,
    locale,
    messages,
    onSent,
    onVerified,
    onError,
    onPhaseChange,
  });
</script>

<form {...attrs($parts.root)} novalidate {...$$restProps} use:root on:submit={submit}>
  <slot {...slotProps(context, $formState, $parts, $t)} />
</form>
