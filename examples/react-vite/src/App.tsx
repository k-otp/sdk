import { useOtpFlow } from "@k-otp/sdk-react";
import { type FormEvent, useState } from "react";

const describeError = (code: string, retryAfterMs?: number): string => {
  switch (code) {
    case "PAYMENT_REQUIRED":
      return "The service is temporarily unable to send codes. Please try again later.";
    case "TOO_MANY_REQUESTS":
      return `Too many attempts. Try again in ${Math.ceil((retryAfterMs ?? 0) / 1000)}s.`;
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

export function App({ mock }: { mock: boolean }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const otp = useOtpFlow({
    resendCooldownMs: 30_000,
    idempotencyKeyPrefix: "signup",
  });
  const seconds = Math.ceil(otp.cooldownRemainingMs / 1000);

  const onSend = (event: FormEvent) => {
    event.preventDefault();
    void otp.send({ phoneNumber, purpose: "signup" });
  };
  const onVerify = (event: FormEvent) => {
    event.preventDefault();
    void otp.verify(code);
  };

  if (otp.verified) {
    return (
      <main>
        <h1>Verified</h1>
        <button type="button" onClick={otp.reset}>
          Start over
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>Phone verification</h1>
      {mock && <p>Mock mode: no API key configured, the code is 123456.</p>}

      <form onSubmit={onSend}>
        <label>
          Phone number
          <input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            inputMode="tel"
            placeholder="01012345678"
            required
          />
        </label>
        <button type="submit" disabled={!otp.canSend}>
          {otp.issueState.isLoading
            ? "Sending..."
            : seconds > 0
              ? `Resend in ${seconds}s`
              : otp.idempotencyKey
                ? "Retry"
                : otp.issueId
                  ? "Resend code"
                  : "Send code"}
        </button>
      </form>

      {otp.issueId && (
        <form onSubmit={onVerify}>
          <label>
            Code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
          </label>
          <button type="submit" disabled={!otp.canVerify}>
            {otp.verifyState.isLoading ? "Checking..." : "Verify"}
          </button>
        </form>
      )}

      {otp.reasonCode && (
        <p>
          {otp.reasonCode === "MISMATCH"
            ? `Wrong code, ${otp.attemptsRemaining} attempts left.`
            : `This code can no longer be used (${otp.reasonCode}). Request a new one.`}
        </p>
      )}
      {otp.error && (
        <p role="alert">
          {describeError(otp.error.code, otp.error.retryAfterMs)}
        </p>
      )}
    </main>
  );
}
