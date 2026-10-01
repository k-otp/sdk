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
  /**
   * Accessible name of the group when it has no `labelledBy` (defaults to
   * the `code.label` message).
   */
  label?: string | undefined;
  describedBy?: string | undefined;
  t: OtpTranslator;
};

/**
 * The segment that is in the tab order (roving tabindex): the first empty
 * one, or the last when the code is complete. The group is a single tab stop;
 * arrow keys move between segments.
 */
export const otpCodeTabIndex = (value: string, length: number): number =>
  otpCodeFocusIndex(value, length, length);

/** Attributes of a segmented code input: the group and each segment. */
export const getOtpCodeInputParts = (
  options: OtpCodeInputPartsOptions,
): { group: OtpAttrs; segments: OtpAttrs[] } => {
  const { id, value, length, t } = options;
  const segments = otpCodeSegments(value, length);
  const complete = segments.every(Boolean);
  const tabbable = otpCodeTabIndex(value, length);
  return {
    group: {
      "data-k-otp": "code-input",
      "data-state": options.state ?? (complete ? "filled" : "empty"),
      "data-invalid": flag(options.invalid === true),
      "data-disabled": flag(options.readOnly === true),
      id,
      role: "group",
      "aria-labelledby": options.labelledBy,
      "aria-label": options.labelledBy
        ? undefined
        : (options.label ?? t("code.label")),
      // Described once, on the group (not again on a segment).
      "aria-describedby": options.describedBy,
      // Codes are digits read left to right, whatever the page direction.
      dir: "ltr",
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
      tabindex: index === tabbable ? 0 : -1,
      "aria-label": t("code.segment", { index: index + 1, length }),
      "aria-invalid": options.invalid ? "true" : undefined,
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
  if (state.resendIn > 0) {
    // Before any code reached this number (e.g. after "change number"),
    // "resend" would be wrong.
    return state.issued ? ("send.resendIn" as const) : ("send.sendIn" as const);
  }
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
  /** `InputEvent.isComposing` (React: `event.nativeEvent.isComposing`). */
  isComposing?: boolean;
  nativeEvent?: object;
};
type KeyLike = {
  key: string;
  /** `KeyboardEvent.isComposing` (React: `event.nativeEvent.isComposing`). */
  isComposing?: boolean;
  nativeEvent?: object;
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
  /** `blur` event of a segment (ends a composition left open). */
  blur: () => void;
  /** `compositionstart` event (IME): input is ignored until it ends. */
  compositionstart: () => void;
  /** `compositionend` event of segment `index`: applies the composed text. */
  compositionend: (index: number, event: InputLike) => void;
  /** `true` while an IME composition is in progress. */
  isComposing: () => boolean;
  /**
   * Writes the current value into the segments (call after each render).
   * Skipped while composing, so a re-render (e.g. the countdown tick) never
   * cancels an IME composition. The segments are uncontrolled for that
   * reason: frameworks render no `value`, only call this.
   */
  sync: (container?: ParentNode | null) => void;
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
  let composing = false;
  const commit = (value: string, focus: number): void => {
    if (value !== options.getValue()) options.onChange(value);
    focusOtpCodeSegment(options.getContainer(), focus);
  };
  /** The roving tabindex the frameworks render (see `otpCodeTabIndex`). */
  const restoreTabIndex = (): void => {
    const segments = segmentsOf(options.getContainer());
    const tabbable = otpCodeTabIndex(options.getValue(), options.getLength());
    segments.forEach((segment, i) => {
      segment.setAttribute("tabindex", i === tabbable ? "0" : "-1");
    });
  };
  /**
   * Tab / Shift+Tab leave the group from any segment: every segment is taken
   * out of the tab order until the browser has moved focus.
   */
  const leaveGroup = (): void => {
    const container = options.getContainer();
    for (const segment of segmentsOf(container)) {
      segment.setAttribute("tabindex", "-1");
    }
    // The browser picks the next element before it fires `focusout`, so the
    // tabindex can come back right then; the timer covers a Tab that moves
    // nowhere (e.g. prevented by the app).
    (container as Element | null | undefined)?.addEventListener?.(
      "focusout",
      restoreTabIndex,
      { once: true },
    );
    setTimeout(restoreTabIndex, 0);
  };
  /**
   * The segment and text applied by the latest `compositionend`: WebKit
   * fires it before the composition's final `input`, which must not apply
   * the same text again (and pull the focus back).
   */
  let composed: { index: number } | undefined;
  const apply = (index: number, element: HTMLInputElement): void => {
    const value = options.getValue();
    if (options.isReadOnly()) {
      element.value = value[index] ?? "";
      return;
    }
    const change = applyOtpCodeInput(
      value,
      index,
      element.value,
      options.getLength(),
    );
    element.value = change.value[index] ?? "";
    commit(change.value, change.focus);
  };
  /** A `sync()` was skipped while composing: replayed when it ends. */
  let syncPending = false;
  const sync = (container?: ParentNode | null): void => {
    if (composing) {
      syncPending = true;
      return;
    }
    syncPending = false;
    const value = options.getValue();
    segmentsOf(container ?? options.getContainer()).forEach(
      (segment, index) => {
        const input = segment as HTMLInputElement;
        const digit = value[index] ?? "";
        if (input.value !== digit) input.value = digit;
      },
    );
  };
  /** Ends a composition and reconciles the DOM with the current value. */
  const endComposition = (): void => {
    composing = false;
    if (syncPending) sync();
  };
  return {
    input: (index, event) => {
      const native = event.nativeEvent as { isComposing?: boolean } | undefined;
      const flag = event.isComposing ?? native?.isComposing;
      // An IME is composing (full-width digits, Android keyboards): wait for
      // `compositionend`, or the composed text would be applied twice. The
      // event is trusted over our flag, which a missing `compositionend`
      // (cancelled composition, removed element) could leave stuck.
      if (flag === true || (flag === undefined && composing)) {
        composing = true;
        return;
      }
      composing = false;
      const element = elementOf(event);
      const last = composed;
      composed = undefined;
      if (
        element &&
        !(
          last?.index === index &&
          element.value === (options.getValue()[index] ?? "")
        )
      ) {
        // (Skipped: the trailing input of a composition already applied.)
        apply(index, element);
      }
      // After applying the typed text, never before (it would be lost).
      if (syncPending) sync();
    },
    blur: endComposition,
    compositionstart: () => {
      composing = true;
      composed = undefined;
    },
    compositionend: (index, event) => {
      composing = false;
      const element = elementOf(event);
      if (element) {
        composed = { index };
        apply(index, element);
      }
      // The code may have changed while composing (WebOTP, reset, a
      // controlled parent) without any render after this point.
      if (syncPending) sync();
    },
    isComposing: () => composing,
    sync,
    keydown: (index, event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Tab") {
        leaveGroup();
        return;
      }
      const native = event.nativeEvent as { isComposing?: boolean } | undefined;
      const keyComposing = event.isComposing ?? native?.isComposing;
      if (keyComposing === true || event.key === "Process") return;
      // A key outside any composition ends a composition left open.
      if (keyComposing === false) endComposition();
      if (composing) return;
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
      // Segments after the first empty one are not in the tab order, so this
      // only redirects a pointer focus (no gaps in the code).
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
