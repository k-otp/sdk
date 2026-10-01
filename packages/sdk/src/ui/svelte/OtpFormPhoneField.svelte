<!-- Label + phone input + description/error, wired with ARIA. -->
<script>
  import {
    attrs,
    getOtpFormContext,
    phoneInputHandlers,
    slotProps,
  } from "./runtime.js";

  /** @type {string | undefined} */
  export let label = undefined;
  /** Help text under the input; `""` hides it. @type {string | undefined} */
  export let description = undefined;
  /** @type {string | undefined} */
  export let placeholder = undefined;

  const context = getOtpFormContext();
  const { state: formState, parts, t } = context;
  const handlers = phoneInputHandlers(context);

  $: inputProps = {
    ...attrs($parts.phoneInput),
    value: $formState.phoneNumber,
    placeholder: placeholder ?? $parts.text.phonePlaceholder,
  };
  $: descriptionText = description ?? $parts.text.phoneDescription;
</script>

<div {...attrs($parts.phoneField)} {...$$restProps}>
  {#if $$slots.default}
    <slot
      {...slotProps(context, $formState, $parts, $t)}
      labelProps={attrs($parts.phoneLabel)}
      {inputProps}
      descriptionProps={attrs($parts.phoneDescription)}
      errorProps={attrs($parts.phoneError)}
      onInput={handlers.input}
      onBlur={handlers.blur}
    />
  {:else}
    <label {...attrs($parts.phoneLabel)}>{label ?? $parts.text.phoneLabel}</label>
    <input
      {...inputProps}
      readonly={$formState.phoneLocked}
      on:input={handlers.input}
      on:blur={handlers.blur}
    />
    {#if descriptionText}
      <p {...attrs($parts.phoneDescription)}>{descriptionText}</p>
    {/if}
    {#if $parts.text.phoneError}
      <p {...attrs($parts.phoneError)}>{$parts.text.phoneError}</p>
    {/if}
  {/if}
</div>
