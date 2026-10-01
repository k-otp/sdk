<script lang="ts">
  import { createOtpClient, type VerifyResult } from "@k-otp/sdk/svelte";
  import {
    OtpForm,
    OtpFormCodeField,
    OtpFormCountdown,
    OtpFormEditPhoneButton,
    OtpFormMessage,
    OtpFormPhoneField,
    OtpFormRoot,
    OtpFormSendButton,
    OtpFormVerifyButton,
  } from "@k-otp/sdk/ui/svelte";
  import { mockFetch } from "./mock-fetch";
  import { href, locale, variant } from "./options";

  const apiKey = import.meta.env.VITE_K_OTP_PUBLIC_KEY?.trim();
  const baseUrl = import.meta.env.VITE_K_OTP_BASE_URL?.trim() || undefined;
  const mock = !apiKey;
  // One client for both variants (no key: the in-browser mock API).
  const client = createOtpClient(
    apiKey ? { apiKey, baseUrl } : { apiKey: "pk_mock", fetch: mockFetch },
  );

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
  const t = copy[locale];

  let verified = $state<string>();
  const onVerified = (result: VerifyResult) => {
    verified = result.issueId;
  };
</script>

<main class="page">
  <header>
    <h1>{t.title}</h1>
    {#if mock}<p class="mock">{t.mock}</p>{/if}
  </header>
  <nav aria-label="Example options">
    <a href={href({ variant: "preset" })} aria-current={variant === "preset" ? "page" : undefined}>{t.preset}</a>
    <a href={href({ variant: "headless" })} aria-current={variant === "headless" ? "page" : undefined}>{t.headless}</a>
    <a href={href({ lang: "ko" })} aria-current={locale === "ko" ? "page" : undefined}>한국어</a>
    <a href={href({ lang: "en" })} aria-current={locale === "en" ? "page" : undefined}>English</a>
  </nav>

  {#if variant === "preset"}
    <!-- One line: phone, send/resend with cooldown, code, verify. -->
    <OtpForm {client} purpose="signup" {locale} {onVerified} />
  {:else}
    <!-- The headless parts, styled only by ./custom.css. -->
    <OtpFormRoot {client} class="custom" purpose="login" {locale} {onVerified}>
      {#snippet children({ state })}
        <OtpFormPhoneField>
          {#snippet children({ labelProps, inputProps, errorProps, parts, onInput, onBlur })}
            <label {...labelProps}>{t.mobile}</label>
            <input {...inputProps} readonly={state.phoneLocked} oninput={onInput} onblur={onBlur} />
            {#if parts.text.phoneError}<p {...errorProps}>{parts.text.phoneError}</p>{/if}
          {/snippet}
        </OtpFormPhoneField>
        {#if state.issued}
          <OtpFormCodeField description="" />
          <div class="row">
            <OtpFormCountdown />
            {#if state.phase !== "verified"}<OtpFormEditPhoneButton />{/if}
          </div>
          <OtpFormVerifyButton />
        {/if}
        <OtpFormSendButton />
        <OtpFormMessage />
      {/snippet}
    </OtpFormRoot>
  {/if}

  {#if verified}<output>verified issueId: {verified}</output>{/if}
</main>
