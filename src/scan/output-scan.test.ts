import { test } from "node:test";
import assert from "node:assert/strict";
import { collectStrings, findForbidden, checkEntry } from "./output-scan.js";
import { InputError } from "../errors.js";

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

test("checkEntry: a sync export that returns clean text passes", async () => {
  const out = await checkEntry("f", () => "✅ fine", { returns: [[]], throws: "never" });
  assert.deepEqual(out, []);
});

test("checkEntry: an async export's resolved strings are scanned", async () => {
  const out = await checkEntry("f", async () => ({ body: "a\n-# subtext" }), { returns: [[]], throws: "never" });
  assert.equal(out.length, 1);
  assert.match(out[0]!, /emitted -# /);
});

test("checkEntry: a returns-tagged async export that rejects is a violation", async () => {
  const out = await checkEntry("f", async () => { throw new InputError("bad"); }, { returns: [[]], throws: "never" });
  assert.equal(out.length, 1);
  assert.match(out[0]!, /tagged "returns" but threw/);
});

test("checkEntry: a throws-tagged async export must reject with an InputError", async () => {
  const good = await checkEntry("f", async () => { throw new InputError("bad"); }, { returns: [], throws: [[]] });
  assert.deepEqual(good, []);
  const bad = await checkEntry("f", async () => { throw new TypeError("nope"); }, { returns: [], throws: [[]] });
  assert.equal(bad.length, 1);
  assert.match(bad[0]!, /non-InputError/);
});

test("checkEntry: a throws-tagged case that resolves is a violation", async () => {
  const out = await checkEntry("f", async () => "ok", { returns: [], throws: [[]] });
  assert.equal(out.length, 1);
  assert.match(out[0]!, /tagged "throws" but returned/);
});
