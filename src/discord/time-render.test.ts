import { test } from "node:test";
import assert from "node:assert/strict";
import { Settings } from "luxon";
import { renderCompact, renderExpanded, STAMP_STYLES } from "./time-render.js";
import type { TimeHit } from "../time/time-detect.js";

const EPOCH_HIT: TimeHit = {
  kind: "epoch",
  matched: "1786863600",
  seconds: 1786863600,
  ms: 1786863600_000,
  readAs: "epoch seconds",
  alternate: null,
  timeAssumed: false,
  dateAssumed: false,
};

test("the <t:> line leads the data rows, right after the head line", () => {
  const body = renderCompact(EPOCH_HIT);
  const lines = body.split("\n");
  // The <t:> line carries the only value that renders in each viewer's own
  // timezone, so it must not be buried as it is in /time epoch today.
  assert.ok(lines[1]?.includes("<t:1786863600:F>"));
  assert.ok(lines[1]?.includes("<t:1786863600:R>"));
});

test("the compact block carries UTC, both epoch units, week and ordinal", () => {
  const body = renderCompact(EPOCH_HIT);
  assert.match(body, /2026-08-16T07:00:00/);
  assert.match(body, /1786863600 s/);
  assert.match(body, /1786863600000 ms/);
  assert.match(body, /33/);
  assert.match(body, /228/);
  assert.match(body, /read as epoch seconds/);
});

test("a date-only hit never renders an invented 00:00 and uses the D style", () => {
  const hit: TimeHit = { ...EPOCH_HIT, kind: "date-only", timeAssumed: true, readAs: "date only — midnight Asia/Bangkok assumed" };
  const body = renderCompact(hit);
  assert.ok(body.includes("<t:1786863600:D>"));
  assert.ok(!body.includes("<t:1786863600:F>"));
  assert.match(body, /midnight/);
});

test("an ambiguous slash date names the other reading in subtext", () => {
  const hit: TimeHit = {
    ...EPOCH_HIT,
    kind: "slash-date",
    matched: "08/09/2026",
    timeAssumed: true,
    // No "read as " prefix baked into the fixture — renderCompact supplies
    // that itself. A fixture that duplicated the prefix (as this once did)
    // would silently mask the exact doubling bug the assertion below pins.
    readAs: "DD/MM/YYYY — midnight Asia/Bangkok assumed",
    alternate: { reading: "MM/DD/YYYY", seconds: 1786863600 + 86400 },
  };
  const body = renderCompact(hit);
  assert.match(body, /MM\/DD\/YYYY/);
  assert.ok(!body.includes("read as read as"));
});

test("an exact duration renders a total, an approximate one says so", () => {
  const exact = renderCompact({ kind: "duration", matched: "PT5M", totalMs: 300_000, approximate: false });
  const headline = exact.split("\n")[0] ?? "";
  assert.match(headline, /5 min/);
  assert.ok(!headline.includes("0 days"));
  assert.ok(!headline.includes("0 sec"));
  assert.match(
    renderCompact({ kind: "duration", matched: "P1Y", totalMs: 31_536_000_000, approximate: true }),
    /≈|approximate/,
  );
});

// --- Fix wave: whole-branch review findings ---

test("the duration headline stays English whatever locale the host resolves to", () => {
  // The one locale-dependent line on this branch. toFormat (every other line
  // here) self-defaults to English; toHuman does NOT — it follows the host's
  // resolved locale, so a th-TH box rendered "⏳ **5 นาที**". render-smoke.mjs
  // never exercises Luxon, so nothing on the deploy path would have caught it.
  // Settings.defaultLocale reproduces the host condition in-process: without
  // the explicit { locale: "en" } this test fails with Thai unit names.
  const previous = Settings.defaultLocale;
  try {
    for (const locale of ["th-TH", "ja-JP", "de-DE", "ar-EG"]) {
      Settings.defaultLocale = locale;
      const headline = renderCompact({
        kind: "duration",
        matched: "PT5M",
        totalMs: 300_000,
        approximate: false,
      }).split("\n")[0];
      assert.equal(headline, "⏳ **5 min**", locale);

      const multi = renderCompact({
        kind: "duration",
        matched: "P1DT2H3M4S",
        totalMs: 93_784_000,
        approximate: false,
      }).split("\n")[0];
      assert.equal(multi, "⏳ **1 day, 2 hr, 3 min, 4 sec**", locale);
    }
  } finally {
    Settings.defaultLocale = previous;
  }
});

test("a cron hit renders its explanation and next runs", () => {
  const body = renderCompact({
    kind: "cron",
    matched: "*/5 * * * *",
    text: "Every 5 minutes",
    nextRuns: ["2026-08-16 14:05", "2026-08-16 14:10", "2026-08-16 14:15"],
  });
  assert.match(body, /Every 5 minutes/);
  assert.match(body, /14:05/);
});

test("cron compact names its clock anchor — next runs are from NOW, not the message time", () => {
  const hit = {
    kind: "cron" as const,
    matched: "*/5 * * * *",
    text: "every 5 minutes",
    nextRuns: ["2026-08-16 07:05", "2026-08-16 07:10", "2026-08-16 07:15"],
  };
  const body = renderCompact(hit);
  const lines = body.split("\n");
  // The anchor label is LOAD-BEARING, not cosmetic: on the ⏰ surface every
  // instant resolves against the message's timestamp while cron resolves
  // against today (explainCron reads the wall clock by design — measured,
  // records/toolbox-and-render.md). The label is what stops one reply from
  // silently mixing two clocks. Owner-elected 2026-08-17 over threading
  // currentDate through explainCron and over excluding cron from ⏰.
  assert.equal(lines[lines.length - 1], "-# next runs from now");
});

// --- renderExpanded: expanded button views ---

// ms fixture: 1786863600000 = 2026-08-16T07:00:00Z = Sun 16 Aug 2026 14:00
// Bangkok — the design's hand-verified sample instant.
const MS = 1786863600000;

test("STAMP_STYLES is the 7-style table, t through R", () => {
  assert.equal(STAMP_STYLES.length, 7);
  assert.deepEqual(STAMP_STYLES.map(([s]) => s), ["t", "T", "d", "D", "f", "F", "R"]);
});

test("renderExpanded: head line is the live per-viewer pair", () => {
  const body = renderExpanded(MS, "epoch");
  assert.equal(body.split("\n")[0], "🕐 <t:1786863600:F> · <t:1786863600:R>");
});

test("renderExpanded: fixed 6-zone spread with DST state", () => {
  const body = renderExpanded(MS, "epoch");
  // One full zone row pinned verbatim; the rest by their load-bearing parts.
  assert.ok(body.includes("`Bangkok    ` Sun 16 Aug 2026 · 14:00 (+07:00)"));
  assert.ok(body.includes("`UTC        `"));
  assert.ok(body.includes("`Tokyo      `"));
  // August: London, New York and Los Angeles are all in DST; the marker must
  // say so, and must NOT appear on the no-DST zones.
  for (const zone of ["London", "New York", "Los Angeles"]) {
    const row = body.split("\n").find((l) => l.includes(zone));
    assert.ok(row !== undefined && row.includes("· DST"), `${zone} row carries DST`);
  }
  const bkk = body.split("\n").find((l) => l.includes("Bangkok"));
  assert.ok(bkk !== undefined && !bkk.includes("DST"));
});

test("renderExpanded: epoch line with quarter, and all 7 copyable stamps", () => {
  const body = renderExpanded(MS, "epoch");
  assert.ok(body.includes("`Epoch` 1786863600 s · 1786863600000 ms · Q3"));
  for (const [style, label] of STAMP_STYLES) {
    assert.ok(
      body.includes(`\`<t:1786863600:${style}>\` → <t:1786863600:${style}> (${label})`),
      `stamp row ${style}`,
    );
  }
});

test("renderExpanded: read-as subtext per kind, with a generic fallback", () => {
  assert.ok(renderExpanded(MS, "epoch").endsWith("-# read as an epoch value"));
  assert.ok(renderExpanded(MS, "date-only").endsWith("-# read as a date (midnight assumed)"));
  assert.ok(renderExpanded(MS, "time-only").endsWith("-# read as a time (date assumed)"));
  // Unknown kind (a button minted by a future build) still renders.
  assert.ok(renderExpanded(MS, "some-future-kind").endsWith("-# read as a timestamp"));
});

test("renderExpanded: negative ms renders (pre-1970 named dates mint buttons too)", () => {
  const body = renderExpanded(-1554508800000, "named-date");
  assert.ok(body.includes("<t:-1554508800:F>"));
});

test("renderExpanded stays well inside a single message", () => {
  // MAX_INLINE_CHARS is 1900; the whole body must never approach the
  // attachment fallback on an ephemeral button reply.
  assert.ok(renderExpanded(MS, "epoch").length < 1500);
});
