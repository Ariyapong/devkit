import { test } from "node:test";
import assert from "node:assert/strict";
import { findCron } from "./find-cron.js";

test("findCron: bare 5-field line surrounded by words", () => {
  assert.equal(findCron("run */5 * * * * please"), "*/5 * * * *");
});

test("findCron: 6-field cron wins over its 5-field prefix", () => {
  assert.equal(findCron("0 30 9 * * 1"), "0 30 9 * * 1");
});

test("findCron: inside a code fence", () => {
  assert.equal(findCron("```\n*/10 * * * *\n```"), "*/10 * * * *");
});

test("findCron: single-line fence", () => {
  assert.equal(findCron("```0 0 * * *```"), "0 0 * * *");
});

test("findCron: no cron", () => {
  assert.equal(findCron("just a normal sentence with words"), null);
});

test("findCron: attempt cap stops the scan", () => {
  const garbage = "a b c d e\n".repeat(40); // 40 five-token windows = 40 attempts
  assert.equal(findCron(garbage + "*/5 * * * *"), null);
});

test("findCron: a cron past the 2000-char scan window is not found", () => {
  const pad = "x\n".repeat(1001); // 2002 chars of single-token lines — spends zero attempts
  assert.equal(findCron(pad + "*/5 * * * *"), null); // sliced off before it is scanned
  assert.equal(findCron("*/5 * * * *\n" + pad), "*/5 * * * *"); // same cron, within the window
});
