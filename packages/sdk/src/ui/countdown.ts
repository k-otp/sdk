/**
 * Formats a remaining duration as `m:ss` (`2:05`, `0:09`), or `h:mm:ss` from
 * one hour. Partial seconds round up, so a countdown shows `0:01` until it
 * really ends; negative or non-finite input is `0:00`.
 */
export const formatOtpCountdown = (ms: number): string => {
  const total = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
};

/** Whole seconds left (rounded up), never negative. */
export const otpSecondsLeft = (ms: number): number =>
  Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
