import { test } from "node:test";
import assert from "node:assert/strict";
import { countText, renderCount, MAX_COUNT_CHARS } from "./counttools.js";
import { InputError } from "../errors.js";

test("countText: Thai without spaces is segmented into real words", () => {
  const r = countText("เสี่ยวเอ้อเป็นบอทที่ฉลาดมาก");
  assert.equal(r.words, 7); // whitespace-splitting would say 1
  assert.equal(r.graphemes, 21);
  assert.equal(r.codepoints, 27);
  assert.equal(r.utf8bytes, 81);
});

test("countText: Thai graphemes differ from code points", () => {
  const r = countText("เสี่ยว");
  assert.equal(r.graphemes, 4);
  assert.equal(r.codepoints, 6);
  assert.equal(r.utf16units, 6);
  assert.equal(r.utf8bytes, 18);
});

test("countText: ZWJ emoji family is one grapheme and zero words", () => {
  const r = countText("👨‍👩‍👧‍👦");
  assert.equal(r.graphemes, 1);
  assert.equal(r.codepoints, 7);
  assert.equal(r.utf16units, 11);
  assert.equal(r.utf8bytes, 25);
  assert.equal(r.words, 0); // emoji are not word-like
});

test("countText: regional-indicator flag is one grapheme", () => {
  const r = countText("🇹🇭");
  assert.equal(r.graphemes, 1);
  assert.equal(r.codepoints, 2);
  assert.equal(r.utf16units, 4);
});

test("countText: NFD combining mark is one grapheme, two code points", () => {
  const r = countText("é"); // e + COMBINING ACUTE — built explicitly, never pasted
  assert.equal(r.graphemes, 1);
  assert.equal(r.codepoints, 2);
  assert.equal(r.utf8bytes, 3);
});

test("countText: CJK is segmented into multiple words", () => {
  const r = countText("我喜欢编程和音乐");
  assert.equal(r.graphemes, 8);
  assert.equal(r.words, 6);
});

test("countText: mixed script, hyphen splits, decimal does not", () => {
  const r = countText("Hello สวัสดี 世界 test-case 3.14");
  // [Hello, สวัสดี, 世界, test, case, 3.14] — hyphen splits, "3.14" stays whole
  assert.equal(r.words, 6);
  assert.equal(r.graphemes, 28);
  assert.equal(r.graphemesNoSpace, 24);
});

test("countText: sentence count matches ICU, including its D.C. miss", () => {
  // A human reads 2 sentences here; ICU reports 3. We assert ICU's actual
  // behavior — asserting linguistic truth would encode a test that can never pass.
  const r = countText("Dr. Smith went to Washington D.C. yesterday. It rained.");
  assert.equal(r.sentences, 3);
  assert.equal(r.words, 9);
});

test("countText: a decimal point does not end a sentence", () => {
  const r = countText("It cost 3.14 dollars. That is a lot.");
  assert.equal(r.sentences, 2);
  assert.equal(r.words, 8);
});

test("countText: CRLF is normalized to one line break", () => {
  const r = countText("a\r\nb");
  assert.equal(r.lines, 2);
  assert.equal(r.graphemes, 3); // \r\n collapsed to \n before counting
  assert.equal(r.utf16units, 3);
});

test("countText: a trailing newline terminates the last line", () => {
  assert.equal(countText("a\nb\n").lines, 2); // not 3
});

test("countText: a blank interior line counts", () => {
  assert.equal(countText("a\n\nb").lines, 3);
});

test("countText: graphemesNoSpace excludes spaces and tabs", () => {
  const r = countText("a b\tc");
  assert.equal(r.graphemes, 5);
  assert.equal(r.graphemesNoSpace, 3);
});

test("countText: reading time is words at 200 wpm, floored at 1s", () => {
  assert.equal(countText("one two three").readingSeconds, 1);
  // 400 words -> 400/200*60 = 120s exactly
  assert.equal(countText("word ".repeat(400)).readingSeconds, 120);
});

test("countText: empty and whitespace-only throw InputError", () => {
  assert.throws(() => countText(""), InputError);
  assert.throws(() => countText("   \n\t "), InputError);
});

test("countText: cap boundary passes, one over throws", () => {
  assert.equal(countText("x".repeat(MAX_COUNT_CHARS)).graphemes, MAX_COUNT_CHARS);
  assert.throws(() => countText("x".repeat(MAX_COUNT_CHARS + 1)), InputError);
});

/** Collapse runs of whitespace so assertions ignore column padding. */
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

test("renderCount: reports every stat", () => {
  const body = flat(renderCount(countText("Hello world.\nSecond line.")));
  assert.ok(body.includes("Characters 25"));
  assert.ok(body.includes("no spaces: 22"));
  assert.ok(body.includes("Words 4"));
  assert.ok(body.includes("Lines 2"));
  assert.ok(body.includes("Sentences ~2"));
  assert.ok(body.includes("Code points 25"));
  assert.ok(body.includes("UTF-16 units 25"));
  assert.ok(body.includes("UTF-8 bytes 25"));
});

test("renderCount: marks estimates and explains the Thai caveat", () => {
  const body = renderCount(countText("hello"));
  assert.ok(body.includes("~")); // estimates are marked
  assert.ok(body.toLowerCase().includes("estimate"));
  assert.ok(body.includes("Thai"));
});

test("renderCount: formats sub-minute reading time in seconds", () => {
  const body = flat(renderCount(countText("one two three")));
  assert.ok(body.includes("Reading time ~1s"));
});

test("renderCount: formats minutes and seconds above 60s", () => {
  const body = flat(renderCount(countText("word ".repeat(500)))); // 150s
  assert.ok(body.includes("Reading time ~2m 30s"));
});

test("renderCount: drops the seconds part on a whole minute", () => {
  const body = flat(renderCount(countText("word ".repeat(400)))); // 120s
  assert.ok(body.includes("Reading time ~2m"));
  assert.ok(!body.includes("2m 0s"));
});

test("renderCount: the value column is aligned across both blocks", () => {
  const lines = renderCount(countText("hello world")).split("\n");
  // Values are right-aligned, so compare where each value ENDS, not where it
  // starts. The Characters row carries a "(no spaces: N)" suffix — strip it first.
  const valueEnd = (line: string) =>
    line.replace(/\s{3}\(no spaces.*$/, "").trimEnd().length;
  const row = (prefix: string) => lines.find((l) => l.startsWith(prefix))!;

  assert.equal(valueEnd(row("Characters")), valueEnd(row("Words")));
  // crosses the blank line into the Encoding block
  assert.equal(valueEnd(row("Words")), valueEnd(row("  UTF-8 bytes")));
});
