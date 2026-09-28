import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeLabel, toUnicode } from "./punycode.js";

// RFC 3492 §7.1 samples (Punycode forms, lowercased) and the strings they decode to.
const RFC_SAMPLES: [string, string][] = [
  ["egbpdaj6bu4bxfgehfvwxn", "\u{0644}\u{064A}\u{0647}\u{0645}\u{0627}\u{0628}\u{062A}\u{0643}\u{0644}\u{0645}\u{0648}\u{0634}\u{0639}\u{0631}\u{0628}\u{064A}\u{061F}"],
  ["ihqwcrb4cv8a8dqg056pqjye", "\u{4ED6}\u{4EEC}\u{4E3A}\u{4EC0}\u{4E48}\u{4E0D}\u{8BF4}\u{4E2D}\u{6587}"],
  ["3b-ww4c5e180e575a65lsy2b", "3\u{5E74}B\u{7D44}\u{91D1}\u{516B}\u{5148}\u{751F}"],
  ["-with-super-monkeys-pc58ag80a8qai00g7n9n", "\u{5B89}\u{5BA4}\u{5948}\u{7F8E}\u{6075}-with-SUPER-MONKEYS"],
  ["d9juau41awczczp", "\u{305D}\u{306E}\u{30B9}\u{30D4}\u{30FC}\u{30C9}\u{3067}"],
  ["-> $1.00 <--", "-> $1.00 <-"],
];

test("decodeLabel: RFC 3492 samples", () => {
  for (const [encoded, decoded] of RFC_SAMPLES) {
    // The RFC's mixed-case samples are case-annotated; compare case-insensitively on basic code points.
    assert.equal(decodeLabel(encoded).toLowerCase(), decoded.toLowerCase(), encoded);
  }
});

test("decodeLabel: astral code points survive (no UCS-2 split)", () => {
  // "ab😀" — the smiley is U+1F600, beyond the BMP.
  assert.equal(decodeLabel("ab-oo82a"), "ab\u{1F600}");
});

test("toUnicode: xn-- labels decode, others pass through", () => {
  assert.equal(toUnicode("xn--o3cw4h.example"), "\u{0E44}\u{0E17}\u{0E22}.example");
  assert.equal(toUnicode("xn--e1afmkfd.xn--p1ai"), "\u{043F}\u{0440}\u{0438}\u{043C}\u{0435}\u{0440}.\u{0440}\u{0444}");
  assert.equal(toUnicode("api.example.com"), "api.example.com");
  assert.equal(toUnicode(""), "");
});

test("toUnicode: the label is lowercased after the case-sensitive xn-- test", () => {
  assert.equal(toUnicode("xn--E1AFMKFD.example"), "\u{043F}\u{0440}\u{0438}\u{043C}\u{0435}\u{0440}.example");
  assert.equal(toUnicode("XN--E1AFMKFD.example"), "XN--E1AFMKFD.example");
});

test("toUnicode: RFC 3490 separators become full stops", () => {
  assert.equal(toUnicode("a\u{3002}b\u{FF0E}c\u{FF61}d"), "a.b.c.d");
});

test("toUnicode: only the domain after @ is decoded", () => {
  assert.equal(toUnicode("xn--x@xn--o3cw4h.example"), "xn--x@\u{0E44}\u{0E17}\u{0E22}.example");
});

test("toUnicode: undecodable labels throw RangeError", () => {
  assert.throws(() => toUnicode("xn--a\u{00E9}-b.example"), RangeError); // non-basic before the delimiter
  assert.throws(() => toUnicode("xn--ab!.example"), RangeError); // not a base-36 digit
  assert.throws(() => toUnicode("xn--99999999999.example"), RangeError); // overflow
});
