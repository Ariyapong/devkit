import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, sanitizeError } from "./errors.js";
import type { ErrorDetail } from "./errors.js";

const DETAIL: ErrorDetail = {
  kind: "excerpt",
  position: { line: 1, column: 8 },
  positionLine: "  line 1, column 8",
  lines: ['  1 | {"a": 1', "    |        ^"],
  caretLine: 1,
};

test("InputError carries an optional structured detail", () => {
  const plain = new InputError("Invalid JSON: nope");
  assert.equal(plain.message, "Invalid JSON: nope");
  assert.equal(plain.detail, undefined);
  assert.equal(Object.hasOwn(plain, "detail"), false); // exactOptionalPropertyTypes: absent, not undefined

  const rich = new InputError("Invalid JSON: nope", DETAIL);
  assert.deepEqual(rich.detail, DETAIL);
  assert.ok(rich instanceof Error);
});

test("sanitizeError collapses an InputError to its class name — detail never reaches a log line", () => {
  assert.equal(sanitizeError(new InputError("payload {secret}", DETAIL)), "InputError");
});

test("sanitizeError keeps the first line of other errors, capped at 120", () => {
  assert.equal(sanitizeError(new Error("boom\nsecond")), "boom");
  assert.equal(sanitizeError("x".repeat(130)), `${"x".repeat(120)}…`);
  assert.equal(sanitizeError(42), "42");
});
