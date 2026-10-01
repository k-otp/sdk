<script setup lang="ts">
import type { VerifyResult } from "@k-otp/sdk/vue";
import { OtpForm } from "@k-otp/sdk/ui/vue";
import { ref } from "vue";
import { href, locale, variant } from "./options";

defineProps<{ mock: boolean }>();

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

const verified = ref<string>();
const onVerified = (result: VerifyResult) => {
  verified.value = result.issueId;
};
</script>

<template>
  <main class="page">
    <header>
      <h1>{{ t.title }}</h1>
      <p v-if="mock" class="mock">{{ t.mock }}</p>
    </header>
    <nav aria-label="Example options">
      <a :href="href({ variant: 'preset' })" :aria-current="variant === 'preset' ? 'page' : undefined">{{ t.preset }}</a>
      <a :href="href({ variant: 'headless' })" :aria-current="variant === 'headless' ? 'page' : undefined">{{ t.headless }}</a>
      <a :href="href({ lang: 'ko' })" :aria-current="locale === 'ko' ? 'page' : undefined">한국어</a>
      <a :href="href({ lang: 'en' })" :aria-current="locale === 'en' ? 'page' : undefined">English</a>
    </nav>

    <!-- One line: phone, send/resend with cooldown, code, verify. -->
    <OtpForm v-if="variant === 'preset'" purpose="signup" :locale="locale" @verified="onVerified" />

    <!-- The headless parts, styled only by ./custom.css. -->
    <OtpForm.Root v-else v-slot="{ state }" class="custom" purpose="login" :locale="locale" @verified="onVerified">
      <OtpForm.PhoneField v-slot="{ labelProps, inputProps, errorProps, parts }">
        <label v-bind="labelProps">{{ t.mobile }}</label>
        <input v-bind="inputProps" />
        <p v-if="parts.text.phoneError" v-bind="errorProps">{{ parts.text.phoneError }}</p>
      </OtpForm.PhoneField>
      <template v-if="state.issued">
        <OtpForm.CodeField description="" />
        <div class="row">
          <OtpForm.Countdown />
          <OtpForm.EditPhoneButton v-if="state.phase !== 'verified'" />
        </div>
        <OtpForm.VerifyButton />
      </template>
      <OtpForm.SendButton />
      <OtpForm.Message />
    </OtpForm.Root>

    <output v-if="verified">verified issueId: {{ verified }}</output>
  </main>
</template>
