import {
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ClipboardEvent,
  type CompositionEvent,
  type Context,
  createContext,
  type FocusEvent,
  type FormEvent,
  type FormHTMLAttributes,
  Fragment,
  type HTMLAttributes,
  createElement as h,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type LabelHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { OtpClientOptions } from "../../core";
import { toOtpClient } from "../../core/internal";
import { type OtpClientLike, useOtpClient } from "../../react";
import {
  createOtpCodeInputHandlers,
  createOtpForm,
  createOtpTranslator,
  DEFAULT_OTP_CODE_LENGTH,
  DEFAULT_OTP_LOCALE,
  focusOtpCodeSegment,
  focusOtpFormTarget,
  getOtpCodeInputParts,
  getOtpFormParts,
  isOtpCodeComplete,
  type OtpAttrs,
  type OtpCodeInputHandlers,
  type OtpFormConfig,
  type OtpFormController,
  type OtpFormOptions,
  type OtpFormParts,
  type OtpFormState,
  type OtpLocale,
  type OtpLocaleOption,
  type OtpMessageOverrides,
  type OtpTranslator,
  otpCodeSegments,
  receiveWebOtp,
  resolveOtpLocale,
  sanitizeOtpCode,
  watchOtpDocumentLocale,
} from "..";

/** DOM attribute names that React spells differently. */
const REACT_NAMES: Readonly<Record<string, string>> = {
  for: "htmlFor",
  readonly: "readOnly",
  inputmode: "inputMode",
  autocomplete: "autoComplete",
  autocapitalize: "autoCapitalize",
  enterkeyhint: "enterKeyHint",
  spellcheck: "spellCheck",
  tabindex: "tabIndex",
  novalidate: "noValidate",
};

/** Shared part attributes as React props. */
const props = (attrs: OtpAttrs): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) out[REACT_NAMES[key] ?? key] = value;
  }
  return out;
};

/** React ids (`:r1:`, `«r1»`) are not valid in CSS selectors; keep [\w-]. */
const useStableId = (id: string | undefined, prefix: string): string => {
  const generated = useId();
  return id ?? `${prefix}${generated.replace(/[^\w-]/g, "")}`;
};

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server (where React
 * 18 warns about layout effects). Chosen once per environment.
 */
const useClientLayoutEffect: typeof useLayoutEffect = (effect, deps) =>
  (typeof document === "undefined" ? useEffect : useLayoutEffect)(effect, deps);

/**
 * The locale to render. `"auto"` renders the default on the server and the
 * first client render, then follows `<html lang>` after mount.
 */
const useOtpLocale = (locale: OtpLocaleOption | undefined): OtpLocale => {
  const [detected, setDetected] = useState<OtpLocale>(DEFAULT_OTP_LOCALE);
  useEffect(
    () => (locale === "auto" ? watchOtpDocumentLocale(setDetected) : undefined),
    [locale],
  );
  return locale === "auto" ? detected : resolveOtpLocale(locale);
};

/** Settings of the form (see `createOtpForm`). */
export type OtpFormSettings = OtpFormConfig &
  Pick<
    OtpFormOptions,
    | "codeLength"
    | "defaultPhoneNumber"
    | "resendCooldownMs"
    | "idempotencyKeyPrefix"
    | "createIdempotencyKey"
  > & {
    /**
     * `ko` (default) or `en`, or `"auto"` to follow `<html lang>` after
     * mount (hydration-safe).
     */
    locale?: OtpLocaleOption | undefined;
    /** Override any message of the catalog. */
    messages?: OtpMessageOverrides | undefined;
  };

/** What every part reads from `OtpFormRoot` (also the render-prop value). */
export type OtpFormContextValue = {
  form: OtpFormController;
  state: OtpFormState;
  parts: OtpFormParts;
  t: OtpTranslator;
};

const OtpFormContext: Context<OtpFormContextValue | null> =
  createContext<OtpFormContextValue | null>(null);
OtpFormContext.displayName = "OtpFormContext";

/** The form controller, state, part attributes and translator. */
export const useOtpFormContext = (): OtpFormContextValue => {
  const value = useContext(OtpFormContext);
  if (!value) {
    throw new TypeError(
      "K-OTP form parts must be rendered inside <OtpForm.Root> (OtpFormRoot).",
    );
  }
  return value;
};

type RenderChildren<T> = ReactNode | ((value: T) => ReactNode);
const renderChildren = <T>(children: RenderChildren<T>, value: T): ReactNode =>
  typeof children === "function" ? children(value) : children;

export type OtpFormRootProps = Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "children" | "onSubmit" | "onError" | "id"
> &
  OtpFormSettings & {
    /** A client you created; defaults to the nearest `OtpProvider`. */
    client?: OtpClientLike | undefined;
    /** `createOtpClient` options (read once), instead of `client`. */
    options?: OtpClientOptions | undefined;
    /** Root id; part ids derive from it. Defaults to `useId()`. */
    id?: string | undefined;
    children?: RenderChildren<OtpFormContextValue>;
  };

/**
 * The `<form>` that owns one OTP flow and provides it to the parts. Settings
 * that create the flow (`codeLength`, `resendCooldownMs`, the client, ...)
 * are read once; callbacks, `purpose`, `issue`, `locale` and `messages` may
 * change on every render.
 */
export const OtpFormRoot = (rootProps: OtpFormRootProps): ReactElement => {
  const {
    client: clientProp,
    options: clientOptions,
    id: idProp,
    locale,
    messages,
    children,
    purpose,
    issue,
    autoSubmit,
    webOtp,
    clearCodeOnMismatch,
    allowInternational,
    onSent,
    onVerified,
    onError,
    onPhaseChange,
    codeLength,
    defaultPhoneNumber,
    resendCooldownMs,
    idempotencyKeyPrefix,
    createIdempotencyKey,
    ...rest
  } = rootProps;
  const owned = useRef<OtpClientLike | null>(null);
  if (!clientProp && clientOptions && !owned.current) {
    owned.current = toOtpClient(clientOptions);
  }
  const client = useOtpClient(clientProp ?? owned.current ?? undefined);
  const config: OtpFormConfig = {
    purpose,
    issue,
    autoSubmit,
    webOtp,
    clearCodeOnMismatch,
    allowInternational,
    onSent,
    onVerified,
    onError,
    onPhaseChange,
  };
  const [form] = useState(() =>
    createOtpForm(client, {
      ...config,
      codeLength,
      defaultPhoneNumber,
      resendCooldownMs,
      idempotencyKeyPrefix,
      createIdempotencyKey,
    }),
  );
  // Latest callbacks and settings, applied after render (configure may
  // notify, when allowInternational changes).
  useClientLayoutEffect(() => form.configure(config));
  const state = useSyncExternalStore(
    form.subscribe,
    form.getState,
    form.getState,
  );
  useEffect(() => () => form.abort(), [form]);

  const id = useStableId(idProp, "k-otp");
  const effectiveLocale = useOtpLocale(locale);
  const t = useMemo(
    () => createOtpTranslator({ locale: effectiveLocale, messages }),
    [effectiveLocale, messages],
  );
  const parts = useMemo(
    () => getOtpFormParts(state, { id, t }),
    [state, id, t],
  );

  const root = useRef<HTMLFormElement | null>(null);
  const appliedFocus = useRef(0);
  useEffect(() => {
    const focus = state.focus;
    if (!focus || focus.seq === appliedFocus.current) return;
    appliedFocus.current = focus.seq;
    focusOtpFormTarget(root.current, focus.target, state);
  }, [state]);

  const value = useMemo(
    () => ({ form, state, parts, t }),
    [form, state, parts, t],
  );
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void form.submit();
  };
  return h(
    OtpFormContext.Provider,
    { value },
    h(
      "form",
      { ...props(parts.root), ...rest, ref: root, onSubmit },
      renderChildren(children, value),
    ),
  );
};

export type OtpFormPhoneFieldRenderProps = OtpFormContextValue & {
  labelProps: LabelHTMLAttributes<HTMLLabelElement>;
  inputProps: InputHTMLAttributes<HTMLInputElement>;
  descriptionProps: HTMLAttributes<HTMLElement>;
  errorProps: HTMLAttributes<HTMLElement>;
};

export type OtpFormPhoneFieldProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> & {
  label?: ReactNode;
  /** Help text under the input; `null` hides it. */
  description?: ReactNode;
  placeholder?: string | undefined;
  /** Render the label/input/description yourself with the prop bags. */
  children?: (props: OtpFormPhoneFieldRenderProps) => ReactNode;
};

const caretAtEnd = (input: HTMLInputElement): boolean =>
  input.selectionStart === null || input.selectionStart >= input.value.length;

/** Label + phone input + description/error, wired with ARIA. */
export const OtpFormPhoneField = ({
  label,
  description,
  placeholder,
  children,
  ...rest
}: OtpFormPhoneFieldProps): ReactElement => {
  const context = useOtpFormContext();
  const { form, state, parts } = context;
  const inputProps: InputHTMLAttributes<HTMLInputElement> = {
    ...props(parts.phoneInput),
    value: state.phoneNumber,
    placeholder: placeholder ?? parts.text.phonePlaceholder,
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      form.setPhoneNumber(event.currentTarget.value, {
        format: caretAtEnd(event.currentTarget),
      }),
    onBlur: () => form.setPhoneNumber(state.phoneNumber),
  };
  const labelProps = props(parts.phoneLabel);
  const descriptionProps = props(parts.phoneDescription);
  const errorProps = props(parts.phoneError);
  const field = props(parts.phoneField);
  if (children) {
    return h(
      "div",
      { ...field, ...rest },
      children({
        ...context,
        labelProps,
        inputProps,
        descriptionProps,
        errorProps,
      }),
    );
  }
  return h(
    "div",
    { ...field, ...rest },
    h("label", labelProps, label ?? parts.text.phoneLabel),
    h("input", inputProps),
    description === null
      ? null
      : h("p", descriptionProps, description ?? parts.text.phoneDescription),
    parts.text.phoneError ? h("p", errorProps, parts.text.phoneError) : null,
  );
};

type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "type"
> & { children?: RenderChildren<OtpFormContextValue> };

const useButtonClick = (
  onClick: ButtonProps["onClick"],
  action: () => void,
): ((event: MouseEvent<HTMLButtonElement>) => void) => {
  return (event) => {
    onClick?.(event);
    if (!event.defaultPrevented) action();
  };
};

export type OtpFormSendButtonProps = ButtonProps;

/**
 * Sends the code; becomes "resend" with the cooldown countdown. A submit
 * button in the phone step (Enter in the phone input sends).
 */
export const OtpFormSendButton = ({
  children,
  onClick,
  ...rest
}: OtpFormSendButtonProps): ReactElement => {
  const context = useOtpFormContext();
  const { form, state, parts } = context;
  const attrs = props(parts.sendButton);
  const click = useButtonClick(onClick, () => {
    // As a submit button, the form's submit handler sends.
    if (parts.sendButton.type === "button" && !state.sendDisabled) {
      void form.send();
    }
  });
  return h(
    "button",
    {
      ...attrs,
      ...rest,
      type: parts.sendButton.type as "submit",
      onClick: click,
    },
    children === undefined
      ? parts.text.sendButton
      : renderChildren(children, context),
  );
};

export type OtpFormVerifyButtonProps = ButtonProps;

/** Verifies the entered code (the submit button of the code step). */
export const OtpFormVerifyButton = ({
  children,
  onClick,
  ...rest
}: OtpFormVerifyButtonProps): ReactElement => {
  const context = useOtpFormContext();
  const { form, state, parts } = context;
  const click = useButtonClick(onClick, () => {
    if (parts.verifyButton.type === "button" && !state.verifyDisabled) {
      void form.verify();
    }
  });
  return h(
    "button",
    {
      ...props(parts.verifyButton),
      ...rest,
      type: parts.verifyButton.type as "submit",
      onClick: click,
    },
    children === undefined
      ? parts.text.verifyButton
      : renderChildren(children, context),
  );
};

export type OtpFormEditPhoneButtonProps = ButtonProps;

/** Goes back to the phone step to change the number. */
export const OtpFormEditPhoneButton = ({
  children,
  onClick,
  ...rest
}: OtpFormEditPhoneButtonProps): ReactElement => {
  const context = useOtpFormContext();
  const click = useButtonClick(onClick, () => context.form.editPhoneNumber());
  return h(
    "button",
    {
      ...props(context.parts.editPhone),
      ...rest,
      type: "button",
      onClick: click,
    },
    children === undefined
      ? context.parts.text.editPhone
      : renderChildren(children, context),
  );
};

export type OtpFormCountdownProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  "children"
> & { children?: RenderChildren<OtpFormContextValue> };

/** Time left before the code expires (`role="timer"`, not announced). */
export const OtpFormCountdown = ({
  children,
  ...rest
}: OtpFormCountdownProps): ReactElement => {
  const context = useOtpFormContext();
  return h(
    "span",
    { ...props(context.parts.countdown), ...rest },
    children === undefined
      ? context.parts.text.countdown
      : renderChildren(children, context),
  );
};

export type OtpFormMessageProps = Omit<
  HTMLAttributes<HTMLParagraphElement>,
  "children"
> & { children?: RenderChildren<OtpFormContextValue> };

/**
 * Polite live region with the current status or error. Always rendered (a
 * live region must exist before its text changes).
 */
export const OtpFormMessage = ({
  children,
  ...rest
}: OtpFormMessageProps): ReactElement => {
  const context = useOtpFormContext();
  return h(
    "p",
    { ...props(context.parts.message), ...rest },
    children === undefined
      ? context.parts.text.message
      : renderChildren(children, context),
  );
};

type SegmentsProps = {
  group: OtpAttrs;
  segments: readonly OtpAttrs[];
  value: string;
  length: number;
  handlers: OtpCodeInputHandlers;
  groupRef: { current: HTMLDivElement | null };
  rest: HTMLAttributes<HTMLDivElement>;
  hidden?: ReactNode;
};

/**
 * The segments are uncontrolled for React (the shared handlers write the
 * DOM value, a layout effect syncs it after renders): a controlled input
 * would be reset by React in the middle of an IME composition.
 */
const Segments = ({
  group,
  segments,
  value,
  length,
  handlers,
  groupRef,
  rest,
  hidden,
}: SegmentsProps): ReactElement => {
  const digits = otpCodeSegments(value, length);
  // After every render: the DOM shows `value`, unless an IME is composing.
  useClientLayoutEffect(() => handlers.sync());
  return h(
    "div",
    {
      ...props(group),
      ...rest,
      ref: (element: HTMLDivElement | null) => {
        groupRef.current = element;
      },
    },
    segments.map((attrs, index) =>
      h("input", {
        ...props(attrs),
        key: index,
        defaultValue: digits[index] ?? "",
        onChange: (event: ChangeEvent<HTMLInputElement>) =>
          handlers.input(index, event),
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) =>
          handlers.keydown(index, event),
        onPaste: (event: ClipboardEvent<HTMLInputElement>) =>
          handlers.paste(index, event),
        onFocus: (event: FocusEvent<HTMLInputElement>) =>
          handlers.focus(index, event),
        onCompositionStart: handlers.compositionstart,
        onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) =>
          handlers.compositionend(index, event),
      }),
    ),
    hidden,
  );
};

const renderSegments = (segmentsProps: SegmentsProps): ReactElement =>
  h(Segments, segmentsProps);

export type OtpFormCodeFieldRenderProps = OtpFormContextValue & {
  labelProps: LabelHTMLAttributes<HTMLLabelElement>;
  descriptionProps: HTMLAttributes<HTMLElement>;
  errorProps: HTMLAttributes<HTMLElement>;
  /** The segmented input, already wired. */
  input: ReactElement;
};

export type OtpFormCodeFieldProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> & {
  label?: ReactNode;
  /** Help text under the input; `null` hides it. */
  description?: ReactNode;
  children?: (props: OtpFormCodeFieldRenderProps) => ReactNode;
};

/** Label + segmented code input + description/error of the form. */
export const OtpFormCodeField = ({
  label,
  description,
  children,
  ...rest
}: OtpFormCodeFieldProps): ReactElement => {
  const context = useOtpFormContext();
  const { form, parts } = context;
  const groupRef = useRef<HTMLDivElement | null>(null);
  const [handlers] = useState(() =>
    createOtpCodeInputHandlers({
      getValue: () => form.getState().code,
      getLength: () => form.getState().codeLength,
      isReadOnly: () => form.getState().phase !== "code",
      onChange: form.setCode,
      getContainer: () => groupRef.current,
    }),
  );
  const input = renderSegments({
    group: parts.codeInput,
    segments: parts.codeSegments,
    value: context.state.code,
    length: context.state.codeLength,
    handlers,
    groupRef,
    rest: {},
  });
  const labelProps = props(parts.codeLabel);
  const descriptionProps = props(parts.codeDescription);
  const errorProps = props(parts.codeError);
  const field = props(parts.codeField);
  if (children) {
    return h(
      "div",
      { ...field, ...rest },
      children({ ...context, labelProps, descriptionProps, errorProps, input }),
    );
  }
  return h(
    "div",
    { ...field, ...rest },
    h("label", labelProps, label ?? parts.text.codeLabel),
    input,
    description === null
      ? null
      : h("p", descriptionProps, description ?? parts.text.codeDescription),
    parts.text.codeError ? h("p", errorProps, parts.text.codeError) : null,
  );
};

export type OtpCodeInputProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "onChange" | "defaultValue" | "id"
> & {
  /** Controlled value (digits). */
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  /** Called once every digit is entered. */
  onComplete?: ((value: string) => void) | undefined;
  /** Number of digits. Default 6. */
  length?: number | undefined;
  readOnly?: boolean | undefined;
  invalid?: boolean | undefined;
  /** Group id; segment `i` gets `<id>-<i>`. Defaults to `useId()`. */
  id?: string | undefined;
  /** Focus the first empty segment on mount. */
  autoFocus?: boolean | undefined;
  /** Fill the code from the SMS with WebOTP when supported. */
  webOtp?: boolean | undefined;
  /** Renders a hidden input with this name and the value, for form posts. */
  name?: string | undefined;
  /** `ko` (default), `en` or `"auto"` (see `OtpFormRoot`). */
  locale?: OtpLocaleOption | undefined;
  messages?: OtpMessageOverrides | undefined;
};

/**
 * A standalone segmented one-time-code input (`autocomplete="one-time-code"`,
 * `inputmode="numeric"`, paste across segments, Backspace/arrow navigation,
 * optional WebOTP). Controlled (`value` + `onValueChange`) or uncontrolled.
 */
export const OtpCodeInput = ({
  value: valueProp,
  defaultValue,
  onValueChange,
  onComplete,
  length: lengthProp,
  readOnly,
  invalid,
  id: idProp,
  autoFocus,
  webOtp,
  name,
  locale,
  messages,
  ...rest
}: OtpCodeInputProps): ReactElement => {
  const length = lengthProp ?? DEFAULT_OTP_CODE_LENGTH;
  const [inner, setInner] = useState(() =>
    sanitizeOtpCode(defaultValue ?? "", length),
  );
  const value = valueProp === undefined ? inner : valueProp;
  const id = useStableId(idProp, "k-otp-code");
  const groupRef = useRef<HTMLDivElement | null>(null);
  const controlled = valueProp !== undefined;
  const latest = useRef({
    value,
    controlled,
    length,
    readOnly,
    onValueChange,
    onComplete,
  });
  latest.current = {
    value,
    controlled,
    length,
    readOnly,
    onValueChange,
    onComplete,
  };
  // Re-renders a controlled input whose parent may reject the change: the
  // segments then show the parent's value again (as a controlled input).
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [handlers] = useState(() => {
    const change = (next: string): void => {
      const current = latest.current;
      // Read by the handlers until the next render, which restores the
      // parent's value when it rejected the change.
      current.value = next;
      if (current.controlled) rerender();
      else setInner(next);
      current.onValueChange?.(next);
      if (isOtpCodeComplete(next, current.length)) current.onComplete?.(next);
    };
    return {
      change,
      dom: createOtpCodeInputHandlers({
        getValue: () => latest.current.value,
        getLength: () => latest.current.length,
        isReadOnly: () => latest.current.readOnly === true,
        onChange: change,
        getContainer: () => groupRef.current,
      }),
    };
  });
  const effectiveLocale = useOtpLocale(locale);
  const t = useMemo(
    () => createOtpTranslator({ locale: effectiveLocale, messages }),
    [effectiveLocale, messages],
  );
  const parts = getOtpCodeInputParts({
    id,
    value,
    length,
    readOnly,
    invalid,
    labelledBy: rest["aria-labelledby"],
    describedBy: rest["aria-describedby"],
    t,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: on mount only.
  useEffect(() => {
    if (autoFocus) {
      focusOtpCodeSegment(
        groupRef.current,
        Math.min(latest.current.value.length, latest.current.length - 1),
      );
    }
  }, []);
  useEffect(() => {
    if (!webOtp) return;
    const controller = new AbortController();
    void receiveWebOtp({ signal: controller.signal, length }).then((code) => {
      if (code && !controller.signal.aborted) handlers.change(code);
    });
    return () => controller.abort();
  }, [webOtp, length, handlers]);
  return renderSegments({
    group: parts.group,
    segments: parts.segments,
    value,
    length,
    handlers: handlers.dom,
    groupRef,
    rest,
    hidden: name ? h("input", { type: "hidden", name, value }) : undefined,
  });
};

export type OtpFormProps = Omit<OtpFormRootProps, "children"> & {
  /** Rendered between the fields and the message (e.g. terms). */
  children?: ReactNode;
};

const PresetBody = ({ children }: { children?: ReactNode }): ReactElement => {
  const { state } = useOtpFormContext();
  // Once verified, only the fields and the result stay.
  const active = state.phase !== "verified";
  return h(
    Fragment,
    null,
    h(OtpFormPhoneField),
    state.issued ? h(OtpFormCodeField) : null,
    active && state.issued ? h(OtpFormCountdown) : null,
    active && state.issued ? h(OtpFormVerifyButton) : null,
    active ? h(OtpFormSendButton) : null,
    active && state.issued ? h(OtpFormEditPhoneButton) : null,
    children,
    h(OtpFormMessage),
  );
};

/**
 * The ready-made form: phone field, send button, code field with countdown,
 * verify, change number and a status message, with default copy.
 */
const OtpFormPreset = ({ children, ...rest }: OtpFormProps): ReactElement =>
  h(OtpFormRoot, rest, h(PresetBody, null, children));

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
