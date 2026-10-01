/**
 * Runtime of the `@k-otp/sdk/ui/svelte` components. The `.svelte` files are
 * shipped as sources (compiled by the app's Svelte 4 or 5 compiler) and stay
 * thin: the logic lives here, in compiled TypeScript shared with the other
 * frameworks through `@k-otp/sdk/ui`.
 *
 * Every function that touches Svelte's component lifecycle
 * (`setContext`, `getContext`, `onDestroy`, `createEventDispatcher`) must be
 * called during component initialization.
 */
import {
  createEventDispatcher,
  getContext,
  onDestroy,
  setContext,
  tick,
} from "svelte";
import { derived, type Readable, readable, writable } from "svelte/store";
import type {
  IssueResult,
  OtpApiError,
  OtpClientOptions,
  VerifyResult,
} from "../../core";
import { toOtpClient } from "../../core/internal";
import { getOtpContext, type OtpClientLike } from "../../svelte";
import {
  createOtpCodeInputHandlers,
  createOtpForm,
  createOtpTranslator,
  DEFAULT_OTP_CODE_LENGTH,
  focusOtpCodeSegment,
  focusOtpFormTarget,
  getOtpCodeInputParts,
  getOtpFormParts,
  isOtpCodeComplete,
  type OtpAttrs,
  type OtpCodeInputHandlers,
  type OtpFormConfig,
  type OtpFormController,
  type OtpFormOperation,
  type OtpFormParts,
  type OtpFormPhase,
  type OtpFormState,
  type OtpLocale,
  type OtpMessageOverrides,
  type OtpTranslator,
  otpCodeSegments,
  receiveWebOtp,
  sanitizeOtpCode,
} from "..";

/**
 * Attributes Svelte must not receive through a spread: Svelte 5 aliases them
 * to DOM properties (`readonly` -> `readOnly`) and caches spread attributes
 * under the alias, so toggling one through a spread can leave it stale. The
 * components bind them explicitly (`readonly={...}`, `novalidate`).
 */
const EXPLICIT = new Set(["readonly", "novalidate"]);

/**
 * Part attributes for a Svelte spread: booleans become `""` / `undefined`,
 * since Svelte 4 would render `readonly={false}` in a spread as
 * `readonly="false"` (still read-only), and the attributes in `EXPLICIT`
 * are left out.
 */
export const attrs = (
  attributes: OtpAttrs,
): Record<string, string | number | undefined> => {
  const out: Record<string, string | number | undefined> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (EXPLICIT.has(key)) continue;
    out[key] = value === true ? "" : value === false ? undefined : value;
  }
  return out;
};

const randomId = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

/** Props of `OtpFormRoot` (and the preset `OtpForm`). */
export type OtpFormRootProps = OtpFormConfig & {
  /** A client you created; defaults to the stores of `setOtpContext`. */
  client?: OtpClientLike | undefined;
  /** `createOtpClient` options (read once), instead of `client`. */
  options?: OtpClientOptions | undefined;
  /**
   * Root id; part ids derive from it. Generated when omitted: pass one when
   * server-rendering so the hydrated ids match.
   */
  id?: string | undefined;
  codeLength?: number | undefined;
  defaultPhoneNumber?: string | undefined;
  resendCooldownMs?: number | undefined;
  idempotencyKeyPrefix?: string | undefined;
  createIdempotencyKey?: (() => string) | undefined;
  locale?: OtpLocale | undefined;
  messages?: OtpMessageOverrides | undefined;
};

/** Component events of `OtpFormRoot` (`on:verified`, ...). */
export type OtpFormRootEvents = {
  sent: CustomEvent<IssueResult>;
  verified: CustomEvent<VerifyResult>;
  error: CustomEvent<{ error: OtpApiError; operation: OtpFormOperation }>;
  phaseChange: CustomEvent<{ phase: OtpFormPhase; previous: OtpFormPhase }>;
};

/** Values passed to every slot (`let:state`, or a snippet's argument). */
export type OtpFormSlotProps = {
  form: OtpFormController;
  state: OtpFormState;
  parts: OtpFormParts;
  t: OtpTranslator;
};

/** Slot values of `OtpFormPhoneField` (for a custom label/input). */
export type OtpFormPhoneFieldSlotProps = OtpFormSlotProps & {
  labelProps: Record<string, string | number | undefined>;
  /** Spread on the input; also bind `readonly={state.phoneLocked}`. */
  inputProps: Record<string, string | number | undefined>;
  descriptionProps: Record<string, string | number | undefined>;
  errorProps: Record<string, string | number | undefined>;
  /** `on:input` / `oninput` handler of the input. */
  onInput: (event: Event) => void;
  /** `on:blur` / `onblur` handler of the input. */
  onBlur: () => void;
  /**
   * Action for a custom input (`<input {...inputProps} use:phoneInput />`):
   * wires the handlers and keeps `readonly` in sync. Use it instead of
   * `onInput`/`onBlur` + `readonly={state.phoneLocked}`.
   */
  phoneInput: (node: HTMLInputElement) => { destroy: () => void };
};

/** What `OtpFormRoot` shares with its parts (Svelte context). */
export type OtpFormSvelteContext = {
  form: OtpFormController;
  state: Readable<OtpFormState>;
  parts: Readable<OtpFormParts>;
  t: Readable<OtpTranslator>;
};

type RootContext = OtpFormSvelteContext & {
  /** Re-applies the reactive props (call from `$:`). */
  update: (props: OtpFormRootProps) => void;
  /** `use:` action on the `<form>`: focus management. */
  root: (node: HTMLElement) => { destroy: () => void };
  submit: (event: Event) => void;
};

// A registered symbol: shared by every copy of the runtime.
const CONTEXT_KEY: unique symbol = Symbol.for("@k-otp/sdk/ui/svelte/form");

const clientFrom = (props: OtpFormRootProps): OtpClientLike => {
  if (props.client) return props.client;
  if (props.options) return toOtpClient(props.options);
  try {
    return getOtpContext().client;
  } catch {
    throw new TypeError(
      "No K-OTP client found. Pass `client` or `options` to <OtpForm>, or call setOtpContext() in an ancestor.",
    );
  }
};

/** Creates the form of an `OtpFormRoot` instance (component init only). */
export const createOtpFormRoot = (initial: OtpFormRootProps): RootContext => {
  const dispatch = createEventDispatcher();
  let props = initial;
  const config = (): OtpFormConfig => ({
    purpose: props.purpose,
    issue: props.issue,
    autoSubmit: props.autoSubmit,
    webOtp: props.webOtp,
    clearCodeOnMismatch: props.clearCodeOnMismatch,
    allowInternational: props.allowInternational,
    onSent: (result) => {
      props.onSent?.(result);
      dispatch("sent", result);
    },
    onVerified: (result) => {
      props.onVerified?.(result);
      dispatch("verified", result);
    },
    onError: (error, operation) => {
      props.onError?.(error, operation);
      dispatch("error", { error, operation });
    },
    onPhaseChange: (phase, previous) => {
      props.onPhaseChange?.(phase, previous);
      dispatch("phaseChange", { phase, previous });
    },
  });
  const form = createOtpForm(clientFrom(initial), {
    ...config(),
    codeLength: initial.codeLength,
    defaultPhoneNumber: initial.defaultPhoneNumber,
    resendCooldownMs: initial.resendCooldownMs,
    idempotencyKeyPrefix: initial.idempotencyKeyPrefix,
    createIdempotencyKey: initial.createIdempotencyKey,
  });
  const generatedId = randomId("k-otp");
  const settings = writable({
    id: initial.id ?? generatedId,
    locale: initial.locale,
    messages: initial.messages,
  });
  const state = readable(form.getState(), (set) => {
    set(form.getState());
    return form.subscribe(() => set(form.getState()));
  });
  const t = derived(settings, ($settings) =>
    createOtpTranslator({
      locale: $settings.locale,
      messages: $settings.messages,
    }),
  );
  const parts = derived([state, settings, t], ([$state, $settings, $t]) =>
    getOtpFormParts($state, { id: $settings.id, t: $t }),
  );
  const context: OtpFormSvelteContext = { form, state, parts, t };
  setContext(CONTEXT_KEY, context);
  onDestroy(() => form.abort());

  let lastSettings = {
    id: initial.id,
    locale: initial.locale,
    messages: initial.messages,
  };
  return {
    ...context,
    update: (next) => {
      props = next;
      form.configure(config());
      if (
        next.id !== lastSettings.id ||
        next.locale !== lastSettings.locale ||
        next.messages !== lastSettings.messages
      ) {
        lastSettings = {
          id: next.id,
          locale: next.locale,
          messages: next.messages,
        };
        settings.set({
          id: next.id ?? generatedId,
          locale: next.locale,
          messages: next.messages,
        });
      }
    },
    root: (node) => {
      let applied = form.getState().focus?.seq ?? 0;
      const unsubscribe = form.subscribe(() => {
        const current = form.getState();
        const focus = current.focus;
        if (!focus || focus.seq === applied) return;
        applied = focus.seq;
        // After Svelte has rendered the new phase (e.g. the code field).
        void tick().then(() =>
          focusOtpFormTarget(node, focus.target, form.getState()),
        );
      });
      return { destroy: unsubscribe };
    },
    submit: (event) => {
      event.preventDefault();
      void form.submit();
    },
  };
};

/** The context of the enclosing `OtpFormRoot` (component init only). */
export const getOtpFormContext = (): OtpFormSvelteContext => {
  const context = getContext<OtpFormSvelteContext | undefined>(CONTEXT_KEY);
  if (!context) {
    throw new TypeError(
      "K-OTP form parts must be rendered inside <OtpFormRoot>.",
    );
  }
  return context;
};

/** Slot values from the context stores' current values. */
export const slotProps = (
  context: OtpFormSvelteContext,
  state: OtpFormState,
  parts: OtpFormParts,
  t: OtpTranslator,
): OtpFormSlotProps => ({ form: context.form, state, parts, t });

const caretAtEnd = (input: HTMLInputElement): boolean =>
  input.selectionStart === null || input.selectionStart >= input.value.length;

/** Handlers of the phone input (`on:input`, `on:blur`), and an action. */
export const phoneInputHandlers = (
  context: OtpFormSvelteContext,
): {
  input: (event: Event) => void;
  blur: () => void;
  action: (node: HTMLInputElement) => { destroy: () => void };
} => {
  const input = (event: Event): void => {
    const element = event.currentTarget as HTMLInputElement;
    context.form.setPhoneNumber(element.value, {
      format: caretAtEnd(element),
    });
    const next = context.form.getState().phoneNumber;
    if (element.value !== next) element.value = next;
  };
  const blur = (): void =>
    context.form.setPhoneNumber(context.form.getState().phoneNumber);
  return {
    input,
    blur,
    /**
     * `use:phoneInput` for a custom input: wires input/blur and keeps
     * `readOnly` in sync with `state.phoneLocked` (a `readonly` attribute
     * in a spread is unreliable across Svelte 4 and 5).
     */
    action: (node) => {
      const sync = (): void => {
        node.readOnly = context.form.getState().phoneLocked;
      };
      sync();
      node.addEventListener("input", input);
      node.addEventListener("blur", blur);
      const unsubscribe = context.form.subscribe(sync);
      return {
        destroy: () => {
          unsubscribe();
          node.removeEventListener("input", input);
          node.removeEventListener("blur", blur);
        },
      };
    },
  };
};

/** Click handlers of the button parts. */
export const buttonHandlers = (
  context: OtpFormSvelteContext,
): {
  send: (event: MouseEvent) => void;
  verify: (event: MouseEvent) => void;
  editPhone: (event: MouseEvent) => void;
} => {
  const { form } = context;
  return {
    // As submit buttons, the form's submit handler acts instead.
    send: (event) => {
      const state = form.getState();
      if (event.defaultPrevented || state.sendDisabled) return;
      if (state.phase !== "phone" && state.phase !== "failed") {
        void form.send();
      }
    },
    verify: (event) => {
      const state = form.getState();
      if (event.defaultPrevented || state.verifyDisabled) return;
      if (state.phase !== "code") void form.verify();
    },
    editPhone: (event) => {
      if (!event.defaultPrevented) form.editPhoneNumber();
    },
  };
};

/** The digit shown by each segment. */
export const codeDigits = (value: string, length: number): string[] =>
  otpCodeSegments(value, length);

/** Code input handlers of the form's code field. */
export const codeFieldHandlers = (
  context: OtpFormSvelteContext,
  getContainer: () => HTMLElement | null | undefined,
): OtpCodeInputHandlers => {
  const { form } = context;
  return createOtpCodeInputHandlers({
    getValue: () => form.getState().code,
    getLength: () => form.getState().codeLength,
    isReadOnly: () => form.getState().phase !== "code",
    onChange: form.setCode,
    getContainer,
  });
};

/** Props of the standalone `OtpCodeInput`. */
export type OtpCodeInputProps = {
  /** Digits (`bind:value`). */
  value?: string | undefined;
  /** Number of digits. Default 6. */
  length?: number | undefined;
  readOnly?: boolean | undefined;
  invalid?: boolean | undefined;
  /** Group id; segment `i` gets `<id>-<i>`. */
  id?: string | undefined;
  /** Focus the first empty segment on mount. */
  autoFocus?: boolean | undefined;
  /** Fill the code from the SMS with WebOTP when supported. */
  webOtp?: boolean | undefined;
  /** Renders a hidden input with this name and the value, for form posts. */
  name?: string | undefined;
  locale?: OtpLocale | undefined;
  messages?: OtpMessageOverrides | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  onComplete?: ((value: string) => void) | undefined;
};

/** Component events of `OtpCodeInput` (`on:complete`). */
export type OtpCodeInputEvents = {
  complete: CustomEvent<string>;
};

type CodeInputModel = {
  handlers: OtpCodeInputHandlers;
  id: string;
  parts: (props: {
    id: string | undefined;
    value: string | undefined;
    length: number;
    readOnly: boolean;
    invalid: boolean;
    labelledBy: string | undefined;
    describedBy: string | undefined;
    locale: OtpLocale | undefined;
    messages: OtpMessageOverrides | undefined;
  }) => { group: OtpAttrs; segments: OtpAttrs[]; digits: string[] };
  /** `use:` action on the group: autofocus and WebOTP. */
  group: (
    node: HTMLElement,
    options: { autoFocus: boolean; webOtp: boolean },
  ) => { destroy: () => void };
};

/** Model of a standalone `OtpCodeInput` (component init only). */
export const createOtpCodeInputModel = (options: {
  getValue: () => string | undefined;
  getLength: () => number;
  isReadOnly: () => boolean;
  /** Writes the new value to the component's `value` prop. */
  setValue: (value: string) => void;
  getProps: () => Pick<OtpCodeInputProps, "onValueChange" | "onComplete">;
}): CodeInputModel => {
  const dispatch = createEventDispatcher();
  let container: HTMLElement | undefined;
  const length = (): number => options.getLength() || DEFAULT_OTP_CODE_LENGTH;
  const current = (): string => options.getValue() ?? "";
  const change = (value: string): void => {
    options.setValue(value);
    options.getProps().onValueChange?.(value);
    if (isOtpCodeComplete(value, length())) {
      options.getProps().onComplete?.(value);
      dispatch("complete", value);
    }
  };
  const handlers = createOtpCodeInputHandlers({
    getValue: current,
    getLength: length,
    isReadOnly: options.isReadOnly,
    onChange: change,
    getContainer: () => container,
  });
  let translator: { key: unknown[]; t: OtpTranslator } | undefined;
  const generatedId = randomId("k-otp-code");
  return {
    handlers,
    id: generatedId,
    parts: (props) => {
      const key = [props.locale, props.messages];
      if (!translator || key.some((k, i) => k !== translator?.key[i])) {
        translator = {
          key,
          t: createOtpTranslator({
            locale: props.locale,
            messages: props.messages,
          }),
        };
      }
      const size = props.length || DEFAULT_OTP_CODE_LENGTH;
      const value = sanitizeOtpCode(props.value ?? "", size);
      return {
        ...getOtpCodeInputParts({
          id: props.id ?? generatedId,
          value,
          length: size,
          readOnly: props.readOnly,
          invalid: props.invalid,
          labelledBy: props.labelledBy,
          describedBy: props.describedBy,
          t: translator.t,
        }),
        digits: otpCodeSegments(value, size),
      };
    },
    group: (node, groupOptions) => {
      container = node;
      if (groupOptions.autoFocus) {
        focusOtpCodeSegment(node, Math.min(current().length, length() - 1));
      }
      const controller = new AbortController();
      if (groupOptions.webOtp) {
        void receiveWebOtp({
          signal: controller.signal,
          length: length(),
        }).then((code) => {
          if (code && !controller.signal.aborted) change(code);
        });
      }
      return {
        destroy: () => {
          controller.abort();
          container = undefined;
        },
      };
    },
  };
};

export type {
  OtpFormPhase,
  OtpFormState,
  OtpLocale,
  OtpMessageKey,
  OtpMessageOverrides,
} from "..";
