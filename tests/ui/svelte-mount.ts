/** Mounts a Svelte 4 or 5 component in the DOM (client runtime). */
import * as svelte from "svelte";

type Instance = { destroy: () => void };

export const mountSvelte = (
  Component: unknown,
  props: Record<string, unknown> = {},
  options: { target?: HTMLElement; hydrate?: boolean } = {},
): Instance => {
  const target = options.target ?? document.createElement("div");
  if (!target.isConnected) document.body.append(target);
  const api = svelte as unknown as {
    mount?: (component: unknown, options: unknown) => unknown;
    hydrate?: (component: unknown, options: unknown) => unknown;
    unmount?: (instance: unknown) => void;
  };
  if (typeof api.mount === "function" && api.hydrate && api.unmount) {
    const instance = (options.hydrate ? api.hydrate : api.mount)(Component, {
      target,
      props,
    });
    return {
      destroy: () => {
        api.unmount?.(instance);
        target.remove();
      },
    };
  }
  const Ctor = Component as new (options: unknown) => { $destroy: () => void };
  const instance = new Ctor({ target, props, hydrate: options.hydrate });
  return {
    destroy: () => {
      instance.$destroy();
      target.remove();
    },
  };
};
