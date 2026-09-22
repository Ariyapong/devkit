import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, sanitizeError } from "./errors.js";
import type { ErrorDetail } from "./errors.js";
import * as errorsModule from "./errors.js";
import * as root from "./index.js";

test("./errors is its own subpath: exactly InputError + sanitizeError, the SAME class the root exports", () => {
  // A consumer of one domain subpath (or of nothing but the error class — the
  // bot's errors.ts) must be able to `instanceof InputError` without loading
  // the root barrel's whole graph. The identity pin is the "one class per
  // process" rule: a duplicated class would make every catch in the bot miss.
  assert.deepEqual(Object.keys(errorsModule).sort(), ["InputError", "sanitizeError"]);
  assert.equal(root.InputError, errorsModule.InputError);
  assert.equal(root.sanitizeError, errorsModule.sanitizeError);

  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    exports: Record<string, { types: string; default: string }>;
  };
  assert.deepEqual(pkg.exports["./errors"], { types: "./dist/errors.d.ts", default: "./dist/errors.js" });
});

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
