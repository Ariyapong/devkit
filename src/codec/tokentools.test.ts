import { test } from "node:test";
import assert from "node:assert/strict";
import { alphabetFor, generateTokens } from "./tokentools.js";
import { InputError } from "../errors.js";

// Deterministic RNG cycling 0,1,2,… mod max — samples the whole alphabet.
function cyclingRng() {
  let k = 0;
  return (max: number) => k++ % max;
}

test("generateTokens: exact length and count", () => {
  const rng = () => 0; // always the first alphabet char
  const { tokens } = generateTokens(
    { type: "hex", length: 8, count: 3, unambiguous: false },
    rng,
  );
  assert.equal(tokens.length, 3);
  for (const t of tokens) assert.equal(t, "00000000"); // hex[0] === "0"
});

test("generateTokens: characters come only from the alphabet", () => {
  const alphabet = alphabetFor("password", false);
  const { tokens } = generateTokens(
    { type: "password", length: 100, count: 1, unambiguous: false },
    cyclingRng(),
  );
  for (const ch of tokens[0]!) assert.ok(alphabet.includes(ch), `stray char ${ch}`);
});

test("generateTokens: unambiguous excludes look-alikes (alphanumeric)", () => {
  const { tokens } = generateTokens(
    { type: "alphanumeric", length: 114, count: 1, unambiguous: true },
    cyclingRng(),
  );
  for (const bad of ["0", "O", "1", "l", "I"]) {
    assert.ok(!tokens[0]!.includes(bad), `should not contain ${bad}`);
  }
});

test("alphabetFor: unambiguous is ignored for hex/base64/base64url", () => {
  assert.equal(alphabetFor("hex", true), alphabetFor("hex", false));
  assert.equal(alphabetFor("base64url", true), alphabetFor("base64url", false));
});

test("generateTokens: entropy bits", () => {
  assert.equal(
    generateTokens({ type: "base64url", length: 32, count: 1, unambiguous: false }, () => 0).bits,
    192,
  );
  assert.equal(
    generateTokens({ type: "hex", length: 8, count: 1, unambiguous: false }, () => 0).bits,
    32,
  );
});

test("generateTokens: entropy bits reflect the reduced unambiguous alphabet", () => {
  // alphanumeric 62 → 57 after removing 0 O 1 l I; 10 chars × log2(57) ≈ 58.3 bits,
  // NOT the 59.5 you'd get from the full 62-char alphabet.
  const { bits } = generateTokens(
    { type: "alphanumeric", length: 10, count: 1, unambiguous: true },
    () => 0,
  );
  assert.equal(bits, 58.3);
});

test("generateTokens: bounds throw InputError", () => {
  assert.throws(
    () => generateTokens({ type: "hex", length: 7, count: 1, unambiguous: false }),
    InputError,
  );
  assert.throws(
    () => generateTokens({ type: "hex", length: 8, count: 11, unambiguous: false }),
    InputError,
  );
});

test("generateTokens: the default RNG stays inside the alphabet over 1,000 tokens", () => {
  const alphabet = new Set(alphabetFor("alphanumeric", false));
  for (let i = 0; i < 100; i++) {
    const { tokens } = generateTokens({ type: "alphanumeric", length: 16, count: 10, unambiguous: false });
    for (const t of tokens) {
      assert.equal(t.length, 16);
      for (const ch of t) assert.ok(alphabet.has(ch), ch);
    }
  }
});
