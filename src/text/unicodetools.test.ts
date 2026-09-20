import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectUnicode, renderInspection, UNICODE_MAX_CODEPOINTS } from "./unicodetools.js";
import { InputError } from "../errors.js";

test("inspectUnicode: counts diverge for a mixed string", () => {
  const r = inspectUnicode("A👨");
  assert.equal(r.summary.codepoints, 2);
  assert.equal(r.summary.utf16units, 3); // 👨 is a surrogate pair
  assert.equal(r.summary.utf8bytes, 5); // 1 + 4
  assert.equal(r.rows.length, 2);
});

test("inspectUnicode: ASCII row fields", () => {
  const r = inspectUnicode("A");
  const row = r.rows[0]!;
  assert.equal(row.hex, "U+0041");
  assert.equal(row.glyph, "A");
  assert.equal(row.category, "Lu");
  assert.equal(row.jsEscape, "\\u0041");
  assert.equal(row.xEscape, "\\x41");
  assert.equal(row.htmlEntity, "&#x41;");
  assert.equal(row.utf8, "41");
});

test("inspectUnicode: astral emoji escapes", () => {
  const row = inspectUnicode("👨").rows[0]!;
  assert.equal(row.hex, "U+1F468");
  assert.equal(row.category, "So");
  assert.ok(row.jsEscape.includes("\\u{1F468}"));
  assert.ok(row.jsEscape.includes("\\uD83D\\uDC68")); // surrogate-pair form
  assert.equal(row.xEscape, "—"); // > 0xFF
  assert.equal(row.utf8, "f0 9f 91 a8");
});

test("inspectUnicode: control/bidi labeled, never emitted raw", () => {
  const zwsp = inspectUnicode(String.fromCodePoint(0x200b)).rows[0]!;
  assert.equal(zwsp.category, "Cf");
  assert.equal(zwsp.glyph, "[U+200B]");
  const tab = inspectUnicode("\t").rows[0]!;
  assert.equal(tab.category, "Cc");
  assert.equal(tab.glyph, "␉"); // Control Picture for TAB, not a raw tab
});

test("inspectUnicode: lone surrogate is flagged ill-formed", () => {
  const row = inspectUnicode("\ud83d").rows[0]!;
  assert.equal(row.category, "Cs");
  assert.equal(row.illFormed, true);
  assert.ok(row.utf8.includes("ill-formed"));
});

test("inspectUnicode: normalize NFD decomposes", () => {
  const r = inspectUnicode(String.fromCodePoint(0x00e9), "NFD"); // precomposed é → e + combining acute
  assert.equal(r.summary.codepoints, 2);
  assert.equal(r.rows[1]!.category, "Mn");
});

test("inspectUnicode: empty and over-cap throw InputError", () => {
  assert.throws(() => inspectUnicode(""), InputError);
  assert.throws(() => inspectUnicode("x".repeat(UNICODE_MAX_CODEPOINTS + 1)), InputError);
});

test("inspectUnicode: invisible variation selector labeled, not raw", () => {
  const vs = String.fromCodePoint(0xfe0f);
  const row = inspectUnicode(vs).rows[0]!;
  assert.equal(row.category, "Mn");
  assert.equal(row.glyph, "[U+FE0F]");
  assert.ok(!row.glyph.includes(vs));
});

test("inspectUnicode: visible combining mark keeps the dotted circle", () => {
  const acute = String.fromCodePoint(0x0301);
  const row = inspectUnicode(acute).rows[0]!;
  assert.equal(row.glyph, "◌" + acute);
});

test("inspectUnicode: invisible non-mark code point (Hangul filler) labeled, not raw", () => {
  const filler = String.fromCodePoint(0x3164); // HANGUL FILLER — category Lo, zero-width
  const row = inspectUnicode(filler).rows[0]!;
  assert.equal(row.category, "Lo");
  assert.equal(row.glyph, "[U+3164]");
  assert.ok(!row.glyph.includes(filler));
});

test("inspectUnicode: non-ASCII whitespace labeled, ASCII space stays a control picture", () => {
  const nbsp = String.fromCodePoint(0x00a0);
  const row = inspectUnicode(nbsp).rows[0]!;
  assert.equal(row.category, "Zs");
  assert.equal(row.glyph, "[U+00A0]");
  // regular ASCII space still uses the Control Picture (earlier branch), not a bracket
  assert.equal(inspectUnicode(" ").rows[0]!.glyph, "␠");
});

test("renderInspection: has summary and a names note", () => {
  const body = renderInspection(inspectUnicode("A"));
  assert.ok(body.includes("Code points 1"));
  assert.ok(body.includes("UTF-8 bytes 1"));
  assert.ok(body.toLowerCase().includes("names"));
});
