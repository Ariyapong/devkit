import { test } from "node:test";
import assert from "node:assert/strict";
import { randomIndex, type Rng } from "./random.js";

test("randomIndex: passes n straight through to the injected rng", () => {
  let seen = -1;
  const rng: Rng = (max) => {
    seen = max;
    return 0;
  };
  randomIndex(7, rng);
  assert.equal(seen, 7);
});

test("randomIndex: returns exactly what the injected rng returns", () => {
  assert.equal(randomIndex(10, () => 0), 0);
  assert.equal(randomIndex(10, () => 4), 4);
  assert.equal(randomIndex(10, () => 9), 9);
});

test("randomIndex: default rng yields an integer in [0, n)", () => {
  for (let i = 0; i < 100; i++) {
    const v = randomIndex(5);
    assert.ok(Number.isInteger(v), `expected integer, got ${v}`);
    assert.ok(v >= 0 && v < 5, `expected 0..4, got ${v}`);
  }
});

test("default rng stays in range", () => {
  for (let i = 0; i < 1000; i += 1) {
    const v = randomIndex(7);
    assert.ok(v >= 0 && v < 7);
  }
});
