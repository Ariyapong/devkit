import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTime, Duration } from "luxon";

// These pin the exact behaviours the design decisions rest on. If a Luxon
// upgrade changes any of them, the parser's rulings need revisiting — that is
// what this file exists to force. Measured 2026-08-16 against luxon 3.7.2.

test("RFC 2822 requires the weekday to agree with the date", () => {
  // 2026-08-16 is a Sunday. Luxon rejects the contradiction rather than
  // ignoring the weekday, so our detector reports a miss.
  assert.equal(DateTime.fromRFC2822("Sat, 16 Aug 2026 07:56:00 GMT").isValid, false);
  assert.equal(DateTime.fromRFC2822("Sun, 16 Aug 2026 07:56:00 GMT").isValid, true);
});

test("RFC 2822 accepts obsolete zone abbreviations but not military letters", () => {
  assert.equal(DateTime.fromRFC2822("Sun, 16 Aug 2026 07:56:00 EST").isValid, true);
  assert.equal(DateTime.fromRFC2822("Sun, 16 Aug 2026 07:56:00 PDT").isValid, true);
  // Accepted gap: single-letter military zones are not supported and we do not
  // hand-roll a table for them.
  assert.equal(DateTime.fromRFC2822("Sun, 16 Aug 2026 07:56:00 A").isValid, false);
});

test("fromISO rejects the log shapes, fromSQL accepts the space separator", () => {
  assert.equal(DateTime.fromISO("2026-08-16 07:56:00").isValid, false);
  assert.equal(DateTime.fromISO("2026-08-16 07:56:00,123").isValid, false);
  assert.equal(DateTime.fromSQL("2026-08-16 07:56:00").isValid, true);
});

test("a year duration is a flat 365 days, so Y and M are approximate", () => {
  assert.equal(Duration.fromISO("P1Y").toMillis(), 365 * 24 * 3600 * 1000);
  assert.equal(Duration.fromISO("PT5M").toMillis(), 300_000);
});

test("calendar fields match the values the design's sample block asserts", () => {
  const dt = DateTime.fromSeconds(1786863600).setZone("Asia/Bangkok");
  assert.equal(dt.weekNumber, 33);
  assert.equal(dt.ordinal, 228);
  assert.equal(dt.quarter, 3);
  assert.equal(dt.weekdayShort, "Sun");
});
