import { createServer } from "node:http";
import { createOtpServerClient } from "@k-otp/sdk-server";
import { createHandler } from "./app.ts";
import { mockFetch } from "./mock-fetch.ts";

// `bun run start` loads .env (node --env-file-if-exists) when present.
const apiKey = process.env.K_OTP_SECRET_KEY?.trim();
const baseUrl = process.env.K_OTP_BASE_URL?.trim() || undefined;
const port = Number(process.env.PORT ?? 3000);

// The sk_ key is only ever used here, on the server.
const otp = apiKey
  ? createOtpServerClient({ apiKey, baseUrl })
  : createOtpServerClient({ apiKey: "sk_mock", fetch: mockFetch });

createServer(createHandler(otp)).listen(port, () => {
  console.log(
    `K-OTP example on http://localhost:${port}${apiKey ? "" : " (mock API, code 123456)"}`,
  );
});
