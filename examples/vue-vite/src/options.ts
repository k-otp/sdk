/** Example page options from the query string: `?variant=headless&lang=en`. */
const params = new URLSearchParams(window.location.search);

export const variant: "preset" | "headless" =
  params.get("variant") === "headless" ? "headless" : "preset";
export const locale: "ko" | "en" = params.get("lang") === "en" ? "en" : "ko";

/** Link to the same page with other options. */
export const href = (next: { variant?: string; lang?: string }): string => {
  const query = new URLSearchParams({
    variant: next.variant ?? variant,
    lang: next.lang ?? locale,
  });
  return `?${query}`;
};
