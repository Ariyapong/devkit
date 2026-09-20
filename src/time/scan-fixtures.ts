import type { FixtureTable } from "../scan/output-scan.js";

// 2026-08-16T07:00:00Z — reused across the fixtures below for consistency.
const KNOWN_EPOCH_S = 1786863600;
const KNOWN_DATE = new Date(KNOWN_EPOCH_S * 1000);

export const fixtures: FixtureTable = {
  // Throws when the numeric input can't resolve to a real instant (NaN
  // propagates through `ms = value * 1000` into an Invalid Date).
  epochInfo: { returns: [[KNOWN_EPOCH_S], []], throws: [[NaN]] },
  // Brief-specified throws case.
  isoInfo: { returns: [["2026-08-16T07:00:00Z"]], throws: [["not a date"]] },
  // The brief's proposed throws case ("25:99") does NOT throw: TIME_RE only
  // checks shape (\d{1,2}:\d{2}), not range, so Date.UTC silently overflows
  // 25:99 into the next day rather than rejecting it (verified live). "noon"
  // matches neither FULL_RE nor TIME_RE and is the throwing case already
  // proven in timetools.test.ts's "convertTz rejects bad time".
  convertTz: { returns: [["15:00", "Asia/Bangkok", "UTC"]], throws: [["noon", "UTC", "UTC"]] },
  // Brief-specified throws case.
  explainCron: { returns: [["*/5 * * * *"]], throws: [["not cron"]] },
  // Pure string assembly over an already-shaped result — no validation, so it
  // cannot throw given a well-formed argument.
  renderCron: { returns: [[{ text: "Every 5 minutes", tz: "UTC", nextRuns: ["2026-08-16 07:05", "2026-08-16 07:10"] }]], throws: "never" },
  // Brief-specified throws case.
  parseStamp: { returns: [["+5m"]], throws: [["garbage"]] },
  // Brief-specified throws case.
  assertZone: { returns: [["Asia/Bangkok"]], throws: [["Mars/Olympus"]] },
  // Delegates zone validation to assertZone, so a bad zone throws the same
  // InputError — not called out in the brief's throws list, but confirmed by
  // reading the body before writing "never".
  formatInZone: { returns: [[KNOWN_DATE, "Asia/Bangkok"]], throws: [[KNOWN_DATE, "Mars/Olympus"]] },
  // Brief-specified case: every parser is wrapped in its own try/catch and
  // returns null on failure, so no exception ever reaches the caller.
  detectTime: {
    returns: [["meet at 2026-09-19T10:00:00Z", { tier: "strict" }], ["nothing here", { tier: "loose" }]],
    throws: "never",
  },
  // Every candidate window is tried through a local try/catch around
  // explainCron; a non-match falls through to the next window, never throws.
  findCron: { returns: [["*/5 * * * *"]], throws: "never" },
  // Plain arithmetic over a number — nothing to validate, nothing to throw.
  relativeTime: { returns: [[45_000]], throws: "never" },
};
