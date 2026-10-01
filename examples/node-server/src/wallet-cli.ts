import { createOtpServerClient } from "@k-otp/sdk-server";
import { mockFetch } from "./mock-fetch.ts";
import { readWallet } from "./wallet.ts";

const apiKey = process.env.K_OTP_SECRET_KEY?.trim();
const baseUrl = process.env.K_OTP_BASE_URL?.trim() || undefined;

const otp = apiKey
  ? createOtpServerClient({ apiKey, baseUrl })
  : createOtpServerClient({ apiKey: "sk_mock", fetch: mockFetch });

console.log(await readWallet(otp));
