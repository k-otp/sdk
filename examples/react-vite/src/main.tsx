import { OtpProvider } from "@k-otp/sdk/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { mockFetch } from "./mock-fetch";
import { variant } from "./options";
import "./page.css";

const apiKey = import.meta.env.VITE_K_OTP_PUBLIC_KEY?.trim();
const baseUrl = import.meta.env.VITE_K_OTP_BASE_URL?.trim() || undefined;

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// The preset uses the optional default theme; the headless variant is
// styled by ./custom.css only.
// (Two separate import() statements: one conditional expression with two
// CSS imports is preloaded as one by Vite 8.)
const loadStyles = async (): Promise<void> => {
  if (variant === "preset") await import("@k-otp/sdk/ui/theme.css");
  else await import("./custom.css");
};

void loadStyles().then(() =>
  createRoot(root).render(
    <StrictMode>
      <OtpProvider
        options={
          apiKey
            ? { apiKey, baseUrl }
            : // No key configured: talk to the in-browser mock API.
              { apiKey: "pk_mock", fetch: mockFetch }
        }
      >
        <App mock={!apiKey} />
      </OtpProvider>
    </StrictMode>,
  ),
);
