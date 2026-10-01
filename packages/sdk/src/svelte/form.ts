/** Handles a submitted form's data (e.g. calls `flow.send` or `flow.verify`). */
export type OtpFormHandler = (data: FormData, form: HTMLFormElement) => unknown;

export type OtpFormActionReturn = {
  update: (handler: OtpFormHandler) => void;
  destroy: () => void;
};

/**
 * Svelte action wiring a `<form>` to an OTP call:
 * `<form use:otpForm={(data) => flow.verify(String(data.get("code")))}>`.
 *
 * It prevents the native submit, passes the form's `FormData` to the
 * handler, ignores re-submits while the handler's promise is pending and sets
 * `aria-busy="true"` on the form meanwhile. Works with Svelte 4 and 5.
 */
export const otpForm = (
  node: HTMLFormElement,
  handler: OtpFormHandler,
): OtpFormActionReturn => {
  let current = handler;
  let pending = false;

  const onSubmit = (event: Event): void => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    node.setAttribute("aria-busy", "true");
    const done = (): void => {
      pending = false;
      node.removeAttribute("aria-busy");
    };
    let result: unknown;
    try {
      result = current(new FormData(node), node);
    } catch (error) {
      done();
      throw error;
    }
    // A rejected handler stays an unhandled rejection (the SDK itself never
    // rejects with API errors); only the busy state is cleaned up here.
    void Promise.resolve(result).finally(done);
  };

  node.addEventListener("submit", onSubmit);
  return {
    update: (next) => {
      current = next;
    },
    destroy: () => node.removeEventListener("submit", onSubmit),
  };
};
