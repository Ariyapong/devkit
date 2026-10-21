import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCookieDate } from "./cookie-date.js";

test("parseCookieDate: RFC 6265 cookie-date forms", () => {
  assert.equal(parseCookieDate("Wed, 21 Oct 2026 07:28:00 GMT"), Date.UTC(2026, 9, 21, 7, 28, 0));
  assert.equal(parseCookieDate("21 Oct 2026 07:28:00"), Date.UTC(2026, 9, 21, 7, 28, 0));
  assert.equal(parseCookieDate("Wednesday, 21-Oct-26 07:28:00 GMT"), Date.UTC(2026, 9, 21, 7, 28, 0));
  assert.equal(parseCookieDate("Sun, 06 Nov 94 08:49:37 GMT"), Date.UTC(1994, 10, 6, 8, 49, 37));
  assert.equal(parseCookieDate("Thu, 01 Jan 1970 00:00:00 GMT"), 0);
});
test("parseCookieDate: ISO fallback is UTC-only", () => {
  assert.equal(parseCookieDate("2026-10-21T07:28:00.000Z"), Date.UTC(2026, 9, 21, 7, 28, 0));
  assert.equal(parseCookieDate("2026-10-21T07:28:00+07:00"), Date.UTC(2026, 9, 21, 0, 28, 0));
  assert.equal(parseCookieDate("2026-10-21"), Date.UTC(2026, 9, 21));
  assert.equal(parseCookieDate("2026-10-21T07:28"), null);
  assert.equal(parseCookieDate("Dec 31 2026 23:59"), null);
});
test("parseCookieDate: garbage and out-of-range", () => {
  for (const bad of ["", "soon", "32 Oct 2026 00:00:00", "21 Oct 2026 25:00:00", "21 Oct 0999 00:00:00"]) assert.equal(parseCookieDate(bad), null);
});
