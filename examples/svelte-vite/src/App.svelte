<script lang="ts">
  import { createOtpStores, type OtpApiError, otpForm } from "@k-otp/sdk/svelte";
  import { onDestroy } from "svelte";
  import { mockFetch } from "./mock-fetch";

  const apiKey = import.meta.env.VITE_K_OTP_PUBLIC_KEY?.trim();
  const baseUrl = import.meta.env.VITE_K_OTP_BASE_URL?.trim() || undefined;
  const mock = !apiKey;

  // Stores are created per component instance: nothing is shared globally.
  const otp = createOtpStores(
    apiKey
      ? { apiKey, baseUrl }
      : // No key configured: talk to the in-browser mock API.
        { apiKey: "pk_mock", fetch: mockFetch },
  );
  const flow = otp.createFlow({ resendCooldownMs: 30_000, idempotencyKeyPrefix: "signup" });
  onDestroy(() => flow.abort());

  const describeError = (e: OtpApiError): string => {
    switch (e.code) {
      case "PAYMENT_REQUIRED":
        return "The service is temporarily unable to send codes. Please try again later.";
      case "TOO_MANY_REQUESTS":
        return `Too many attempts. Try again in ${Math.ceil((e.retryAfterMs ?? 0) / 1000)}s.`;
      case "FORBIDDEN":
        return "This page's origin is not allowed for the public key (check allowedOrigins).";
      case "TIMEOUT":
      case "NETWORK_ERROR":
      case "SERVICE_UNAVAILABLE":
      case "INTERNAL_SERVER_ERROR":
        return "We could not confirm the code was sent. Retrying is safe.";
      default:
        return "Something went wrong. Please try again.";
    }
  };

  const onSend = (data: FormData) =>
    flow.send({ phoneNumber: String(data.get("phoneNumber") ?? ""), purpose: "signup" });
  const onVerify = (data: FormData) => flow.verify(String(data.get("code") ?? ""));

  const seconds = $derived(Math.ceil($flow.cooldownRemainingMs / 1000));
  const sendLabel = $derived(
    $flow.issueState.isLoading
      ? "Sending..."
      : seconds > 0
        ? `Resend in ${seconds}s`
        : $flow.idempotencyKey
          ? "Retry"
          : $flow.issueId
            ? "Resend code"
            : "Send code",
  );
</script>

{#if $flow.verified}
  <main>
    <h1>Verified</h1>
    <button type="button" onclick={flow.reset}>Start over</button>
  </main>
{:else}
  <main>
    <h1>Phone verification</h1>
    {#if mock}<p>Mock mode: no API key configured, the code is 123456.</p>{/if}

    <form use:otpForm={onSend}>
      <label>
        Phone number
        <input name="phoneNumber" inputmode="tel" placeholder="01012345678" required />
      </label>
      <button type="submit" disabled={!$flow.canSend}>{sendLabel}</button>
    </form>

    {#if $flow.issueId}
      <form use:otpForm={onVerify}>
        <label>
          Code
          <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required />
        </label>
        <button type="submit" disabled={!$flow.canVerify}>
          {$flow.verifyState.isLoading ? "Checking..." : "Verify"}
        </button>
      </form>
    {/if}

    {#if $flow.reasonCode === "MISMATCH"}
      <p>Wrong code, {$flow.attemptsRemaining} attempts left.</p>
    {:else if $flow.reasonCode}
      <p>This code can no longer be used ({$flow.reasonCode}). Request a new one.</p>
    {/if}
    {#if $flow.error}<p role="alert">{describeError($flow.error)}</p>{/if}
  </main>
{/if}
