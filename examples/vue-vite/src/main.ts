import { createOtpPlugin } from "@k-otp/sdk/vue";
import { createApp } from "vue";
import App from "./App.vue";
import { mockFetch } from "./mock-fetch";
import { variant } from "./options";
import "./page.css";

const apiKey = import.meta.env.VITE_K_OTP_PUBLIC_KEY?.trim();
const baseUrl = import.meta.env.VITE_K_OTP_BASE_URL?.trim() || undefined;

// The preset uses the optional default theme; the headless variant is
// styled by ./custom.css only.
// (Two separate import() statements: one conditional expression with two
// CSS imports is preloaded as one by Vite 8.)
const loadStyles = async (): Promise<void> => {
  if (variant === "preset") await import("@k-otp/sdk/ui/theme.css");
  else await import("./custom.css");
};

void loadStyles().then(() =>
  createApp(App, { mock: !apiKey })
    .use(
      createOtpPlugin(
        apiKey
          ? { apiKey, baseUrl }
          : // No key configured: talk to the in-browser mock API.
            { apiKey: "pk_mock", fetch: mockFetch },
      ),
    )
    .mount("#app"),
);
