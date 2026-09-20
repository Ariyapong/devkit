import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRange,
  compareVersions,
  renderCompare,
} from "./semvertools.js";
import { InputError } from "../errors.js";

test("checkRange: version inside a caret range", () => {
  const r = checkRange("^4.2.0", "4.5.1");
  assert.equal(r.satisfied, true);
  assert.equal(r.version, "4.5.1");
  assert.equal(r.range, "^4.2.0");
  assert.ok(r.expanded.startsWith(">=4.2.0"), r.expanded);
});

test("checkRange: version outside the range", () => {
  assert.equal(checkRange("^4.2.0", "5.0.0").satisfied, false);
});

test("checkRange: loose input — leading v is accepted", () => {
  assert.equal(checkRange("~1.2.0", "v1.2.9").satisfied, true);
});

test("checkRange: invalid range names the bad side", () => {
  assert.throws(() => checkRange("^^nope", "1.0.0"), (e: unknown) => {
    assert.ok(e instanceof InputError);
    assert.match(e.message, /range/i);
    return true;
  });
});

test("checkRange: invalid version names the bad side", () => {
  assert.throws(() => checkRange("^1.0.0", "banana"), (e: unknown) => {
    assert.ok(e instanceof InputError);
    assert.match(e.message, /version/i);
    return true;
  });
});

test("compareVersions: newer/older with bump level", () => {
  const c = compareVersions("1.2.3", "1.3.0");
  assert.equal(c.order, -1);
  assert.equal(c.diff, "minor");
});

test("compareVersions: equal versions", () => {
  const c = compareVersions("v2.0.0", "2.0.0");
  assert.equal(c.order, 0);
  assert.equal(c.diff, null);
});

test("renderCompare: names the newer version and the bump", () => {
  const line = renderCompare(compareVersions("1.2.3", "1.3.0"));
  assert.match(line, /1\.3\.0/);
  assert.match(line, /minor/);
});

test("renderCompare: equal versions say so", () => {
  assert.match(renderCompare(compareVersions("1.0.0", "1.0.0")), /equal/i);
});
