/** DOM queries shared by the UI component tests. */
import type { MockApi } from "./mock-api";

/** Every code segment, in order. */
export const segments = (): HTMLInputElement[] =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>('[data-k-otp="code-segment"]'),
  );

/** Code segment `index` (throws when missing). */
export const segment = (index: number): HTMLInputElement => {
  const element = segments()[index];
  if (!element) throw new Error(`no code segment ${index}`);
  return element;
};

/** The first element of a part (throws when missing). */
export const part = (name: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-k-otp="${name}"]`);
  if (!element) throw new Error(`no [data-k-otp="${name}"]`);
  return element;
};

/** `phoneNumber` sent by the `index`-th request. */
export const sentPhone = (api: MockApi, index = 0): string | undefined =>
  (api.calls[index]?.body as { phoneNumber?: string } | undefined)?.phoneNumber;
