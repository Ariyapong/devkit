import { test } from "node:test";
import assert from "node:assert/strict";
import { collectStrings, findForbidden } from "./output-scan.js";

test("collectStrings walks arrays, objects and Maps to every string leaf", () => {
  const m = new Map([["k", "v"]]);
  assert.deepEqual(collectStrings({ a: "x", b: ["y", { c: "z" }], d: m, e: 1 }).sort(), ["v", "x", "y", "z"]);
});

test("findForbidden flags fences, line-leading subtext and timestamp tags, tolerates result emoji", () => {
  assert.equal(findForbidden("✅ ok"), null);
  assert.equal(findForbidden("a\n-# note"), "-# ");
  assert.equal(findForbidden("x -# not at line start"), null);
  assert.equal(findForbidden("```\ncode\n```"), "```");
  assert.equal(findForbidden("at <t:1700000000:f>"), "<t:");
});
