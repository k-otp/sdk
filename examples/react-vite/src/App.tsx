import type { VerifyResult } from "@k-otp/sdk/react";
import { OtpForm } from "@k-otp/sdk/ui/react";
import { useState } from "react";
import { href, locale, variant } from "./options";

const copy = {
  ko: {
    title: "휴대폰 인증",
    preset: "기본 테마",
    headless: "헤드리스",
    mock: "목업 모드: 인증번호는 123456입니다.",
    mobile: "휴대폰",
  },
  en: {
    title: "Phone verification",
    preset: "Default theme",
    headless: "Headless",
    mock: "Mock mode: the code is 123456.",
    mobile: "Mobile",
  },
} as const;

/** The headless parts, styled only by ./custom.css. */
function Headless({ onVerified }: { onVerified: (r: VerifyResult) => void }) {
  return (
    <OtpForm.Root
      className="custom"
      purpose="login"
      locale={locale}
      onVerified={onVerified}
    >
      {({ state }) => (
        <>
          <OtpForm.PhoneField>
            {({ labelProps, inputProps, errorProps, parts }) => (
              <>
                <label {...labelProps}>{copy[locale].mobile}</label>
                <input {...inputProps} />
                {parts.text.phoneError && (
                  <p {...errorProps}>{parts.text.phoneError}</p>
                )}
              </>
            )}
          </OtpForm.PhoneField>
          {state.issued && (
            <>
              <OtpForm.CodeField description={null} />
              <div className="row">
                <OtpForm.Countdown />
                {state.phase !== "verified" && <OtpForm.EditPhoneButton />}
              </div>
              <OtpForm.VerifyButton />
            </>
          )}
          <OtpForm.SendButton />
          <OtpForm.Message />
        </>
      )}
    </OtpForm.Root>
  );
}

export function App({ mock }: { mock: boolean }) {
  const [verified, setVerified] = useState<string>();
  const onVerified = (result: VerifyResult) => setVerified(result.issueId);
  const t = copy[locale];
  return (
    <main className="page">
      <header>
        <h1>{t.title}</h1>
        {mock && <p className="mock">{t.mock}</p>}
      </header>
      <nav aria-label="Example options">
        <a
          href={href({ variant: "preset" })}
          aria-current={variant === "preset" ? "page" : undefined}
        >
          {t.preset}
        </a>
        <a
          href={href({ variant: "headless" })}
          aria-current={variant === "headless" ? "page" : undefined}
        >
          {t.headless}
        </a>
        <a
          href={href({ lang: "ko" })}
          aria-current={locale === "ko" ? "page" : undefined}
        >
          한국어
        </a>
        <a
          href={href({ lang: "en" })}
          aria-current={locale === "en" ? "page" : undefined}
        >
          English
        </a>
      </nav>
      {variant === "preset" ? (
        // One line: phone, send/resend with cooldown, code, verify.
        <OtpForm purpose="signup" locale={locale} onVerified={onVerified} />
      ) : (
        <Headless onVerified={onVerified} />
      )}
      {verified && <output>verified issueId: {verified}</output>}
    </main>
  );
}
