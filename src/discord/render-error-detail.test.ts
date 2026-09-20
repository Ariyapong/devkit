import { test } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import { renderErrorDetail } from "./render-error-detail.js";
import { locateJsonError, formatYamlError } from "../json/index.js";
import rowsJson from "./fixtures/today-errors.json" with { type: "json" };

interface Row { kind: "json" | "yaml"; input: string; today: string }
const rows = rowsJson as Row[];

for (const row of rows) {
  test(`message + renderErrorDetail reproduces today's ${row.kind} error for ${JSON.stringify(row.input).slice(0, 40)}`, () => {
    let located: { message: string; detail?: Parameters<typeof renderErrorDetail>[0] } | null = null;
    if (row.kind === "json") {
      try { JSON.parse(row.input); } catch (error) { located = locateJsonError(row.input, error); }
    } else {
      try { YAML.parse(row.input); } catch (error) { located = formatYamlError(error); }
    }
    assert.ok(located, "the input must still fail to parse");
    assert.equal(located.message + (located.detail ? renderErrorDetail(located.detail) : ""), row.today);
  });
}

test("renderErrorDetail: no position line when the producer set none", () => {
  assert.equal(renderErrorDetail({ kind: "excerpt", lines: ["a", "^"], caretLine: 1 }), "\n```\na\n^\n```");
});

// The three Discord-policy tests moved from src/json/json-error.test.ts —
// `locateJsonError` itself is Discord-free; the fence and the size bound are
// `renderErrorDetail`'s doctrine, so they belong here, composed through it.

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

test("locateJsonError fences the excerpt so the caret can align", () => {
  // The error path sends bare content through replySafe — no sendResult, no
  // lang — and Discord renders bare content proportionally. Without its own
  // fence the caret lines up under nothing.
  const out = locate(BROKEN);
  const lines = out.split("\n");
  assert.equal(lines.filter((l) => l === "```").length, 2);
  assert.equal(lines.at(-1), "```");
  assert.ok(!lines[0]!.startsWith("```"));
});

test("a long neighbour line cannot blow the reply size limit", () => {
  // The error path is replySafe (src/index.ts) — no attachment fallback and a
  // swallowed catch — so an over-long reply is rejected by Discord and the
  // user sees "did not respond" instead of an error. Every printed line must
  // be bounded, not just the one that gets windowed around the column.
  const blob = "x".repeat(1900);
  const out = locate(`{\n  "big": "${blob}",\n  "bad" 1\n}`);
  assert.ok(out.length < 1900, `reply was ${out.length} chars`);
  assert.ok(out.includes("…"));
});

test("the whole message stays bounded on a pathological payload", () => {
  const out = locate(`{\n  "a": "${"y".repeat(3000)}"\n  "b": 1\n}`);
  assert.ok(out.length < 1900, `reply was ${out.length} chars`);
});
