import { createOtpPlugin } from "@k-otp/sdk/vue";
import { createApp } from "vue";
import App from "./App.vue";
import { mockFetch } from "./mock-fetch";

const apiKey = import.meta.env.VITE_K_OTP_PUBLIC_KEY?.trim();
const baseUrl = import.meta.env.VITE_K_OTP_BASE_URL?.trim() || undefined;

createApp(App, { mock: !apiKey })
  .use(
    createOtpPlugin(
      apiKey
        ? { apiKey, baseUrl }
        : // No key configured: talk to the in-browser mock API.
          { apiKey: "pk_mock", fetch: mockFetch },
    ),
  )
  .mount("#app");
