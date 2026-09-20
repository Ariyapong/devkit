import { test } from "node:test";
import assert from "node:assert/strict";
import { httpStatus } from "./http-status.js";

test("httpStatus lookup", () => {
  const entry = httpStatus(429);
  assert.ok(entry);
  assert.equal(entry.name, "Too Many Requests");
  assert.equal(entry.category, "Client error");
  assert.equal(httpStatus(999), null);
});
