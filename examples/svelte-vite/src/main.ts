import { mount } from "svelte";
import App from "./App.svelte";
import { variant } from "./options";
import "./page.css";

const target = document.getElementById("app");
if (!target) throw new Error("#app not found");

// The preset uses the optional default theme; the headless variant is
// styled by ./custom.css only.
// (Two separate import() statements: one conditional expression with two
// CSS imports is preloaded as one by Vite 8.)
const loadStyles = async (): Promise<void> => {
  if (variant === "preset") await import("@k-otp/sdk/ui/theme.css");
  else await import("./custom.css");
};

void loadStyles().then(() => mount(App, { target }));
