<!-- Label + segmented code input + description/error of the form. -->
<script>
  import {
    attrs,
    codeDigits,
    codeFieldHandlers,
    getOtpFormContext,
  } from "./runtime.js";

  /** @type {string | undefined} */
  export let label = undefined;
  /** Help text under the input; `""` hides it. @type {string | undefined} */
  export let description = undefined;

  const context = getOtpFormContext();
  const { state: formState, parts } = context;
  /** @type {HTMLElement | undefined} */
  let group;
  const handlers = codeFieldHandlers(context, () => group);

  $: digits = codeDigits($formState.code, $formState.codeLength);
  $: descriptionText = description ?? $parts.text.codeDescription;
</script>

<div {...attrs($parts.codeField)} {...$$restProps}>
  <label {...attrs($parts.codeLabel)}>{label ?? $parts.text.codeLabel}</label>
  <div {...attrs($parts.codeInput)} bind:this={group}>
    {#each $parts.codeSegments as segment, index (index)}
      <input
        {...attrs(segment)}
        readonly={segment.readonly === true}
        value={digits[index]}
        on:input={(event) => handlers.input(index, event)}
        on:keydown={(event) => handlers.keydown(index, event)}
        on:paste={(event) => handlers.paste(index, event)}
        on:focus={(event) => handlers.focus(index, event)}
      />
    {/each}
  </div>
  {#if descriptionText}
    <p {...attrs($parts.codeDescription)}>{descriptionText}</p>
  {/if}
  {#if $parts.text.codeError}
    <p {...attrs($parts.codeError)}>{$parts.text.codeError}</p>
  {/if}
</div>
