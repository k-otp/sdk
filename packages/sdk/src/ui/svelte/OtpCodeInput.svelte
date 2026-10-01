<!--
  Standalone segmented one-time-code input: bind:value, autocomplete
  "one-time-code", inputmode "numeric", paste across segments,
  Backspace/arrow navigation and optional WebOTP.
-->
<script>
  import { attrs, createOtpCodeInputModel } from "./runtime.js";

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
  const { handlers, group } = model;

  $: parts = model.parts({
    id,
    value,
    length,
    readOnly,
    invalid,
    labelledBy: $$restProps["aria-labelledby"],
    describedBy: $$restProps["aria-describedby"],
    locale,
    messages,
  });
</script>

<div {...attrs(parts.group)} {...$$restProps} use:group={{ autoFocus, webOtp }}>
  {#each parts.segments as segment, index (index)}
    <input
      {...attrs(segment)}
      value={parts.digits[index]}
      on:input={(event) => handlers.input(index, event)}
      on:keydown={(event) => handlers.keydown(index, event)}
      on:paste={(event) => handlers.paste(index, event)}
      on:focus={(event) => handlers.focus(index, event)}
    />
  {/each}
  {#if name}
    <input type="hidden" {name} {value} />
  {/if}
</div>
