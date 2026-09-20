import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAnsi } from "./ansitools.js";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

test("stripAnsi: raw SGR color codes", () => {
  assert.equal(stripAnsi(`${ESC}[32mgreen${ESC}[0m plain`), "green plain");
});

test("stripAnsi: raw cursor and erase sequences", () => {
  assert.equal(stripAnsi(`${ESC}[2K${ESC}[1Gline`), "line");
});

test("stripAnsi: raw OSC title sequence (BEL-terminated)", () => {
  assert.equal(stripAnsi(`${ESC}]0;my title${BEL}after`), "after");
});

test("stripAnsi: raw OSC terminated by ESC backslash", () => {
  assert.equal(stripAnsi(`${ESC}]8;;https://x${ESC}\\link`), "link");
});

test("stripAnsi: literal backslash-x spelling", () => {
  assert.equal(stripAnsi("\\x1b[31mred\\x1b[0m"), "red");
});

test("stripAnsi: literal octal spelling", () => {
  assert.equal(stripAnsi("\\033[1;32mok\\033[0m"), "ok");
});

test("stripAnsi: literal backslash-u spelling", () => {
  const input = "\\" + "u001b[33mwarn" + "\\" + "u001b[0m";
  assert.equal(stripAnsi(input), "warn");
});

test("stripAnsi: caret spelling from pagers", () => {
  assert.equal(stripAnsi("^[[1;31mFAIL^[[0m build"), "FAIL build");
});

test("stripAnsi: bare caret-bracket in prose does not strip", () => {
  assert.equal(stripAnsi("array syntax ^[[ is weird"), "array syntax ^[[ is weird");
});

test("stripAnsi: plain text and Thai untouched", () => {
  assert.equal(stripAnsi("สวัสดี world"), "สวัสดี world");
});
