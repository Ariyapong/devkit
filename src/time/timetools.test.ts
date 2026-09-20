import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertZone,
  COMMON_ZONES,
  convertTz,
  epochInfo,
  explainCron,
  formatInZone,
  isoInfo,
  parseStamp,
  renderCron,
} from "./timetools.js";
import { InputError } from "../errors.js";

// 2026-07-20 15:00 Asia/Bangkok (UTC+7) === 2026-07-20T08:00:00Z
const KNOWN_EPOCH = 1784534400;

test("epochInfo detects seconds vs ms", () => {
  const fromSeconds = epochInfo(KNOWN_EPOCH);
  assert.equal(fromSeconds.detected, "seconds");
  assert.equal(fromSeconds.isoUtc, "2026-07-20T08:00:00.000Z");
  assert.equal(fromSeconds.bangkok, "2026-07-20 15:00");
  const fromMs = epochInfo(KNOWN_EPOCH * 1000);
  assert.equal(fromMs.detected, "ms");
  assert.equal(fromMs.seconds, KNOWN_EPOCH);
});

test("epochInfo without value uses now", () => {
  const info = epochInfo(undefined, KNOWN_EPOCH * 1000);
  assert.equal(info.detected, "now");
  assert.equal(info.seconds, KNOWN_EPOCH);
});

test("convertTz full-date form", () => {
  const result = convertTz("2026-01-15 12:00", "UTC", "Asia/Bangkok");
  assert.equal(result.output, "2026-01-15 19:00");
});

test("convertTz rejects bad zone", () => {
  assert.throws(() => convertTz("12:00", "Nope/Nowhere", "UTC"), InputError);
});

test("convertTz rejects bad time", () => {
  assert.throws(() => convertTz("noon", "UTC", "UTC"), InputError);
});

test("convertTz takes an injected now so a relative time is deterministic", () => {
  const now = Date.UTC(2026, 8, 19, 12, 0, 0);
  const a = convertTz("15:00", "Asia/Bangkok", "UTC", now);
  const b = convertTz("15:00", "Asia/Bangkok", "UTC", now);
  assert.deepEqual(a, b);
  assert.match(a.output, /08:00/);
});

test("explainCron", () => {
  const result = explainCron("*/5 * * * *");
  assert.ok(result.text.toLowerCase().includes("every 5 minutes"));
  assert.equal(result.tz, "Asia/Bangkok");
  assert.equal(result.nextRuns.length, 3);
  assert.match(result.nextRuns[0]!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("explainCron rejects invalid expression", () => {
  assert.throws(() => explainCron("not a cron"), InputError);
});

test("parseStamp absolute (Bangkok assumed)", () => {
  assert.equal(parseStamp("2026-07-20 15:00"), KNOWN_EPOCH);
});

test("parseStamp relative", () => {
  assert.equal(parseStamp("+2h", undefined, KNOWN_EPOCH * 1000), KNOWN_EPOCH + 7200);
  assert.throws(() => parseStamp("later"), InputError);
});

test("parseStamp absolute with tz", () => {
  // 15:00 New York (UTC-4 in July) is 11 hours after 15:00 Bangkok (UTC+7)
  assert.equal(
    parseStamp("2026-07-20 15:00", "America/New_York"),
    KNOWN_EPOCH + 11 * 3600,
  );
});

test("parseStamp relative ignores tz (the instant is zone-independent)", () => {
  assert.equal(
    parseStamp("+2h", "America/New_York", KNOWN_EPOCH * 1000),
    KNOWN_EPOCH + 7200,
  );
});

test("parseStamp rejects unknown tz", () => {
  assert.throws(() => parseStamp("2026-07-20 15:00", "Bangkok"), InputError);
});

test("formatInZone", () => {
  assert.equal(
    formatInZone(new Date("2026-07-20T08:00:00Z"), "Asia/Bangkok"),
    "2026-07-20 15:00",
  );
});

test("COMMON_ZONES includes the defaults", () => {
  assert.ok(COMMON_ZONES.includes("UTC"));
  assert.ok(COMMON_ZONES.includes("Asia/Bangkok"));
});

test("renderCron: description, tz, bulleted runs", () => {
  const body = renderCron({
    text: "Every 5 minutes",
    tz: "Asia/Bangkok",
    nextRuns: ["2026-07-18 19:00", "2026-07-18 19:05", "2026-07-18 19:10"],
  });
  assert.equal(
    body,
    [
      "**Every 5 minutes** (Asia/Bangkok)",
      "Next runs:",
      "• 2026-07-18 19:00",
      "• 2026-07-18 19:05",
      "• 2026-07-18 19:10",
    ].join("\n"),
  );
});

// 2026-07-26 08:30 Asia/Bangkok (UTC+7) === 2026-07-26T01:30:00Z
const ISO_EPOCH = 1785029400;

test("isoInfo: full ISO with offset", () => {
  const info = isoInfo("2026-07-26T08:30:00+07:00");
  assert.equal(info.seconds, ISO_EPOCH);
  assert.equal(info.ms, ISO_EPOCH * 1000);
  assert.equal(info.isoUtc, "2026-07-26T01:30:00.000Z");
  assert.equal(info.bangkok, "2026-07-26 08:30");
  assert.equal(info.readAs, "offset +07:00 from input");
});

test("isoInfo: negative half-hour offset", () => {
  assert.equal(isoInfo("2026-07-26T08:30:00-05:30").seconds, 1785074400);
});

test("isoInfo: compact and hour-only offsets (Postgres)", () => {
  assert.equal(isoInfo("2026-07-26 08:30:00+07").seconds, ISO_EPOCH);
  assert.equal(isoInfo("2026-07-26T08:30:00+0700").seconds, ISO_EPOCH);
  assert.equal(isoInfo("2026-07-26T08:30+07:00").seconds, ISO_EPOCH);
});

test("isoInfo: Z, lowercase t and z", () => {
  assert.equal(isoInfo("2026-07-26T08:30:00Z").seconds, 1785054600);
  const lower = isoInfo("2026-07-26t08:30:00z");
  assert.equal(lower.seconds, 1785054600);
  assert.equal(lower.readAs, "offset +00:00 from input");
});

test("isoInfo: seconds and fraction truncated to ms", () => {
  assert.equal(isoInfo("2026-07-26T08:30:45Z").seconds, 1785054645);
  assert.equal(isoInfo("2026-07-26T08:30:00.123+07:00").ms, 1785029400123);
  assert.equal(isoInfo("2026-07-26T08:30:00.123456+07:00").ms, 1785029400123);
  assert.equal(isoInfo("2026-07-26T08:30:00.1+07:00").ms, 1785029400100);
});

test("isoInfo: naive input reads as Bangkok wall time", () => {
  const info = isoInfo("2026-07-26 08:30");
  assert.equal(info.seconds, ISO_EPOCH);
  assert.equal(info.readAs, "Asia/Bangkok wall time");
});

test("isoInfo: naive input with tz override", () => {
  const info = isoInfo("2026-07-26T08:30:00", "UTC");
  assert.equal(info.seconds, 1785054600);
  assert.equal(info.readAs, "UTC wall time");
  assert.equal(info.bangkok, "2026-07-26 15:30");
});

test("isoInfo: date-only means midnight in the assumed zone", () => {
  // 2026-07-26 00:00 Bangkok === 2026-07-25T17:00:00Z
  const info = isoInfo("2026-07-26");
  assert.equal(info.seconds, 1784998800);
  assert.equal(info.isoUtc, "2026-07-25T17:00:00.000Z");
});

test("isoInfo: rejects non-ISO shapes", () => {
  assert.throws(() => isoInfo("26/07/2026"), InputError);
  assert.throws(() => isoInfo("8:30 AM"), InputError);
  assert.throws(() => isoInfo("tomorrow"), InputError);
  assert.throws(() => isoInfo("15:00"), InputError); // bare time stays /time stamp's job
  assert.throws(() => isoInfo("2026-07-26Z"), InputError); // offset without a time
  assert.throws(() => isoInfo("2026-07-26T08:30.5"), InputError); // fraction needs seconds
});

test("isoInfo: rejects impossible calendar dates instead of rolling over", () => {
  assert.throws(() => isoInfo("2026-02-30"), InputError);
  assert.throws(() => isoInfo("2026-13-01"), InputError);
  assert.throws(() => isoInfo("2026-00-10"), InputError);
});

test("isoInfo: rejects out-of-range time fields", () => {
  assert.throws(() => isoInfo("2026-07-26T25:00"), InputError);
  assert.throws(() => isoInfo("2026-07-26T08:61"), InputError);
  assert.throws(() => isoInfo("2026-07-26T08:30:61Z"), InputError);
});

test("isoInfo: rejects out-of-range offsets", () => {
  // +14:00 exists (Pacific/Kiritimati) — the boundary is inclusive
  assert.equal(isoInfo("2026-07-26T08:30:00+14:00").seconds, 1785004200);
  assert.throws(() => isoInfo("2026-07-26T08:30:00+15:00"), InputError);
  assert.throws(() => isoInfo("2026-07-26T08:30:00+07:60"), InputError);
});

test("isoInfo: rejects tz option when the input carries an offset", () => {
  assert.throws(() => isoInfo("2026-07-26T08:30:00Z", "UTC"), InputError);
  assert.throws(() => isoInfo("2026-07-26T08:30:00+07:00", "Asia/Bangkok"), InputError);
});

test("isoInfo: rejects unknown tz option", () => {
  assert.throws(() => isoInfo("2026-07-26 08:30", "Nope/Nowhere"), InputError);
});

test("isoInfo: leap day parses in a leap year only", () => {
  assert.equal(isoInfo("2028-02-29").isoUtc, "2028-02-28T17:00:00.000Z");
  assert.throws(() => isoInfo("2026-02-29"), InputError);
});

// --- Fix wave: whole-branch review findings ---

test("assertZone is exported and rejects a non-IANA zone", () => {
  // Exported for the command layer: an autocompleting string option does not
  // constrain submitted text, so every /time subcommand that accepts a zone has
  // to validate it defensively before anything formats with it.
  assert.doesNotThrow(() => assertZone("Asia/Bangkok"));
  assert.doesNotThrow(() => assertZone("UTC"));
  assert.throws(() => assertZone("banana"), InputError);
  assert.throws(() => assertZone("Not/AZone"), InputError);
});

test("assertZone's message is byte-identical wherever a bad zone is caught", () => {
  // /time parse's guard must produce the SAME text as its five siblings — that
  // byte-identity is the whole reason it calls the shared helper rather than
  // rolling its own check.
  const messages = [
    () => assertZone("banana"),
    () => parseStamp("2026-07-20 15:00", "banana"),
    () => explainCron("*/5 * * * *", "banana"),
    () => isoInfo("2026-07-26 08:30", "banana"),
    () => convertTz("15:00", "banana", "UTC"),
  ].map((run) => {
    try {
      run();
      return "(did not throw)";
    } catch (error) {
      return (error as Error).message;
    }
  });
  assert.equal(
    messages[0],
    'Unknown timezone "banana" — use an IANA name like Asia/Bangkok.',
  );
  assert.equal(new Set(messages).size, 1, JSON.stringify(messages));
});

test("isoInfo: an offset-less fraction is NOT added twice", () => {
  // tzOffsetMs reformats to second precision, so before the floor it returned
  // trueOffset − ms and zonedToUtc then applied the millisecond a second time:
  // "…08:30:00.123" Bangkok resolved to …246, and ".500" rolled a whole second
  // forward. The naive form must agree to the millisecond with the explicit
  // +07:00 form, which takes the other isoInfo branch entirely.
  assert.equal(isoInfo("2026-07-26 08:30:00.123").ms, ISO_EPOCH * 1000 + 123);
  assert.equal(
    isoInfo("2026-07-26 08:30:00.123").ms,
    isoInfo("2026-07-26T08:30:00.123+07:00").ms,
  );
  assert.equal(isoInfo("2026-07-26T08:30:00.500").ms, ISO_EPOCH * 1000 + 500);
  assert.equal(isoInfo("2026-07-26T08:30:00.999").ms, ISO_EPOCH * 1000 + 999);
  assert.equal(isoInfo("2026-07-26T08:30:00.001").ms, ISO_EPOCH * 1000 + 1);
  // The seconds field must not roll forward either — ".500" used to yield 08:30:01.
  assert.equal(isoInfo("2026-07-26T08:30:00.500").seconds, ISO_EPOCH);
  assert.equal(isoInfo("2026-07-26T08:30:00.500").isoUtc, "2026-07-26T01:30:00.500Z");
});

test("isoInfo: the fraction fix holds in a non-Bangkok zone and west of UTC", () => {
  assert.equal(isoInfo("2026-07-26T08:30:00.123", "UTC").ms, 1785054600123);
  // America/New_York is UTC-4 in July — a negative offset must floor the same way.
  assert.equal(isoInfo("2026-07-26T08:30:00.123", "America/New_York").ms, 1785069000123);
});

test("whole-second paths are unchanged by the tzOffsetMs floor", () => {
  // parseWallTime never supplies seconds or millis, so /time tz and /time stamp
  // must be byte-identical to before the fix. Pinned so a future "simplify" of
  // the floor cannot quietly move them.
  assert.equal(parseStamp("2026-07-20 15:00"), KNOWN_EPOCH);
  assert.equal(convertTz("2026-01-15 12:00", "UTC", "Asia/Bangkok").output, "2026-01-15 19:00");
  assert.equal(isoInfo("2026-07-26 08:30").ms, ISO_EPOCH * 1000);
  assert.equal(isoInfo("2026-07-26T08:30:45").ms, (ISO_EPOCH + 45) * 1000);
});
