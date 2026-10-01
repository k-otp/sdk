<!--
  Standalone segmented one-time-code input: bind:value, autocomplete
  "one-time-code", inputmode "numeric", paste across segments,
  Backspace/arrow navigation and optional WebOTP.
-->
<script>
  import { attrs, createOtpCodeInputModel, syncSegments } from "./runtime.js";

  /** Digits (`bind:value`). @type {string} */
  export let value = "";
  /** @type {number} */
  export let length = 6;
  /** @type {boolean} */
  export let readOnly = false;
  /** @type {boolean} */
  export let invalid = false;
  /** @type {string | undefined} */
  export let id = undefined;
  /** @type {boolean} */
  export let autoFocus = false;
  /** @type {boolean} */
  export let webOtp = false;
  /** @type {string | undefined} */
  export let name = undefined;
  /** @type {import("./runtime.js").OtpCodeInputProps["locale"]} */
  export let locale = undefined;
  /** @type {import("./runtime.js").OtpCodeInputProps["messages"]} */
  export let messages = undefined;
  /** @type {((value: string) => void) | undefined} */
  export let onValueChange = undefined;
  /** @type {((value: string) => void) | undefined} */
  export let onComplete = undefined;

  const model = createOtpCodeInputModel({
    getValue: () => value,
    getLength: () => length,
    isReadOnly: () => readOnly,
    setValue: (next) => {
      value = next;
    },
    getProps: () => ({ onValueChange, onComplete }),
  });
  const { handlers, group, detectedLocale } = model;
  const sync = syncSegments(handlers);

  $: parts = model.parts({
    id,
    value,
    length,
    readOnly,
    invalid,
    labelledBy: $$restProps["aria-labelledby"],
    describedBy: $$restProps["aria-describedby"],
    // Read so that `locale="auto"` re-renders once the page's lang is known.
    locale: locale === "auto" ? $detectedLocale : locale,
    messages,
  });
</script>

<div {...attrs(parts.group)} {...$$restProps} use:group={{ autoFocus, webOtp, locale }} use:sync={parts.digits.join("")}>
  {#each parts.segments as segment, index (index)}
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
  {#if name}
    <input type="hidden" {name} {value} />
  {/if}
</div>
