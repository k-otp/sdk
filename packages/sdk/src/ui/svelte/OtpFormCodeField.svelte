<!-- Label + segmented code input + description/error of the form. -->
<script>
  import {
    attrs,
    codeFieldHandlers,
    getOtpFormContext,
    syncSegments,
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
  const sync = syncSegments(handlers);

  $: descriptionText = description ?? $parts.text.codeDescription;
</script>

<div {...attrs($parts.codeField)} {...$$restProps}>
  <label {...attrs($parts.codeLabel)}>{label ?? $parts.text.codeLabel}</label>
  <div {...attrs($parts.codeInput)} bind:this={group} use:sync={$formState.code}>
    {#each $parts.codeSegments as segment, index (index)}
      <input
        {...attrs(segment)}
        readonly={segment.readonly === true}
        on:input={(event) => handlers.input(index, event)}
        on:keydown={(event) => handlers.keydown(index, event)}
        on:paste={(event) => handlers.paste(index, event)}
        on:focus={(event) => handlers.focus(index, event)}
        on:blur={handlers.blur}
        on:compositionstart={handlers.compositionstart}
        on:compositionend={(event) => handlers.compositionend(index, event)}
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
