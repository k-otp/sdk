/**
 * Attributes and DOM wiring shared by the React, Vue and Svelte components,
 * so that every framework renders the same `data-*` / ARIA state for the same
 * form state (enforced by the UI parity tests).
 *
 * Attribute names are the DOM ones (`for`, `readonly`, `inputmode`,
 * `tabindex`); the React adapter maps them to React prop names. Boolean
 * `data-*` attributes are `""` when set and `undefined` (omitted) otherwise.
 *
 * The DOM helpers at the bottom only run from event handlers and effects,
 * never at import time.
 */
import {
  applyOtpCodeInput,
  applyOtpCodeKey,
  applyOtpCodePaste,
  otpCodeFocusIndex,
  otpCodeSegments,
} from "./code";
import { formatOtpCountdown } from "./countdown";
import type { OtpFormFocusTarget, OtpFormState } from "./form";
import type { OtpTranslator } from "./messages";

export type OtpAttrValue = string | number | boolean | undefined;
/** Attributes of one element (DOM attribute names). */
export type OtpAttrs = Readonly<Record<string, OtpAttrValue>>;

/** Every `data-k-otp` part name. */
export type OtpPartName =
  | "root"
  | "phone-field"
  | "phone-label"
  | "phone-input"
  | "phone-description"
  | "phone-error"
  | "send-button"
  | "code-field"
  | "code-label"
  | "code-input"
  | "code-segment"
  | "code-description"
  | "code-error"
  | "verify-button"
  | "countdown"
  | "message"
  | "edit-phone";

const flag = (on: boolean): "" | undefined => (on ? "" : undefined);
const ids = (...values: (string | false | undefined)[]): string | undefined =>
  values.filter(Boolean).join(" ") || undefined;

export type OtpFormIds = {
  readonly root: string;
  readonly phoneInput: string;
  readonly phoneLabel: string;
  readonly phoneDescription: string;
  readonly phoneError: string;
  readonly codeInput: string;
  readonly codeLabel: string;
  readonly codeDescription: string;
  readonly codeError: string;
  readonly countdown: string;
  readonly message: string;
};

/** Element ids derived from the root id (`<id>-phone`, `<id>-code-0`, ...). */
export const otpFormIds = (id: string): OtpFormIds => ({
  root: id,
  phoneInput: `${id}-phone`,
  phoneLabel: `${id}-phone-label`,
  phoneDescription: `${id}-phone-description`,
  phoneError: `${id}-phone-error`,
  codeInput: `${id}-code`,
  codeLabel: `${id}-code-label`,
  codeDescription: `${id}-code-description`,
  codeError: `${id}-code-error`,
  countdown: `${id}-countdown`,
  message: `${id}-message`,
});

/** Id of segment `index` of a code input whose id is `id`. */
export const otpCodeSegmentId = (id: string, index: number): string =>
  `${id}-${index}`;

export type OtpCodeInputPartsOptions = {
  /** Id prefix: the group gets `id`, segment `i` gets `<id>-<i>`. */
  id: string;
  value: string;
  length: number;
  /** Not editable (segments are `readonly`, focus still works). */
  readOnly?: boolean | undefined;
  invalid?: boolean | undefined;
  /** `data-state` of the group (the form phase, or `filled`/`empty`). */
  state?: string | undefined;
  labelledBy?: string | undefined;
  describedBy?: string | undefined;
  t: OtpTranslator;
};

/** Attributes of a segmented code input: the group and each segment. */
export const getOtpCodeInputParts = (
  options: OtpCodeInputPartsOptions,
): { group: OtpAttrs; segments: OtpAttrs[] } => {
  const { id, value, length, t } = options;
  const segments = otpCodeSegments(value, length);
  const complete = segments.every(Boolean);
  return {
    group: {
      "data-k-otp": "code-input",
      "data-state": options.state ?? (complete ? "filled" : "empty"),
      "data-invalid": flag(options.invalid === true),
      "data-disabled": flag(options.readOnly === true),
      id,
      role: "group",
      "aria-labelledby": options.labelledBy,
      "aria-describedby": options.describedBy,
    },
    segments: segments.map((digit, index) => ({
      "data-k-otp": "code-segment",
      "data-state": digit ? "filled" : "empty",
      "data-invalid": flag(options.invalid === true),
      "data-disabled": flag(options.readOnly === true),
      "data-index": index,
      id: otpCodeSegmentId(id, index),
      type: "text",
      inputmode: "numeric",
      pattern: "[0-9]*",
      // The OS offers the SMS code on the first segment; the handlers spread
      // a multi-digit autofill across the segments.
      autocomplete: index === 0 ? "one-time-code" : "off",
      autocapitalize: "off",
      spellcheck: "false",
      readonly: options.readOnly === true,
      "aria-label": t("code.segment", { index: index + 1, length }),
      "aria-invalid": options.invalid ? "true" : undefined,
      "aria-describedby": index === 0 ? options.describedBy : undefined,
    })),
  };
};

/** Attributes of every part of the form, plus its translated copy. */
export type OtpFormParts = {
  readonly ids: OtpFormIds;
  readonly root: OtpAttrs;
  readonly phoneField: OtpAttrs;
  readonly phoneLabel: OtpAttrs;
  readonly phoneInput: OtpAttrs;
  readonly phoneDescription: OtpAttrs;
  readonly phoneError: OtpAttrs;
  readonly sendButton: OtpAttrs;
  readonly codeField: OtpAttrs;
  readonly codeLabel: OtpAttrs;
  readonly codeInput: OtpAttrs;
  readonly codeSegments: readonly OtpAttrs[];
  readonly codeDescription: OtpAttrs;
  readonly codeError: OtpAttrs;
  readonly verifyButton: OtpAttrs;
  readonly countdown: OtpAttrs;
  readonly message: OtpAttrs;
  readonly editPhone: OtpAttrs;
  /** Translated copy for each part (`undefined` when there is nothing). */
  readonly text: {
    readonly phoneLabel: string;
    readonly phonePlaceholder: string;
    readonly phoneDescription: string;
    readonly phoneError: string | undefined;
    readonly sendButton: string;
    readonly codeLabel: string;
    readonly codeDescription: string;
    readonly codeError: string | undefined;
    readonly verifyButton: string;
    readonly countdown: string | undefined;
    readonly message: string | undefined;
    readonly editPhone: string;
  };
};

const sendLabelKey = (state: OtpFormState) => {
  if (state.phase === "sending") return "send.sending" as const;
  if (state.resendIn > 0) return "send.resendIn" as const;
  if (state.retryPending) return "send.retry" as const;
  return state.issued ? ("send.resend" as const) : ("send.idle" as const);
};

const buttonState = (loading: boolean, cooling: boolean): string => {
  if (loading) return "loading";
  return cooling ? "cooldown" : "idle";
};

/**
 * Attributes and copy of every form part for `state`. `id` is the root id
 * (`otpFormIds`), `t` the translator (`createOtpTranslator`).
 */
export const getOtpFormParts = (
  state: OtpFormState,
  options: { id: string; t: OtpTranslator },
): OtpFormParts => {
  const { t } = options;
  const id = otpFormIds(options.id);
  const { phase } = state;
  const phoneInvalid = state.phoneError !== undefined;
  const codeInvalid =
    state.codeError !== undefined || state.reasonCode === "MISMATCH";
  const codeReadOnly = phase !== "code";
  const code = getOtpCodeInputParts({
    id: id.codeInput,
    value: state.code,
    length: state.codeLength,
    readOnly: codeReadOnly,
    invalid: codeInvalid,
    state: phase,
    labelledBy: id.codeLabel,
    describedBy: ids(
      id.codeDescription,
      state.codeError && id.codeError,
      state.expiresIn !== undefined && id.countdown,
    ),
    t,
  });
  const countdownState =
    state.expiresIn === undefined
      ? "idle"
      : state.expired
        ? "expired"
        : "running";
  const message = state.message;
  return {
    ids: id,
    root: {
      "data-k-otp": "root",
      "data-state": phase,
      "data-busy": flag(state.isLoading),
      // A code was sent: the code step is shown, "send" means "resend".
      "data-issued": flag(state.issued),
      id: id.root,
      "aria-busy": state.isLoading ? "true" : undefined,
      novalidate: true,
    },
    phoneField: {
      "data-k-otp": "phone-field",
      "data-state": phase,
      "data-invalid": flag(phoneInvalid),
      "data-disabled": flag(state.phoneLocked),
    },
    phoneLabel: {
      "data-k-otp": "phone-label",
      id: id.phoneLabel,
      for: id.phoneInput,
    },
    phoneInput: {
      "data-k-otp": "phone-input",
      "data-state": phase,
      "data-invalid": flag(phoneInvalid),
      "data-disabled": flag(state.phoneLocked),
      id: id.phoneInput,
      name: "phoneNumber",
      type: "tel",
      inputmode: "tel",
      autocomplete: "tel",
      enterkeyhint: "send",
      required: true,
      readonly: state.phoneLocked,
      "aria-invalid": phoneInvalid ? "true" : undefined,
      "aria-describedby": ids(
        id.phoneDescription,
        phoneInvalid && id.phoneError,
      ),
    },
    phoneDescription: {
      "data-k-otp": "phone-description",
      id: id.phoneDescription,
    },
    phoneError: {
      "data-k-otp": "phone-error",
      id: id.phoneError,
    },
    sendButton: {
      "data-k-otp": "send-button",
      "data-state": buttonState(phase === "sending", state.resendIn > 0),
      "data-disabled": flag(state.sendDisabled),
      // Enter in the phone input sends; in the code step it verifies.
      type: phase === "phone" || phase === "failed" ? "submit" : "button",
      // aria-disabled (not `disabled`) keeps focus on the button while
      // a request is in flight or the cooldown runs.
      "aria-disabled": state.sendDisabled ? "true" : undefined,
    },
    codeField: {
      "data-k-otp": "code-field",
      "data-state": phase,
      "data-invalid": flag(codeInvalid),
      "data-disabled": flag(codeReadOnly),
    },
    codeLabel: {
      "data-k-otp": "code-label",
      id: id.codeLabel,
      for: otpCodeSegmentId(id.codeInput, 0),
    },
    codeInput: code.group,
    codeSegments: code.segments,
    codeDescription: {
      "data-k-otp": "code-description",
      id: id.codeDescription,
    },
    codeError: { "data-k-otp": "code-error", id: id.codeError },
    verifyButton: {
      "data-k-otp": "verify-button",
      "data-state": buttonState(phase === "verifying", state.retryIn > 0),
      "data-disabled": flag(state.verifyDisabled),
      type: phase === "code" ? "submit" : "button",
      "aria-disabled": state.verifyDisabled ? "true" : undefined,
    },
    countdown: {
      "data-k-otp": "countdown",
      "data-state": countdownState,
      id: id.countdown,
      role: "timer",
      "aria-live": "off",
      "aria-atomic": "true",
    },
    message: {
      "data-k-otp": "message",
      "data-state": message?.tone ?? "idle",
      "data-empty": flag(message === undefined),
      id: id.message,
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
      // Focus target after verify (screen readers re-read the result).
      tabindex: -1,
    },
    editPhone: {
      "data-k-otp": "edit-phone",
      "data-state": phase,
      type: "button",
    },
    text: {
      phoneLabel: t("phone.label"),
      phonePlaceholder: t("phone.placeholder"),
      phoneDescription: t("phone.description"),
      phoneError: state.phoneError && t(state.phoneError),
      sendButton: t(sendLabelKey(state), {
        time: formatOtpCountdown(state.resendIn * 1000),
      }),
      codeLabel: t("code.label"),
      codeDescription: t("code.description", { length: state.codeLength }),
      codeError:
        state.codeError && t(state.codeError, { length: state.codeLength }),
      verifyButton:
        phase === "verifying"
          ? t("verify.verifying")
          : state.retryIn > 0
            ? t("verify.retryIn", {
                time: formatOtpCountdown(state.retryIn * 1000),
              })
            : t("verify.idle"),
      countdown:
        state.expiresIn === undefined
          ? undefined
          : state.expired
            ? t("countdown.expired")
            : t("countdown.expiresIn", {
                time: formatOtpCountdown(state.expiresIn * 1000),
              }),
      message: message && t(message.key, message.params),
      editPhone: t("editPhone"),
    },
  };
};

// --- DOM helpers (called from handlers and effects only) -------------------

type FocusableInput = HTMLElement & { select?: () => void };

const segmentsOf = (container: ParentNode | null | undefined) =>
  container
    ? Array.from(
        container.querySelectorAll<FocusableInput>(
          '[data-k-otp="code-segment"]',
        ),
      )
    : [];

/** Focuses (and selects) segment `index` inside `container`. */
export const focusOtpCodeSegment = (
  container: ParentNode | null | undefined,
  index: number,
): void => {
  const segment = segmentsOf(container)[index];
  if (!segment) return;
  segment.focus();
  segment.select?.();
};

/**
 * Applies a focus request of the form (`state.focus`) inside its root
 * element: the phone input, the first empty code segment, or the message.
 */
export const focusOtpFormTarget = (
  root: ParentNode | null | undefined,
  target: OtpFormFocusTarget,
  state: Pick<OtpFormState, "code" | "codeLength">,
): void => {
  if (!root) return;
  if (target === "code") {
    focusOtpCodeSegment(
      root,
      otpCodeFocusIndex(state.code, state.codeLength, state.codeLength),
    );
    return;
  }
  const selector =
    target === "phone"
      ? '[data-k-otp="phone-input"]'
      : '[data-k-otp="message"]';
  root.querySelector<HTMLElement>(selector)?.focus();
};

/** The parts of DOM events the code input handlers read. */
type InputLike = {
  currentTarget: EventTarget | null;
  target: EventTarget | null;
};
type KeyLike = {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  preventDefault: () => void;
};
type PasteLike = {
  clipboardData?: { getData: (format: string) => string } | null;
  preventDefault: () => void;
};

export type OtpCodeInputHandlers = {
  /** `input` event of segment `index`. */
  input: (index: number, event: InputLike) => void;
  /** `keydown` event of segment `index`. */
  keydown: (index: number, event: KeyLike) => void;
  /** `paste` event of segment `index`. */
  paste: (index: number, event: PasteLike) => void;
  /** `focus` event of segment `index` (redirects to the first empty one). */
  focus: (index: number, event: InputLike) => void;
};

export type OtpCodeInputHandlerOptions = {
  getValue: () => string;
  getLength: () => number;
  isReadOnly: () => boolean;
  /** Called with the new value (only when it changed). */
  onChange: (value: string) => void;
  /** The element containing the segments (the group). */
  getContainer: () => ParentNode | null | undefined;
};

const elementOf = (event: InputLike): HTMLInputElement | undefined => {
  const element = (event.currentTarget ??
    event.target) as HTMLInputElement | null;
  return element && typeof element.value === "string" ? element : undefined;
};

/**
 * Event handlers of a segmented code input (typing, autofill, paste,
 * Backspace/Delete/arrows/Home/End, focus redirection). Each framework binds
 * them to its segments; they keep the DOM value of the edited segment in sync
 * immediately, so a framework that skips re-rendering an unchanged value
 * never leaves two digits in one segment.
 */
export const createOtpCodeInputHandlers = (
  options: OtpCodeInputHandlerOptions,
): OtpCodeInputHandlers => {
  const commit = (value: string, focus: number): void => {
    if (value !== options.getValue()) options.onChange(value);
    focusOtpCodeSegment(options.getContainer(), focus);
  };
  return {
    input: (index, event) => {
      const element = elementOf(event);
      if (!element) return;
      const value = options.getValue();
      const length = options.getLength();
      if (options.isReadOnly()) {
        element.value = value[index] ?? "";
        return;
      }
      const change = applyOtpCodeInput(value, index, element.value, length);
      element.value = change.value[index] ?? "";
      commit(change.value, change.focus);
    },
    keydown: (index, event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const value = options.getValue();
      const change = applyOtpCodeKey(
        value,
        index,
        event.key,
        options.getLength(),
      );
      if (!change) return;
      if (change.value !== value && options.isReadOnly()) return;
      event.preventDefault();
      commit(change.value, change.focus);
    },
    paste: (index, event) => {
      event.preventDefault();
      if (options.isReadOnly()) return;
      const text = event.clipboardData?.getData("text") ?? "";
      const change = applyOtpCodePaste(
        options.getValue(),
        index,
        text,
        options.getLength(),
      );
      commit(change.value, change.focus);
    },
    focus: (index, event) => {
      const target = otpCodeFocusIndex(
        options.getValue(),
        index,
        options.getLength(),
      );
      if (target !== index) {
        focusOtpCodeSegment(options.getContainer(), target);
        return;
      }
      elementOf(event)?.select();
    },
  };
};
