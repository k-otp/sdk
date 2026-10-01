import * as Vue from "vue";
import {
  type ComputedRef,
  computed,
  type DefineSetupFnComponent,
  defineComponent,
  getCurrentInstance,
  h,
  type InjectionKey,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  type Ref,
  ref,
  type ShallowRef,
  type SlotsType,
  shallowRef,
  type VNode,
  watch,
} from "vue";
import type {
  IssueResult,
  OtpApiError,
  OtpClientOptions,
  VerifyResult,
} from "../../core";
import { toOtpClient } from "../../core/internal";
import { type OtpClientLike, useOtpClient } from "../../vue";
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

/** What every part injects from `OtpFormRoot`. */
export type OtpFormContext = {
  form: OtpFormController;
  state: Readonly<ShallowRef<OtpFormState>>;
  parts: ComputedRef<OtpFormParts>;
  t: ComputedRef<OtpTranslator>;
};

/** Injection key of the form context. */
export const OTP_FORM_KEY: InjectionKey<OtpFormContext> = Symbol("k-otp-form");

/** The injected form context; throws outside `OtpFormRoot`. */
export const useOtpFormContext = (): OtpFormContext => {
  const context = inject(OTP_FORM_KEY, null);
  if (!context) {
    throw new TypeError(
      "K-OTP form parts must be rendered inside <OtpForm.Root> (OtpFormRoot).",
    );
  }
  return context;
};

/** Plain values passed to every scoped slot. */
export type OtpFormSlotProps = {
  form: OtpFormController;
  state: OtpFormState;
  parts: OtpFormParts;
  t: OtpTranslator;
};

const slotProps = (context: OtpFormContext): OtpFormSlotProps => ({
  form: context.form,
  state: context.state.value,
  parts: context.parts.value,
  t: context.t.value,
});

/** Vue 3.5 `useId`, else a per-app sequence (pass `id` for SSR on < 3.5). */
const useStableId = (prefix: string): string => {
  const useId = (Vue as { useId?: () => string }).useId;
  const generated = useId?.() ?? String(getCurrentInstance()?.uid ?? 0);
  return `${prefix}-${generated.replace(/[^\w-]/g, "")}`;
};

/** Runtime prop definitions: booleans keep `undefined` when absent. */
const propDefs = <P>(keys: string[], booleans: string[] = []): P =>
  Object.fromEntries(
    keys.map((key) => [
      key,
      booleans.includes(key) ? { type: Boolean, default: undefined } : null,
    ]),
  ) as P;

export type OtpFormRootProps = Omit<
  OtpFormConfig,
  "onSent" | "onVerified" | "onError" | "onPhaseChange"
> & {
  /** A client you created; defaults to the injected one (`createOtpPlugin`). */
  client?: OtpClientLike | undefined;
  /** `createOtpClient` options (read once), instead of `client`. */
  options?: OtpClientOptions | undefined;
  /** Root id; part ids derive from it. */
  id?: string | undefined;
  codeLength?: number | undefined;
  defaultPhoneNumber?: string | undefined;
  resendCooldownMs?: number | undefined;
  idempotencyKeyPrefix?: string | undefined;
  createIdempotencyKey?: (() => string) | undefined;
  locale?: OtpLocale | undefined;
  messages?: OtpMessageOverrides | undefined;
};

export type OtpFormEmits = {
  /** A code was sent. */
  sent: (result: IssueResult) => true;
  /** The code was verified. */
  verified: (result: VerifyResult) => true;
  /** `issue` or `verify` failed with an API error. */
  error: (error: OtpApiError, operation: OtpFormOperation) => true;
  phaseChange: (phase: OtpFormPhase, previous: OtpFormPhase) => true;
};

/** Vue's "no props" / "no emits" type. */
// biome-ignore lint/complexity/noBannedTypes: Vue spells "nothing" as {}.
type None = {};

type DefaultSlot<T> = SlotsType<{ default?: (props: T) => VNode[] }>;

const ROOT_PROPS = [
  "client",
  "options",
  "id",
  "purpose",
  "issue",
  "autoSubmit",
  "webOtp",
  "clearCodeOnMismatch",
  "allowInternational",
  "codeLength",
  "defaultPhoneNumber",
  "resendCooldownMs",
  "idempotencyKeyPrefix",
  "createIdempotencyKey",
  "locale",
  "messages",
];
const ROOT_BOOLEANS = [
  "autoSubmit",
  "webOtp",
  "clearCodeOnMismatch",
  "allowInternational",
];
const ROOT_EMITS = ["sent", "verified", "error", "phaseChange"];

/**
 * The `<form>` that owns one OTP flow and provides it to the parts. Settings
 * that create the flow are read once; `purpose`, `issue`, `locale` and
 * `messages` stay reactive. Events: `sent`, `verified`, `error`,
 * `phaseChange`.
 */
export const OtpFormRoot: DefineSetupFnComponent<
  OtpFormRootProps,
  OtpFormEmits,
  DefaultSlot<OtpFormSlotProps>
> = defineComponent<
  OtpFormRootProps,
  OtpFormEmits,
  string,
  DefaultSlot<OtpFormSlotProps>
>(
  (props, { emit, slots }) => {
    const client = useOtpClient(
      props.client ?? (props.options ? toOtpClient(props.options) : undefined),
    );
    const config = (): OtpFormConfig => ({
      purpose: props.purpose,
      issue: props.issue,
      autoSubmit: props.autoSubmit,
      webOtp: props.webOtp,
      clearCodeOnMismatch: props.clearCodeOnMismatch,
      allowInternational: props.allowInternational,
      onSent: (result) => emit("sent", result),
      onVerified: (result) => emit("verified", result),
      onError: (error, operation) => emit("error", error, operation),
      onPhaseChange: (phase, previous) => emit("phaseChange", phase, previous),
    });
    const form = createOtpForm(client, {
      ...config(),
      codeLength: props.codeLength,
      defaultPhoneNumber: props.defaultPhoneNumber,
      resendCooldownMs: props.resendCooldownMs,
      idempotencyKeyPrefix: props.idempotencyKeyPrefix,
      createIdempotencyKey: props.createIdempotencyKey,
    });
    watch(config, (next) => form.configure(next));
    const state = shallowRef(form.getState());
    const unsubscribe = form.subscribe(() => {
      state.value = form.getState();
    });
    onBeforeUnmount(() => {
      unsubscribe();
      form.abort();
    });
    const generatedId = useStableId("k-otp");
    const id = computed(() => props.id ?? generatedId);
    const t = computed(() =>
      createOtpTranslator({ locale: props.locale, messages: props.messages }),
    );
    const parts = computed(() =>
      getOtpFormParts(state.value, { id: id.value, t: t.value }),
    );
    const context: OtpFormContext = { form, state, parts, t };
    provide(OTP_FORM_KEY, context);

    const root: Ref<HTMLFormElement | null> = ref(null);
    let appliedFocus = 0;
    watch(
      () => state.value.focus,
      (focus) => {
        if (!focus || focus.seq === appliedFocus) return;
        appliedFocus = focus.seq;
        focusOtpFormTarget(root.value, focus.target, state.value);
      },
      { flush: "post" },
    );
    const onSubmit = (event: Event): void => {
      event.preventDefault();
      void form.submit();
    };
    return () =>
      h(
        "form",
        { ...parts.value.root, ref: root, onSubmit },
        slots.default?.(slotProps(context)),
      );
  },
  {
    name: "OtpFormRoot",
    props: propDefs(ROOT_PROPS, ROOT_BOOLEANS),
    emits: ROOT_EMITS,
  },
);

/** Props of the field parts. */
export type OtpFormFieldProps = {
  label?: string | undefined;
  /** Help text under the input; `""` hides it. */
  description?: string | undefined;
  placeholder?: string | undefined;
};

export type OtpFormPhoneFieldSlotProps = OtpFormSlotProps & {
  labelProps: OtpAttrs;
  inputProps: Record<string, unknown>;
  descriptionProps: OtpAttrs;
  errorProps: OtpAttrs;
};

const caretAtEnd = (input: HTMLInputElement): boolean =>
  input.selectionStart === null || input.selectionStart >= input.value.length;

/** Label + phone input + description/error, wired with ARIA. */
export const OtpFormPhoneField: DefineSetupFnComponent<
  OtpFormFieldProps,
  None,
  DefaultSlot<OtpFormPhoneFieldSlotProps>
> = defineComponent<
  OtpFormFieldProps,
  None,
  string,
  DefaultSlot<OtpFormPhoneFieldSlotProps>
>(
  (props, { slots }) => {
    const context = useOtpFormContext();
    const { form } = context;
    const onInput = (event: Event): void => {
      const input = event.target as HTMLInputElement;
      form.setPhoneNumber(input.value, { format: caretAtEnd(input) });
      const next = form.getState().phoneNumber;
      if (input.value !== next) input.value = next;
    };
    const onBlur = (): void => form.setPhoneNumber(form.getState().phoneNumber);
    return () => {
      const parts = context.parts.value;
      const inputProps = {
        ...parts.phoneInput,
        value: context.state.value.phoneNumber,
        placeholder: props.placeholder ?? parts.text.phonePlaceholder,
        onInput,
        onBlur,
      };
      if (slots.default) {
        return h(
          "div",
          parts.phoneField,
          slots.default({
            ...slotProps(context),
            labelProps: parts.phoneLabel,
            inputProps,
            descriptionProps: parts.phoneDescription,
            errorProps: parts.phoneError,
          }),
        );
      }
      const description = props.description ?? parts.text.phoneDescription;
      return h("div", parts.phoneField, [
        h("label", parts.phoneLabel, props.label ?? parts.text.phoneLabel),
        h("input", inputProps),
        description ? h("p", parts.phoneDescription, description) : null,
        parts.text.phoneError
          ? h("p", parts.phoneError, parts.text.phoneError)
          : null,
      ]);
    };
  },
  {
    name: "OtpFormPhoneField",
    props: propDefs(["label", "description", "placeholder"]),
  },
);

/** A button part rendering its default copy unless a slot is given. */
const buttonPart = (
  name: string,
  pick: (parts: OtpFormParts) => OtpAttrs,
  text: (parts: OtpFormParts) => string,
  action: (context: OtpFormContext) => void,
): DefineSetupFnComponent<None, None, DefaultSlot<OtpFormSlotProps>> =>
  defineComponent<None, None, string, DefaultSlot<OtpFormSlotProps>>(
    (_props, { slots }) => {
      const context = useOtpFormContext();
      const onClick = (event: MouseEvent): void => {
        if (!event.defaultPrevented) action(context);
      };
      return () => {
        const parts = context.parts.value;
        return h(
          "button",
          { ...pick(parts), onClick },
          slots.default?.(slotProps(context)) ?? text(parts),
        );
      };
    },
    { name },
  );

/**
 * Sends the code; becomes "resend" with the cooldown countdown. A submit
 * button in the phone step (Enter in the phone input sends).
 */
export const OtpFormSendButton: DefineSetupFnComponent<
  None,
  None,
  DefaultSlot<OtpFormSlotProps>
> = buttonPart(
  "OtpFormSendButton",
  (parts) => parts.sendButton,
  (parts) => parts.text.sendButton,
  ({ form, parts, state }) => {
    // As a submit button, the form's submit handler sends.
    if (parts.value.sendButton.type === "button" && !state.value.sendDisabled) {
      void form.send();
    }
  },
);

/** Verifies the entered code (the submit button of the code step). */
export const OtpFormVerifyButton: DefineSetupFnComponent<
  None,
  None,
  DefaultSlot<OtpFormSlotProps>
> = buttonPart(
  "OtpFormVerifyButton",
  (parts) => parts.verifyButton,
  (parts) => parts.text.verifyButton,
  ({ form, parts, state }) => {
    if (
      parts.value.verifyButton.type === "button" &&
      !state.value.verifyDisabled
    ) {
      void form.verify();
    }
  },
);

/** Goes back to the phone step to change the number. */
export const OtpFormEditPhoneButton: DefineSetupFnComponent<
  None,
  None,
  DefaultSlot<OtpFormSlotProps>
> = buttonPart(
  "OtpFormEditPhoneButton",
  (parts) => parts.editPhone,
  (parts) => parts.text.editPhone,
  ({ form }) => form.editPhoneNumber(),
);

const textPart = (
  name: string,
  tag: string,
  pick: (parts: OtpFormParts) => OtpAttrs,
  text: (parts: OtpFormParts) => string | undefined,
): DefineSetupFnComponent<None, None, DefaultSlot<OtpFormSlotProps>> =>
  defineComponent<None, None, string, DefaultSlot<OtpFormSlotProps>>(
    (_props, { slots }) => {
      const context = useOtpFormContext();
      return () => {
        const parts = context.parts.value;
        return h(
          tag,
          pick(parts),
          slots.default?.(slotProps(context)) ?? text(parts),
        );
      };
    },
    { name },
  );

/** Time left before the code expires (`role="timer"`, not announced). */
export const OtpFormCountdown: DefineSetupFnComponent<
  None,
  None,
  DefaultSlot<OtpFormSlotProps>
> = textPart(
  "OtpFormCountdown",
  "span",
  (parts) => parts.countdown,
  (parts) => parts.text.countdown,
);

/** Polite live region with the current status or error (always rendered). */
export const OtpFormMessage: DefineSetupFnComponent<
  None,
  None,
  DefaultSlot<OtpFormSlotProps>
> = textPart(
  "OtpFormMessage",
  "p",
  (parts) => parts.message,
  (parts) => parts.text.message,
);

const renderSegments = (
  group: OtpAttrs,
  segments: readonly OtpAttrs[],
  value: string,
  length: number,
  handlers: OtpCodeInputHandlers,
  groupRef: Ref<HTMLElement | null>,
  extra?: VNode | null,
): VNode => {
  const digits = otpCodeSegments(value, length);
  return h("div", { ...group, ref: groupRef }, [
    ...segments.map((attrs, index) =>
      h("input", {
        ...attrs,
        key: index,
        value: digits[index] ?? "",
        onInput: (event: Event) => handlers.input(index, event),
        onKeydown: (event: KeyboardEvent) => handlers.keydown(index, event),
        onPaste: (event: ClipboardEvent) => handlers.paste(index, event),
        onFocus: (event: FocusEvent) => handlers.focus(index, event),
      }),
    ),
    extra ?? null,
  ]);
};

/** Label + segmented code input + description/error of the form. */
export const OtpFormCodeField: DefineSetupFnComponent<
  OtpFormFieldProps,
  None,
  DefaultSlot<OtpFormSlotProps & { input: VNode }>
> = defineComponent<
  OtpFormFieldProps,
  None,
  string,
  DefaultSlot<OtpFormSlotProps & { input: VNode }>
>(
  (props, { slots }) => {
    const context = useOtpFormContext();
    const { form } = context;
    const group: Ref<HTMLElement | null> = ref(null);
    const handlers = createOtpCodeInputHandlers({
      getValue: () => form.getState().code,
      getLength: () => form.getState().codeLength,
      isReadOnly: () => form.getState().phase !== "code",
      onChange: form.setCode,
      getContainer: () => group.value,
    });
    return () => {
      const parts = context.parts.value;
      const state = context.state.value;
      const input = renderSegments(
        parts.codeInput,
        parts.codeSegments,
        state.code,
        state.codeLength,
        handlers,
        group,
      );
      if (slots.default) {
        return h(
          "div",
          parts.codeField,
          slots.default({ ...slotProps(context), input }),
        );
      }
      const description = props.description ?? parts.text.codeDescription;
      return h("div", parts.codeField, [
        h("label", parts.codeLabel, props.label ?? parts.text.codeLabel),
        input,
        description ? h("p", parts.codeDescription, description) : null,
        parts.text.codeError
          ? h("p", parts.codeError, parts.text.codeError)
          : null,
      ]);
    };
  },
  {
    name: "OtpFormCodeField",
    props: propDefs(["label", "description", "placeholder"]),
  },
);

export type OtpCodeInputProps = {
  /** `v-model` value (digits). */
  modelValue?: string | undefined;
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
};

type OtpCodeInputEmits = {
  "update:modelValue": (value: string) => true;
  complete: (value: string) => true;
};

/**
 * A standalone segmented one-time-code input (`v-model`), with
 * `autocomplete="one-time-code"`, `inputmode="numeric"`, paste across
 * segments, Backspace/arrow navigation and optional WebOTP.
 */
export const OtpCodeInput: DefineSetupFnComponent<
  OtpCodeInputProps,
  OtpCodeInputEmits
> = defineComponent<OtpCodeInputProps, OtpCodeInputEmits>(
  (props, { emit, attrs }) => {
    const length = (): number => props.length ?? DEFAULT_OTP_CODE_LENGTH;
    const inner = ref(sanitizeOtpCode(props.modelValue ?? "", length()));
    watch(
      () => props.modelValue,
      (value) => {
        if (value !== undefined) inner.value = sanitizeOtpCode(value, length());
      },
    );
    const generatedId = useStableId("k-otp-code");
    const group: Ref<HTMLElement | null> = ref(null);
    const change = (value: string): void => {
      inner.value = value;
      emit("update:modelValue", value);
      if (isOtpCodeComplete(value, length())) emit("complete", value);
    };
    const handlers = createOtpCodeInputHandlers({
      getValue: () => inner.value,
      getLength: length,
      isReadOnly: () => props.readOnly === true,
      onChange: change,
      getContainer: () => group.value,
    });
    const t = computed(() =>
      createOtpTranslator({ locale: props.locale, messages: props.messages }),
    );
    let webOtp: AbortController | undefined;
    onMounted(() => {
      if (props.autoFocus) {
        focusOtpCodeSegment(
          group.value,
          Math.min(inner.value.length, length() - 1),
        );
      }
      if (props.webOtp) {
        webOtp = new AbortController();
        const { signal } = webOtp;
        void receiveWebOtp({ signal, length: length() }).then((code) => {
          if (code && !signal.aborted) change(code);
        });
      }
    });
    onBeforeUnmount(() => webOtp?.abort());
    return () => {
      const parts = getOtpCodeInputParts({
        id: props.id ?? generatedId,
        value: inner.value,
        length: length(),
        readOnly: props.readOnly,
        invalid: props.invalid,
        labelledBy: attrs["aria-labelledby"] as string | undefined,
        describedBy: attrs["aria-describedby"] as string | undefined,
        t: t.value,
      });
      return renderSegments(
        parts.group,
        parts.segments,
        inner.value,
        length(),
        handlers,
        group,
        props.name
          ? h("input", { type: "hidden", name: props.name, value: inner.value })
          : null,
      );
    };
  },
  {
    name: "OtpCodeInput",
    props: propDefs(
      [
        "modelValue",
        "length",
        "readOnly",
        "invalid",
        "id",
        "autoFocus",
        "webOtp",
        "name",
        "locale",
        "messages",
      ],
      ["readOnly", "invalid", "autoFocus", "webOtp"],
    ),
    emits: ["update:modelValue", "complete"],
  },
);

const PresetBody = defineComponent(
  (_props, { slots }) => {
    const context = useOtpFormContext();
    return () => {
      const state = context.state.value;
      // Once verified, only the fields and the result stay.
      const active = state.phase !== "verified";
      return [
        h(OtpFormPhoneField),
        state.issued ? h(OtpFormCodeField) : null,
        active && state.issued ? h(OtpFormCountdown) : null,
        active && state.issued ? h(OtpFormVerifyButton) : null,
        active ? h(OtpFormSendButton) : null,
        active && state.issued ? h(OtpFormEditPhoneButton) : null,
        slots.default?.(),
        h(OtpFormMessage),
      ];
    };
  },
  { name: "OtpFormPresetBody" },
);

/**
 * The ready-made form (phone field, send button, code field with countdown,
 * verify, change number, status message). Takes every `OtpFormRoot` prop
 * and event; its default slot renders between the fields and the message.
 */
const OtpFormPreset: DefineSetupFnComponent<
  OtpFormRootProps,
  OtpFormEmits,
  SlotsType<{ default?: () => VNode[] }>
> = defineComponent<
  OtpFormRootProps,
  OtpFormEmits,
  string,
  SlotsType<{ default?: () => VNode[] }>
>(
  (_props, { slots }) =>
    () =>
      // Props and listeners fall through to OtpFormRoot (no props declared).
      h(OtpFormRoot, null, {
        default: () => h(PresetBody, null, { default: slots.default }),
      }),
  { name: "OtpForm" },
);

/**
 * `<OtpForm />` is the preset; `OtpForm.Root`, `OtpForm.PhoneField`, ... are
 * the headless parts to compose your own layout.
 */
export const OtpForm: typeof OtpFormPreset & {
  Root: typeof OtpFormRoot;
  PhoneField: typeof OtpFormPhoneField;
  SendButton: typeof OtpFormSendButton;
  CodeField: typeof OtpFormCodeField;
  VerifyButton: typeof OtpFormVerifyButton;
  Countdown: typeof OtpFormCountdown;
  Message: typeof OtpFormMessage;
  EditPhoneButton: typeof OtpFormEditPhoneButton;
} = Object.assign(OtpFormPreset, {
  Root: OtpFormRoot,
  PhoneField: OtpFormPhoneField,
  SendButton: OtpFormSendButton,
  CodeField: OtpFormCodeField,
  VerifyButton: OtpFormVerifyButton,
  Countdown: OtpFormCountdown,
  Message: OtpFormMessage,
  EditPhoneButton: OtpFormEditPhoneButton,
});
