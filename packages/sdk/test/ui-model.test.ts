import { describe, expect, test } from "bun:test";
import { OTP_API_ERROR_CODES, OtpApiError } from "../src/core";
import {
  applyOtpCodeInput,
  applyOtpCodeKey,
  applyOtpCodePaste,
  createOtpTranslator,
  formatOtpCountdown,
  formatOtpMessage,
  formatOtpPhoneInput,
  isOtpCodeComplete,
  isWebOtpSupported,
  maskOtpPhoneNumber,
  OTP_MESSAGES,
  otpCodeFocusIndex,
  otpCodeSegments,
  otpErrorMessageKey,
  otpReasonMessageKey,
  otpSecondsLeft,
  otpSkipMessageKey,
  parseOtpPhoneNumber,
  receiveWebOtp,
  sanitizeOtpCode,
} from "../src/ui";

describe("parseOtpPhoneNumber", () => {
  test.each([
    ["01012345678", "01012345678"],
    ["010-1234-5678", "01012345678"],
    ["010 1234 5678", "01012345678"],
    ["010.1234.5678", "01012345678"],
    ["(010) 1234-5678", "01012345678"],
    ["+82 10-1234-5678", "01012345678"],
    ["+821012345678", "01012345678"],
    ["82 10 1234 5678", "01012345678"],
    ["0082 10 1234 5678", "01012345678"],
    ["+82 010-1234-5678", "01012345678"],
    ["  ０１０-１２３４-５６７８  ", "01012345678"],
    ["＋８２ １０ １２３４ ５６７８", "01012345678"],
    ["011-123-4567", "0111234567"],
    ["016-1234-5678", "01612345678"],
    ["+82 19-123-4567", "0191234567"],
  ])("%s is the Korean mobile %s", (input, national) => {
    const phone = parseOtpPhoneNumber(input);
    expect(phone).toMatchObject({
      valid: true,
      kind: "kr-mobile",
      value: national,
      national,
      e164: `+82${national.slice(1)}`,
      error: undefined,
    });
  });

  test("display groups 3-4-4 (and 3-3-4 for legacy 10-digit numbers)", () => {
    expect(parseOtpPhoneNumber("01012345678").display).toBe("010-1234-5678");
    expect(parseOtpPhoneNumber("0111234567").display).toBe("011-123-4567");
  });

  test.each([
    ["", "empty"],
    ["   ", "empty"],
    ["010-1234-567", "invalid"],
    ["010123456789", "invalid"],
    ["0101234567", "invalid"],
    ["012-1234-5678", "invalid"],
    ["02-123-4567", "not-mobile"],
    ["031-123-4567", "not-mobile"],
    ["+82 2-123-4567", "not-mobile"],
    ["phone", "invalid"],
    ["010-1234-567a", "invalid"],
    ["1012345678", "invalid"],
    ["82 2 123 4567", "invalid"],
    ["+1", "invalid"],
    [`010${"1".repeat(40)}`, "invalid"],
  ])("%j is rejected as %s", (input, error) => {
    const phone = parseOtpPhoneNumber(input);
    expect(phone.valid).toBe(false);
    expect(phone.error).toBe(error as never);
    expect(phone.value).toBeUndefined();
  });

  test("international numbers need allowInternational and are sent as E.164", () => {
    expect(parseOtpPhoneNumber("+1 415-555-0123")).toMatchObject({
      valid: false,
      kind: "international",
      error: "international",
      e164: "+14155550123",
    });
    expect(
      parseOtpPhoneNumber("+1 415-555-0123", { allowInternational: true }),
    ).toMatchObject({
      valid: true,
      kind: "international",
      value: "+14155550123",
      national: undefined,
    });
    // Korean spellings never need the option.
    expect(
      parseOtpPhoneNumber("+82 10 1234 5678", { allowInternational: false })
        .valid,
    ).toBe(true);
  });

  test("matches the API's per-phone canonicalization for every KR spelling", () => {
    // The API folds these into one rate-limit subject; the UI sends one value.
    const values = new Set(
      [
        "010-1234-5678",
        "+82 10-1234-5678",
        "82 1012345678",
        "0082 10 1234 5678",
        "+82 010 1234 5678",
      ].map((input) => parseOtpPhoneNumber(input).value),
    );
    expect([...values]).toEqual(["01012345678"]);
  });
});

describe("formatOtpPhoneInput / maskOtpPhoneNumber", () => {
  test.each([
    ["0", "0"],
    ["010", "010"],
    ["0101", "010-1"],
    ["0101234", "010-1234"],
    ["01012345", "010-1234-5"],
    ["01012345678", "010-1234-5678"],
    ["010-1234-", "010-1234"],
    ["0111234567", "011-123-4567"],
    ["+82", "+82"],
    ["+8210", "+82 10"],
    ["+821012345678", "+82 10-1234-5678"],
    ["+82 010 1234 5678", "+82 010-1234-5678"],
    ["+1 415 555 0123", "+14155550123"],
    ["０１０１２３４", "010-1234"],
    ["abc", "abc"],
  ])("%j -> %j", (input, expected) => {
    expect(formatOtpPhoneInput(input)).toBe(expected);
  });

  test("masks the middle digits", () => {
    expect(maskOtpPhoneNumber("010-1234-5678")).toBe("010-****-5678");
    expect(maskOtpPhoneNumber("+82 11 123 4567")).toBe("011-***-4567");
    expect(maskOtpPhoneNumber("+14155550123")).toBe("+1415***0123");
    expect(maskOtpPhoneNumber("nope")).toBeUndefined();
  });
});

describe("code input model", () => {
  test.each([
    ["123456", "123456"],
    ["123 456", "123456"],
    ["123-456", "123456"],
    ["１２３４５６", "123456"],
    ["Your code is 654321.", "654321"],
    ["[K-OTP] 인증번호는 123456입니다. 3분 내에 입력해주세요.", "123456"],
    ["12", "12"],
    ["1234567890", "123456"],
    ["abc", ""],
  ])("sanitizeOtpCode(%j) = %j", (input, expected) => {
    expect(sanitizeOtpCode(input)).toBe(expected);
  });

  test("sanitizeOtpCode honors the length", () => {
    expect(sanitizeOtpCode("code 1234 sent at 10:15", 4)).toBe("1234");
    expect(sanitizeOtpCode("12345678", 8)).toBe("12345678");
  });

  test("segments, completeness and focus redirection", () => {
    expect(otpCodeSegments("12", 4)).toEqual(["1", "2", "", ""]);
    expect(isOtpCodeComplete("123456")).toBe(true);
    expect(isOtpCodeComplete("12345")).toBe(false);
    expect(isOtpCodeComplete("12345a")).toBe(false);
    expect(otpCodeFocusIndex("12", 5)).toBe(2);
    expect(otpCodeFocusIndex("123456", 5)).toBe(5);
    expect(otpCodeFocusIndex("", 0)).toBe(0);
  });

  test("typing fills from the left and moves to the next segment", () => {
    expect(applyOtpCodeInput("", 0, "1")).toEqual({ value: "1", focus: 1 });
    // Typing into a later empty segment lands on the first empty one.
    expect(applyOtpCodeInput("1", 4, "2")).toEqual({ value: "12", focus: 2 });
    // Overwriting a filled segment: the new digit wins.
    expect(applyOtpCodeInput("123", 1, "27")).toEqual({
      value: "173",
      focus: 2,
    });
    expect(applyOtpCodeInput("123", 1, "72")).toEqual({
      value: "173",
      focus: 2,
    });
    // The last digit keeps focus on the last segment.
    expect(applyOtpCodeInput("12345", 5, "6")).toEqual({
      value: "123456",
      focus: 5,
    });
    // An emptied segment is cleared.
    expect(applyOtpCodeInput("123", 1, "")).toEqual({ value: "13", focus: 1 });
    // Letters are ignored.
    expect(applyOtpCodeInput("12", 2, "a")).toEqual({
      value: "12",
      focus: 2,
    });
    expect(applyOtpCodeInput("12", 1, "2a")).toEqual({
      value: "12",
      focus: 2,
    });
  });

  test("OS autofill / multi-digit input spreads across segments", () => {
    expect(applyOtpCodeInput("", 0, "123456")).toEqual({
      value: "123456",
      focus: 5,
    });
    expect(applyOtpCodeInput("99", 0, "123 456")).toEqual({
      value: "123456",
      focus: 5,
    });
    expect(applyOtpCodeInput("1", 1, "234")).toEqual({
      value: "1234",
      focus: 4,
    });
  });

  test("paste writes from the segment, a full code replaces everything", () => {
    expect(applyOtpCodePaste("", 0, " 12-34 56 ")).toEqual({
      value: "123456",
      focus: 5,
    });
    expect(applyOtpCodePaste("999", 2, "123456")).toEqual({
      value: "123456",
      focus: 5,
    });
    expect(applyOtpCodePaste("12", 2, "34")).toEqual({
      value: "1234",
      focus: 4,
    });
    expect(applyOtpCodePaste("12", 2, "no digits")).toEqual({
      value: "12",
      focus: 2,
    });
  });

  test("keyboard navigation", () => {
    expect(applyOtpCodeKey("123", 3, "Backspace")).toEqual({
      value: "12",
      focus: 2,
    });
    expect(applyOtpCodeKey("123", 1, "Backspace")).toEqual({
      value: "13",
      focus: 1,
    });
    expect(applyOtpCodeKey("", 0, "Backspace")).toEqual({
      value: "",
      focus: 0,
    });
    expect(applyOtpCodeKey("123", 0, "Delete")).toEqual({
      value: "23",
      focus: 0,
    });
    expect(applyOtpCodeKey("123", 2, "ArrowLeft")).toEqual({
      value: "123",
      focus: 1,
    });
    expect(applyOtpCodeKey("123", 1, "ArrowRight")).toEqual({
      value: "123",
      focus: 2,
    });
    expect(applyOtpCodeKey("123", 3, "ArrowRight")).toEqual({
      value: "123",
      focus: 3,
    });
    expect(applyOtpCodeKey("123", 2, "Home")).toEqual({
      value: "123",
      focus: 0,
    });
    expect(applyOtpCodeKey("12", 0, "End")).toEqual({ value: "12", focus: 2 });
    expect(applyOtpCodeKey("123456", 0, "End")).toEqual({
      value: "123456",
      focus: 5,
    });
    expect(applyOtpCodeKey("12", 0, "5")).toBeUndefined();
    expect(applyOtpCodeKey("12", 0, "Tab")).toBeUndefined();
  });
});

describe("countdown", () => {
  test.each([
    [0, "0:00"],
    [-5, "0:00"],
    [Number.NaN, "0:00"],
    [1, "0:01"],
    [999, "0:01"],
    [1000, "0:01"],
    [9_000, "0:09"],
    [59_001, "1:00"],
    [180_000, "3:00"],
    [3_599_000, "59:59"],
    [3_600_000, "1:00:00"],
    [3_725_000, "1:02:05"],
  ])("formatOtpCountdown(%d) = %s", (ms, text) => {
    expect(formatOtpCountdown(ms)).toBe(text);
  });

  test("otpSecondsLeft rounds up and never goes negative", () => {
    expect(otpSecondsLeft(1)).toBe(1);
    expect(otpSecondsLeft(29_001)).toBe(30);
    expect(otpSecondsLeft(-1)).toBe(0);
  });
});

describe("messages", () => {
  test("both catalogs define every key with the same placeholders", () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const keys = Object.keys(OTP_MESSAGES.en).sort();
    expect(Object.keys(OTP_MESSAGES.ko).sort()).toEqual(keys);
    for (const key of keys as (keyof typeof OTP_MESSAGES.en)[]) {
      expect(OTP_MESSAGES.ko[key].trim()).not.toBe("");
      expect(placeholders(OTP_MESSAGES.ko[key])).toEqual(
        placeholders(OTP_MESSAGES.en[key]),
      );
    }
  });

  test("every SDK error code, verify reason and skip reason has a message", () => {
    for (const code of OTP_API_ERROR_CODES) {
      const key = otpErrorMessageKey(
        new OtpApiError({ code, status: 0, message: code }),
      );
      expect(key).toBe(`error.${code}`);
      expect(OTP_MESSAGES.en[key]).toBeString();
      expect(OTP_MESSAGES.ko[key]).toBeString();
    }
    for (const reason of [
      "MISMATCH",
      "EXPIRED",
      "MAX_ATTEMPTS",
      "REPLACED",
      "NOT_FOUND",
      "ALREADY_VERIFIED",
    ] as const) {
      expect(OTP_MESSAGES.en[otpReasonMessageKey(reason)]).toBeString();
    }
    for (const skip of [
      "cooldown",
      "busy",
      "no-issue",
      "terminal",
      "no-previous-send",
    ] as const) {
      expect(OTP_MESSAGES.ko[otpSkipMessageKey(skip)]).toBeString();
    }
  });

  test("an ambiguous send failure maps to sendUncertain (retry is safe)", () => {
    const error = (code: (typeof OTP_API_ERROR_CODES)[number]) =>
      new OtpApiError({ code, status: 0, message: code });
    for (const code of [
      "TIMEOUT",
      "NETWORK_ERROR",
      "SERVICE_UNAVAILABLE",
      "INTERNAL_SERVER_ERROR",
      "ABORTED",
    ] as const) {
      expect(otpErrorMessageKey(error(code), "send")).toBe(
        "error.sendUncertain",
      );
      expect(otpErrorMessageKey(error(code), "verify")).toBe(`error.${code}`);
    }
    expect(otpErrorMessageKey(error("TOO_MANY_REQUESTS"), "send")).toBe(
      "error.TOO_MANY_REQUESTS",
    );
    expect(otpErrorMessageKey(error("FORBIDDEN"), "send")).toBe(
      "error.FORBIDDEN",
    );
  });

  test("translator: locale, interpolation and overrides", () => {
    const ko = createOtpTranslator();
    expect(ko("send.idle")).toBe("인증번호 받기");
    expect(ko("send.resendIn", { time: "0:30" })).toBe("0:30 후 다시 받기");
    const en = createOtpTranslator({
      locale: "en",
      messages: {
        "send.idle": "Get a code",
        "reason.MISMATCH": ({ attempts }) => `Nope (${attempts})`,
      },
    });
    expect(en("send.idle")).toBe("Get a code");
    expect(en("reason.MISMATCH", { attempts: 2 })).toBe("Nope (2)");
    expect(en("verify.idle")).toBe("Verify");
    expect(formatOtpMessage("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });
});

describe("WebOTP without a browser", () => {
  test("is unsupported and resolves undefined without throwing", async () => {
    expect(isWebOtpSupported()).toBe(false);
    expect(await receiveWebOtp()).toBeUndefined();
    const controller = new AbortController();
    controller.abort();
    expect(await receiveWebOtp({ signal: controller.signal })).toBeUndefined();
  });

  test("uses navigator.credentials when OTPCredential exists", async () => {
    const globals = globalThis as Record<string, unknown>;
    const calls: unknown[] = [];
    const credentials = {
      get: async (options: unknown) => {
        calls.push(options);
        return { code: "１２３４５６" };
      },
    };
    const saved = {
      window: globals.window,
      navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    };
    globals.window = { OTPCredential: class {} };
    Object.defineProperty(globalThis, "navigator", {
      value: { credentials },
      configurable: true,
    });
    try {
      expect(isWebOtpSupported()).toBe(true);
      const controller = new AbortController();
      expect(await receiveWebOtp({ signal: controller.signal })).toBe("123456");
      expect(calls[0]).toEqual({
        otp: { transport: ["sms"] },
        signal: controller.signal,
      });
      credentials.get = async () => {
        throw new DOMException("aborted", "AbortError");
      };
      expect(await receiveWebOtp()).toBeUndefined();
    } finally {
      globals.window = saved.window;
      if (saved.navigator) {
        Object.defineProperty(globalThis, "navigator", saved.navigator);
      }
    }
  });
});
