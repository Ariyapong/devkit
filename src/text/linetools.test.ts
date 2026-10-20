import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LINES_CHARS, processLines } from "./linetools.js";
import { InputError } from "../errors.js";

test("processLines: no ops normalises line endings and drops one trailing newline", () => {
  assert.equal(processLines("a\r\nb\n", {}), "a\nb");
  assert.equal(processLines("a\nb\n\n", {}), "a\nb\n"); // only ONE trailing newline is dropped
});

test("processLines: empty and newline-only input return empty, even with number", () => {
  assert.equal(processLines("", { number: true }), "");
  assert.equal(processLines("\n", { number: true }), "");
});

test("processLines: each op alone", () => {
  assert.equal(processLines("  a \n\tb", { trim: true }), "a\nb");
  assert.equal(processLines("a\n\n  \nb", { dropBlank: true }), "a\n  \nb"); // blank means empty, not whitespace, unless trimmed
  assert.equal(processLines("a\n\n  \nb", { trim: true, dropBlank: true }), "a\nb");
  assert.equal(processLines("b\na\nb\nA", { dedupe: true }), "b\na\nA");
  assert.equal(processLines("b\na\nb\nA", { dedupe: true, caseInsensitive: true }), "b\na");
  assert.equal(processLines("b\nB\na", { sort: "asc" }), "B\na\nb"); // code-unit order
  assert.equal(processLines("b\nB\na", { sort: "asc", caseInsensitive: true }), "a\nb\nB"); // stable among equals
  assert.equal(processLines("a\nb", { sort: "desc" }), "b\na");
  assert.equal(processLines("file10\nfile2\nfile1", { sort: "natural" }), "file1\nfile2\nfile10");
  assert.equal(processLines("ccc\na\nbb", { sort: "length" }), "a\nbb\nccc");
  assert.equal(processLines("a\nb\nc", { reverse: true }), "c\nb\na");
  assert.equal(processLines("a\nb", { number: true }), "1  a\n2  b");
});

test("processLines: number pads to the width of the total and survives CRLF", () => {
  const input = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\r\n");
  const out = processLines(input, { number: true });
  assert.equal(out.split("\n")[0], " 1  l0");
  assert.equal(out.split("\n")[9], "10  l9");
  assert.ok(!out.includes("\r"));
});

test("processLines: the pipeline order is trim → dropBlank → dedupe → sort → reverse → number", () => {
  const out = processLines(" b \n\n a\nb\n", { trim: true, dropBlank: true, dedupe: true, sort: "asc", reverse: true, number: true });
  assert.equal(out, "1  b\n2  a");
});

test("processLines: input over the cap throws", () => {
  const big = "x".repeat(MAX_LINES_CHARS + 1);
  assert.throws(() => processLines(big, {}), (e) => e instanceof InputError && e.message === `Too long — process at most ${MAX_LINES_CHARS} UTF-16 units (got ${big.length}).`);
  assert.doesNotThrow(() => processLines("x".repeat(MAX_LINES_CHARS), {}));
});

test("processLines: a lone \\r is a line break and one trailing terminator of any kind is dropped", () => {
  assert.equal(processLines("a\rb", {}), "a\nb");
  assert.equal(processLines("a\r", {}), "a");
  assert.equal(processLines("a\r\nb\rc\nd", {}), "a\nb\nc\nd");
  assert.equal(processLines("a\r\r", {}), "a\n");
});
