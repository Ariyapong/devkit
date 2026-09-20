import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeTime } from "./relative-time.js";

test("relativeTime: seconds, minutes, hours+minutes, days", () => {
  assert.equal(relativeTime(45_000), "45s");
  assert.equal(relativeTime(12 * 60_000), "12m");
  assert.equal(relativeTime((3 * 60 + 12) * 60_000), "3h 12m");
  assert.equal(relativeTime(5 * 24 * 3_600_000), "5d");
});
