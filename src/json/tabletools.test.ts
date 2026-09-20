import { test } from "node:test";
import assert from "node:assert/strict";
import { cellDisplay, graphemeLength, truncateGraphemes, jsonToTable } from "./tabletools.js";

test("graphemeLength: counts display units, not UTF-16 units", () => {
  assert.equal(graphemeLength("hello"), 5);
  // .length says 10 — padding on it visibly breaks Thai alignment.
  assert.equal(graphemeLength("เสี่ยวเอ้อ"), 7);
  assert.equal(graphemeLength("สวัสดี"), 4);
  assert.equal(graphemeLength("🎲"), 1);
});

test("truncateGraphemes: cap includes the ellipsis, never splits a cluster", () => {
  assert.equal(truncateGraphemes("abcde", 5), "abcde");
  assert.equal(truncateGraphemes("abcdef", 5), "abcd…");
  assert.equal(truncateGraphemes("เสี่ยวเอ้อ", 5), "เสี่ยว…");
  assert.equal(graphemeLength(truncateGraphemes("เสี่ยวเอ้อ", 5)), 5);
});

test("truncateGraphemes: a non-positive cap still yields just the ellipsis", () => {
  // Unreachable through cellDisplay (MAX_CELL is the only cap passed today) but
  // the function is exported and generically typed. Unclamped, slice(0, cap - 1)
  // reads as slice(0, -1) and returns nearly the WHOLE string plus an ellipsis —
  // the opposite of truncating.
  assert.equal(truncateGraphemes("abcdef", 1), "…");
  assert.equal(truncateGraphemes("abcdef", 0), "…");
  assert.equal(truncateGraphemes("abcdef", -3), "…");
});

test("cellDisplay: stringifies each JSON type", () => {
  assert.equal(cellDisplay(null).text, "");
  assert.equal(cellDisplay(undefined).text, "");
  assert.equal(cellDisplay("x").text, "x");
  assert.equal(cellDisplay(30).text, "30");
  assert.equal(cellDisplay(true).text, "true");
  assert.equal(cellDisplay({ a: 1 }).text, '{"a":1}');
  assert.equal(cellDisplay([1, 2]).text, "[1,2]");
});

test("cellDisplay: flattens newlines and tabs so a row stays one line", () => {
  assert.equal(cellDisplay("x\ny").text, "x y");
  assert.equal(cellDisplay("a\r\n\tb").text, "a b");
});

test("cellDisplay: flattens the rest of the vertical whitespace class", () => {
  // \f, \v and the Unicode line/paragraph separators break a row the same way
  // \n does in a renderer that honours them, so they belong in the same class.
  assert.equal(cellDisplay("a\fb").text, "a b");
  assert.equal(cellDisplay("a\vb").text, "a b");
  assert.equal(cellDisplay("a\u2028b").text, "a b");
  assert.equal(cellDisplay("a\u2029b").text, "a b");
});

test("cellDisplay: escapes pipes after truncating, never leaving a stray backslash", () => {
  assert.equal(cellDisplay("a|b").text, "a\\|b");
  // 24 pipes: truncation runs on the raw text, so the cut cannot land inside
  // an escape sequence that does not exist yet.
  const cell = cellDisplay("|".repeat(30));
  assert.ok(!cell.text.endsWith("\\"));
  assert.equal(cell.truncated, true);
});

test("cellDisplay: truncation boundary is exactly MAX_CELL", () => {
  const at = cellDisplay("a".repeat(24));
  assert.equal(at.truncated, false);
  assert.equal(graphemeLength(at.text), 24);
  const over = cellDisplay("a".repeat(25));
  assert.equal(over.truncated, true);
  assert.equal(graphemeLength(over.text), 24);
});

test("jsonToTable: objects render aligned, numbers right-aligned", () => {
  assert.equal(
    jsonToTable('[{"name":"alice","role":"admin","age":30},{"name":"bob","role":"user","age":7}]'),
    [
      "| name  | role  | age |",
      "|-------|-------|----:|",
      "| alice | admin |  30 |",
      "| bob   | user  |   7 |",
    ].join("\n"),
  );
});

test("jsonToTable: missing keys render blank, keys keep first-seen order", () => {
  assert.equal(
    jsonToTable('[{"a":1,"b":2},{"a":3}]'),
    ["| a | b |", "|--:|--:|", "| 1 | 2 |", "| 3 |   |"].join("\n"),
  );
});

test("jsonToTable: arrays get synthetic c1..cn headers and ragged rows padded", () => {
  assert.equal(
    jsonToTable("[[1,2,3],[4,5]]"),
    ["| c1 | c2 | c3 |", "|---:|---:|---:|", "|  1 |  2 |  3 |", "|  4 |  5 |    |"].join("\n"),
  );
});

test("jsonToTable: numeric-looking STRINGS stay left-aligned", () => {
  // Detection is on the JSON type, not a regex — "30" is a string.
  assert.equal(
    jsonToTable('[{"n":"30"},{"n":"7"}]'),
    ["| n  |", "|----|", "| 30 |", "| 7  |"].join("\n"),
  );
});

test("jsonToTable: pipes escaped, newlines flattened", () => {
  assert.equal(
    jsonToTable('[{"v":"a|b"},{"v":"x\\ny"}]'),
    ["| v    |", "|------|", "| a\\|b |", "| x y  |"].join("\n"),
  );
});

test("jsonToTable: nested values are JSON-stringified", () => {
  assert.equal(
    jsonToTable('[{"o":{"a":1},"arr":[1,2]}]'),
    ["| o       | arr   |", "|---------|-------|", '| {"a":1} | [1,2] |'].join("\n"),
  );
});

test("jsonToTable: truncation adds a footer counting shortened cells", () => {
  assert.equal(
    jsonToTable('[{"url":"https://example.com/a/very/long/path/here"}]'),
    [
      "| url                      |",
      "|--------------------------|",
      "| https://example.com/a/v… |",
      "",
      "… 1 cell(s) shortened to fit",
    ].join("\n"),
  );
  assert.ok(!jsonToTable('[{"a":1}]').includes("shortened"));
});

test("jsonToTable: every rendered line has equal display width, Thai included", () => {
  // The real alignment invariant. Terminal output of Thai is deceptive —
  // measure, do not eyeball.
  const table = jsonToTable('[{"ชื่อ":"เสี่ยวเอ้อ","n":1},{"ชื่อ":"bob","n":22}]');
  const widths = new Set(
    table.split("\n").filter((l) => l.startsWith("|")).map(graphemeLength),
  );
  assert.equal(widths.size, 1);
  assert.equal([...widths][0], 16);
});

test("jsonToTable: a truncated HEADER counts toward the footer tally", () => {
  // A shortened header renames the user's column — the case they most need
  // told about, so headers go through the same pipeline and the same count.
  assert.equal(
    jsonToTable('[{"a_very_long_header_name_that_overflows":1}]'),
    [
      "| a_very_long_header_name… |",
      "|-------------------------:|",
      "|                        1 |",
      "",
      "… 1 cell(s) shortened to fit",
    ].join("\n"),
  );
});

test("jsonToTable: null and undefined cells render blank", () => {
  assert.equal(
    jsonToTable('[{"a":null,"b":1},{"a":2,"b":null}]'),
    ["| a | b |", "|--:|--:|", "|   | 1 |", "| 2 |   |"].join("\n"),
  );
});

test("jsonToTable: rejects bad shapes and column-less input", () => {
  assert.throws(() => jsonToTable("[]"), /non-empty JSON array/);
  assert.throws(() => jsonToTable("[1,2]"), /array of objects or an array of arrays/);
  assert.throws(() => jsonToTable("[{},{}]"), /No columns found/);
});

test("jsonToTable: empty positional rows are column-less too", () => {
  // A distinct path from [{},{}]: the count comes from Math.max over row
  // lengths, not from keys.length, so the object case does not pin it.
  assert.throws(() => jsonToTable("[[]]"), /No columns found/);
  assert.throws(() => jsonToTable("[[],[]]"), /No columns found/);
});

test("jsonToTable: one boolean disqualifies an otherwise numeric column", () => {
  // Alignment is a whole-column property — a single non-number drops the
  // column back to left-aligned rather than right-aligning the numbers alone.
  assert.equal(
    jsonToTable('[{"n":1},{"n":true}]'),
    ["| n    |", "|------|", "| 1    |", "| true |"].join("\n"),
  );
});

test("jsonToTable: an all-null column is not numeric", () => {
  // isNumericColumn requires at least one real number; null-only never
  // qualifies, so the separator stays --- and not --:.
  assert.equal(
    jsonToTable('[{"a":null,"b":1},{"a":null,"b":2}]'),
    ["| a | b |", "|---|--:|", "|   | 1 |", "|   | 2 |"].join("\n"),
  );
});
