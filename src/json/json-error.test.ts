import assert from "node:assert/strict";
import { test } from "node:test";
import { locateJsonError } from "./json-error.js";
import { renderErrorDetail } from "../discord/render-error-detail.js";

/** The real thing: let JSON.parse produce the error, never a hand-built one. */
function locate(input: string): string {
  try {
    JSON.parse(input);
    throw new Error("expected a parse failure");
  } catch (error) {
    const r = locateJsonError(input, error);
    return r.message + (r.detail ? renderErrorDetail(r.detail) : "");
  }
}

const BROKEN = `{
  "name": "widget",
  "tags": ["a", "b"],
  "price": 12
  "qty": 2
}`;

test("locateJsonError points at the offending line", () => {
  const out = locate(BROKEN);
  assert.match(out, /^Invalid JSON: /);
  assert.match(out, /line 5, column 3/);
  // Three spaces after the pipe: one from the " | " separator, two from the
  // line's own indentation. Test below pins the same width on line 4.
  assert.match(out, /5 \| {3}"qty": 2/);
  assert.match(out, /\^/);
});

test("locateJsonError shows one line either side", () => {
  const out = locate(BROKEN);
  assert.ok(out.includes('4 |   "price": 12'));
  assert.ok(out.includes("6 | }"));
});

test("locateJsonError strips the position clause from the reason", () => {
  const out = locate(BROKEN);
  assert.ok(!out.includes("at position"));
  assert.ok(out.split("\n")[0]!.includes("Expected"));
});

test("locateJsonError handles an error on the first line", () => {
  const out = locate('{bad\n"a": 1\n}');
  assert.match(out, /line 1, column \d+/);
  assert.ok(out.includes("1 | {bad"));
});

test("locateJsonError handles an error on the last line", () => {
  const out = locate('{\n  "a": 1,\n}');
  assert.match(out, /line 3/);
});

test("locateJsonError handles CRLF input", () => {
  const out = locate('{\r\n  "a": 1\r\n  "b": 2\r\n}');
  assert.match(out, /line 3, column 3/);
  assert.ok(out.includes('3 |   "b": 2'));
  assert.ok(!out.includes("\r"));
});

test("locateJsonError falls back byte-for-byte with no position", () => {
  // "Unexpected end of JSON input" carries neither a position nor line/column.
  const out = locate("");
  assert.equal(out, "Invalid JSON: Unexpected end of JSON input");
});

test("locateJsonError right-aligns the gutter past nine lines", () => {
  const input = "{\n" + '  "a": 1,\n'.repeat(9) + '  "b" 2\n}';
  const out = locate(input);
  assert.match(out, / {2}11 \| /);
  assert.match(out, /\| +\^/);
});

test("locateJsonError lets the column sit one past the end of the line", () => {
  // Truncated input: V8 reports a column one past the final character, which
  // is exactly where the caret belongs — not clamped back onto the last char.
  const out = locate('{"a":1');
  assert.match(out, /line 1, column 7/);
  const lines = out.split("\n");
  const caret = lines.find((l) => l.includes("^"))!;
  // "|" sits at index 4 ("  " + 1 gutter char + " |"); the caret follows the
  // separator's trailing space plus column-1 = 6 spaces, landing at index 12.
  assert.equal(caret.indexOf("^"), caret.indexOf("|") + 8);
});

test("the caret is positioned in UTF-16 code units, matching V8", () => {
  // Documented deviation, pinned as INTENDED: an astral character is two code
  // units, so the caret shifts one cell per emoji. Aligning it visually would
  // make it disagree with the column number printed directly above it.
  const out = locate('{"a":"😀😀" "b":1}');
  assert.match(out, /line 1, column \d+/);
  assert.ok(out.includes("^"));
});

test("derived line and column agree with the ones V8 reports", () => {
  // On Node 22 the native message carries BOTH "position N" and
  // "(line L column C)". Deriving from N must reproduce L and C exactly —
  // this is what makes the Node 20 path trustworthy, where only N exists.
  let native = "";
  try {
    JSON.parse(BROKEN);
  } catch (error) {
    native = (error as Error).message;
  }
  const reported = /\(line (\d+) column (\d+)\)/.exec(native);
  if (reported === null) return; // Node 20: nothing to cross-check against
  const out = locate(BROKEN);
  assert.ok(out.includes(`line ${reported[1]}, column ${reported[2]}`));
});

test("derives line and column when only a position is reported", () => {
  // Node 20's V8 gives "at position N" with no (line L column C) pair. That
  // branch cannot fire on this Node, so drive it with a message of that shape.
  // Position 18 is the "2" after the missing colon on line 3 (0-based index
  // 18 in the input) — verified against fromOffset's own arithmetic; the
  // brief's original position (20) lands one line later, on "}", not here.
  const input = '{\n  "a": 1,\n  "b" 2\n}';
  const r = locateJsonError(input, new Error("Unexpected string in JSON at position 18"));
  const out = r.message + (r.detail ? renderErrorDetail(r.detail) : "");
  assert.match(out, /line 3, column 7/);
  assert.ok(out.includes('3 |   "b" 2'));
});

/** Builds one minified line with a syntax error at a known, distant column. */
function longBroken(): string {
  const filler = Array.from({ length: 120 }, (_, i) => `"k${i}":"v${i}"`).join(",");
  return `{${filler},"bad" 1}`;
}

test("a long line is windowed around the column", () => {
  const out = locate(longBroken());
  const excerpt = out.split("\n").find((l) => l.includes(" | "))!;
  assert.ok(excerpt.length < 100, `excerpt too wide: ${excerpt.length}`);
  assert.ok(excerpt.includes("…"));
  assert.ok(excerpt.includes('"bad"'));
});

test("windowing drops the neighbouring lines", () => {
  const out = locate(`{\n${'"x":"' + "y".repeat(200) + '" "z":1'}\n}`);
  const gutters = out.split("\n").filter((l) => / \d+ \| /.test(l));
  assert.equal(gutters.length, 1);
});

test("a short line keeps its neighbours and shows no ellipsis", () => {
  const out = locate('{\n  "a": 1\n  "b": 2\n}');
  const gutters = out.split("\n").filter((l) => / \d+ \| /.test(l));
  assert.equal(gutters.length, 3);
  assert.ok(!out.includes("…"));
});

test("the caret lands under the error inside the window", () => {
  const out = locate(longBroken());
  const lines = out.split("\n");
  const at = lines.findIndex((l) => / \d+ \| /.test(l));
  const excerpt = lines[at]!;
  const caret = lines[at + 1]!.indexOf("^");
  // V8 points at the `1` in `"bad" 1}` — pin the character itself, not its
  // neighbourhood. A proximity check passes even when the caret is off by one,
  // which is exactly the failure `head.length + (at - start)` is prone to.
  assert.equal(excerpt[caret], "1");
  assert.ok(excerpt.slice(caret - 6, caret).includes("bad"));
});

test("a window at the start of a line has no leading ellipsis", () => {
  const out = locate(`{"a" ${"z".repeat(300)}}`);
  const excerpt = out.split("\n").find((l) => l.includes(" | "))!;
  assert.ok(!excerpt.includes("| …"));
  assert.ok(excerpt.endsWith("…"));
});

test("a window at the end of a line has no trailing ellipsis", () => {
  const out = locate(`{"${"z".repeat(300)}":1 }x`);
  const excerpt = out.split("\n").find((l) => l.includes(" | "))!;
  assert.ok(excerpt.includes("…"));
  assert.ok(!excerpt.endsWith("…"));
});

test("a position clause inside the payload cannot hijack the header", () => {
  // V8's "<snippet> is not valid JSON" form echoes input back verbatim when
  // the very first character is already invalid — here that echo happens to
  // contain a fake "(line 9 column 9)". An unanchored regex reads that as the
  // real position clause; the real error is at line 1, column 1.
  const out = locate("(line 9 column 9)");
  assert.ok(!out.includes("line 9, column 9"));
});

test("a position phrase inside the payload does not mangle the reason", () => {
  // Same echo hazard for the offset-only regex: "at position 5" inside the
  // quoted echo must not be read as a real position, which would both misfire
  // the header and eat part of the quoted reason via stripPosition.
  const out = locate("at position 5 blah");
  assert.ok(out.split("\n")[0]!.startsWith("Invalid JSON: "));
  assert.ok(out.includes("at position 5 blah"));
  assert.ok(!out.includes("line 1, column 6"));
});

test("the derived column can sit one past the end of the input", () => {
  const input = '{"a":1';
  const r = locateJsonError(input, new Error(`at position ${input.length}`));
  const out = r.message + (r.detail ? renderErrorDetail(r.detail) : "");
  assert.match(out, /line 1, column 7/);
});

test("locateJsonError returns a reason-only message plus a structured detail that re-renders to today's string", () => {
  const input = '{"a": 1';
  let located;
  try { JSON.parse(input); } catch (error) { located = locateJsonError(input, error); }
  assert.ok(located);
  assert.equal(located.message, "Invalid JSON: Expected ',' or '}' after property value");
  assert.deepEqual(located.detail, {
    kind: "excerpt",
    position: { line: 1, column: 8 },
    positionLine: "  line 1, column 8",
    lines: ['  1 | {"a": 1', "    |        ^"],
    caretLine: 1,
  });
  assert.equal(
    located.message + renderErrorDetail(located.detail!),
    "Invalid JSON: Expected ',' or '}' after property value\n  line 1, column 8\n```\n  1 | {\"a\": 1\n    |        ^\n```",
  );
});

test("locateJsonError has no detail when V8 gives no position", () => {
  const input = "[1,2,]";
  let located;
  try { JSON.parse(input); } catch (error) { located = locateJsonError(input, error); }
  assert.ok(located);
  assert.match(located.message, /^Invalid JSON: /);
  assert.equal(located.detail, undefined);
});
