<script setup lang="ts">
import { type OtpApiError, useOtpFlow } from "@k-otp/sdk-vue";
import { computed, ref } from "vue";

defineProps<{ mock: boolean }>();

const phoneNumber = ref("");
const code = ref("");
const {
  send,
  verify,
  reset,
  issueId,
  verified,
  reasonCode,
  attemptsRemaining,
  error,
  sending,
  verifying,
  idempotencyKey,
  canSend,
  canVerify,
  cooldownRemainingMs,
} = useOtpFlow({ resendCooldownMs: 30_000, idempotencyKeyPrefix: "signup" });

const seconds = computed(() => Math.ceil(cooldownRemainingMs.value / 1000));
const sendLabel = computed(() => {
  if (sending.value) return "Sending...";
  if (seconds.value > 0) return `Resend in ${seconds.value}s`;
  if (idempotencyKey.value) return "Retry";
  return issueId.value ? "Resend code" : "Send code";
});

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

const onSend = () => send({ phoneNumber: phoneNumber.value, purpose: "signup" });
const onVerify = () => verify(code.value);
</script>

<template>
  <main v-if="verified">
    <h1>Verified</h1>
    <button type="button" @click="reset">Start over</button>
  </main>
  <main v-else>
    <h1>Phone verification</h1>
    <p v-if="mock">Mock mode: no API key configured, the code is 123456.</p>

    <form @submit.prevent="onSend">
      <label>
        Phone number
        <input v-model="phoneNumber" inputmode="tel" placeholder="01012345678" required />
      </label>
      <button type="submit" :disabled="!canSend">{{ sendLabel }}</button>
    </form>

    <form v-if="issueId" @submit.prevent="onVerify">
      <label>
        Code
        <input
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          required
        />
      </label>
      <button type="submit" :disabled="!canVerify">
        {{ verifying ? "Checking..." : "Verify" }}
      </button>
    </form>

    <p v-if="reasonCode === 'MISMATCH'">Wrong code, {{ attemptsRemaining }} attempts left.</p>
    <p v-else-if="reasonCode">
      This code can no longer be used ({{ reasonCode }}). Request a new one.
    </p>
    <p v-if="error" role="alert">{{ describeError(error) }}</p>
  </main>
</template>
