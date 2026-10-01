import { OtpProvider } from "@k-otp/sdk/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { mockFetch } from "./mock-fetch";

const apiKey = import.meta.env.VITE_K_OTP_PUBLIC_KEY?.trim();
const baseUrl = import.meta.env.VITE_K_OTP_BASE_URL?.trim() || undefined;

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

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
);
