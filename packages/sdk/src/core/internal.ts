/**
 * Transport building blocks shared with the server client (`src/server`), and
 * the client resolver shared by the framework adapters (`src/react|vue|svelte`).
 * (The adapters' flow/operation state is public: `@k-otp/sdk/headless`.)
 * This module is only imported relatively inside `@k-otp/sdk` and is not a
 * package export.
 */
export { toOtpClient } from "./client-source";
export { issueWith, verifyWith } from "./operations";
export {
  createOtpTransport,
  mergeHeaders,
  type OtpCallOptions,
  type OtpTransport,
  type OtpTransportInternalOptions,
  resolveApiKey,
  resolveBaseUrl,
} from "./transport";
