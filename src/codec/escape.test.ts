import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { escapeJsonString, escapeRegex, unescapeJsonString } from "./escape.js";
import { InputError } from "../errors.js";

test("escapeJsonString is the JSON string body without quotes", () => {
  assert.equal(escapeJsonString('say "hi"\n\ttab'), 'say \\"hi\\"\\n\\ttab');
  assert.equal(escapeJsonString(""), "");
});

test("unescapeJsonString: the spec's canonical cases", () => {
  assert.equal(unescapeJsonString('a\\"b'), 'a"b');
  assert.equal(unescapeJsonString('say \\"hi\\"\nbye'), 'say "hi"\nbye'); // raw newline accepted
  assert.equal(unescapeJsonString("\\u0041"), "A");
  assert.equal(unescapeJsonString('\\\\"'), '\\"'); // escaped backslash then a raw quote
  assert.equal(unescapeJsonString("plain"), "plain");
  assert.equal(unescapeJsonString(""), "");
});

test("unescapeJsonString: bad backslash sequences throw InputError", () => {
  for (const bad of ["\\q", "\\u12", "trailing\\", "\\u\n0041", "\\\n"]) {
    assert.throws(() => unescapeJsonString(bad), (e) => e instanceof InputError && e.message === "Invalid escape sequence.", JSON.stringify(bad));
  }
});

test("unescapeJsonString(escapeJsonString(s)) === s over quotes, backslashes, controls, astral and lone surrogates", () => {
  const pool = ['"', "\\", "\n", "\r", "\t", "\u0000", "\u001f", "a", "é", "😀", "\ud83d", "\udc00", " "];
  for (let i = 0; i < 20_000; i++) {
    const n = randomBytes(1)[0]! % 12;
    let s = "";
    for (let j = 0; j < n; j++) s += pool[randomBytes(1)[0]! % pool.length]!;
    assert.equal(unescapeJsonString(escapeJsonString(s)), s, JSON.stringify(s));
  }
});

test("escapeRegex: the escaped string matches itself literally", () => {
  const samples = ["a.b*c", "[x](y){2}|z", "^$\\/?+", "สวัสดี😀", ""];
  for (const s of samples) {
    const re = new RegExp(`^${escapeRegex(s)}$`, "u");
    assert.ok(re.test(s), s);
  }
  assert.equal(escapeRegex("a.b"), "a\\.b");
  assert.ok(!new RegExp(escapeRegex("a.b")).test("axb"));
});
