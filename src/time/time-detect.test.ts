import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTime, FORMATS } from "./time-detect.js";

// 2026-08-16T07:00:00Z. Verified: Sun 16 Aug 2026 14:00 Bangkok, ISO week 33,
// day 228 of 2026.
const NOW = 1786863600_000;

test("empty and whitespace input yield null", () => {
  assert.equal(detectTime("", { tier: "loose", nowMs: NOW }), null);
  assert.equal(detectTime("   ", { tier: "loose", nowMs: NOW }), null);
});

test("prose with no timestamp yields null", () => {
  assert.equal(detectTime("just talking about lunch", { tier: "loose", nowMs: NOW }), null);
});

test("a bare ISO timestamp with an offset parses in the strict tier", () => {
  const hit = detectTime("2026-08-16T07:00:00Z", { tier: "strict", nowMs: NOW });
  assert.equal(hit?.kind, "iso");
  assert.equal(hit?.kind === "iso" ? hit.seconds : 0, 1786863600);
});

test("ISO scans INSIDE prose, in BOTH tiers — anchoring is not tier", () => {
  const text = "deploy failed at 2026-08-16T07:00:00Z, see logs";
  for (const tier of ["strict", "loose"] as const) {
    const hit = detectTime(text, { tier, nowMs: NOW });
    assert.equal(hit?.kind, "iso", `tier ${tier}`);
    assert.equal(hit?.kind === "iso" ? hit.seconds : 0, 1786863600);
  }
});

test("the space separator and comma millis parse as iso", () => {
  const a = detectTime("2026-08-16 14:00:00", { tier: "strict", nowMs: NOW });
  assert.equal(a?.kind, "iso");
  assert.equal(a?.kind === "iso" ? a.seconds : 0, 1786863600);
  const b = detectTime("2026-08-16 14:00:00,123", { tier: "strict", nowMs: NOW });
  assert.equal(b?.kind, "iso");
});

test("a bare epoch parses at all four widths", () => {
  for (const raw of ["1786863600", "1786863600000", "1786863600000000", "1786863600000000000"]) {
    const hit = detectTime(raw, { tier: "strict", nowMs: NOW });
    assert.equal(hit?.kind, "epoch", raw);
    assert.equal(hit?.kind === "epoch" ? hit.seconds : 0, 1786863600, raw);
  }
});

test("epoch is ANCHORED — it never scans inside prose, in either tier", () => {
  for (const tier of ["strict", "loose"] as const) {
    assert.equal(detectTime("order 1786863600 shipped", { tier, nowMs: NOW }), null, tier);
  }
});

test("the 50-year window rejects a card-shaped 16-digit number", () => {
  // A Visa-shaped number scales to roughly the year 2112 as microseconds.
  assert.equal(detectTime("4532015112830366", { tier: "strict", nowMs: NOW }), null);
});

test("the leading-zero guard still rejects a Thai phone number", () => {
  assert.equal(detectTime("0812345678", { tier: "strict", nowMs: NOW }), null);
});

test("two timestamps: the earliest by index wins, in both orders", () => {
  const first = detectTime("a 2026-08-16T07:00:00Z b 2026-08-17T07:00:00Z", { tier: "strict", nowMs: NOW });
  assert.equal(first?.kind === "iso" ? first.seconds : 0, 1786863600);
  const second = detectTime("a 2026-08-17T07:00:00Z b 2026-08-16T07:00:00Z", { tier: "strict", nowMs: NOW });
  assert.equal(second?.kind === "iso" ? second.seconds : 0, 1786863600 + 86400);
});

test("a timestamp carrying its own offset ignores an explicit tz, never throws", () => {
  const hit = detectTime("2026-08-16T07:00:00Z", { tier: "strict", nowMs: NOW, tz: "Asia/Tokyo" });
  assert.equal(hit?.kind, "iso");
  assert.equal(hit?.kind === "iso" ? hit.seconds : 0, 1786863600);
});

test("an explicit tz genuinely changes an offset-less value's reading", () => {
  const hit = detectTime("2026-08-16 14:00:00", { tier: "strict", nowMs: NOW, tz: "Asia/Tokyo" });
  assert.equal(hit?.kind, "iso");
  assert.equal(hit?.kind === "iso" ? hit.seconds : 0, 1786856400);
});

test("the 50-year window also rejects an out-of-window value at a different width", () => {
  // 10-digit, resolves to roughly the year 2286 as epoch seconds.
  assert.equal(detectTime("9999999999", { tier: "strict", nowMs: NOW }), null);
});

test("every spec's globality matches its anchoring", () => {
  for (const spec of FORMATS) {
    assert.notEqual(spec.anchored, spec.re.global);
    if (spec.anchored) {
      assert.match(spec.re.source, /^\^/);
      assert.match(spec.re.source, /\$$/);
    }
  }
});

test("RFC 2822 parses when the weekday agrees, misses when it does not", () => {
  const ok = detectTime("Sun, 16 Aug 2026 07:00:00 GMT", { tier: "strict", nowMs: NOW });
  assert.equal(ok?.kind, "rfc2822");
  assert.equal(ok?.kind === "rfc2822" ? ok.seconds : 0, 1786863600);
  // 2026-08-16 is a Sunday; Luxon rejects the contradiction and so do we.
  assert.equal(detectTime("Sat, 16 Aug 2026 07:00:00 GMT", { tier: "strict", nowMs: NOW }), null);
});

test("RFC 2822 works without a weekday and with an obsolete zone", () => {
  assert.equal(detectTime("16 Aug 2026 07:00:00 GMT", { tier: "strict", nowMs: NOW })?.kind, "rfc2822");
  const est = detectTime("Sun, 16 Aug 2026 07:00:00 EST", { tier: "strict", nowMs: NOW });
  assert.equal(est?.kind, "rfc2822");
  // EST is a fixed UTC-5 offset (not DST-aware) — 07:00 EST is 12:00 UTC.
  assert.equal(est?.kind === "rfc2822" ? est.seconds : 0, 1786881600);
});

test("RFC 2822 scans inside prose", () => {
  const hit = detectTime("Date: Sun, 16 Aug 2026 07:00:00 GMT (from the header)", {
    tier: "strict",
    nowMs: NOW,
  });
  assert.equal(hit?.kind, "rfc2822");
});

test("RFC 2822 does not match a date spliced out of a longer digit run", () => {
  assert.equal(
    detectTime("Invoice #4516 Aug 2026 07:00:00 GMT was voided", { tier: "strict", nowMs: NOW }),
    null,
  );
});

test("basic ISO with no separators parses", () => {
  const hit = detectTime("20260816T070000Z", { tier: "strict", nowMs: NOW });
  assert.equal(hit?.kind, "basic-iso");
  assert.equal(hit?.kind === "basic-iso" ? hit.seconds : 0, 1786863600);
});

test("a Discord timestamp tag is reverse-decoded", () => {
  const hit = detectTime("meet at <t:1786863600:F> ok?", { tier: "strict", nowMs: NOW });
  assert.equal(hit?.kind, "discord-tag");
  assert.equal(hit?.kind === "discord-tag" ? hit.seconds : 0, 1786863600);
});

test("a log line with a URL still finds its timestamp", () => {
  const hit = detectTime(
    "[2026-08-16T07:00:00.123Z] GET https://example.com/x?a=1 200",
    { tier: "strict", nowMs: NOW },
  );
  assert.equal(hit?.kind, "iso");
});

test("an RFC 2822 date in a log line with a URL is still found", () => {
  const hit = detectTime(
    "fetched https://example.com/x?a=1 at Sun, 16 Aug 2026 07:00:00 GMT ok",
    { tier: "strict", nowMs: NOW },
  );
  assert.equal(hit?.kind, "rfc2822");
  assert.equal(hit?.kind === "rfc2822" ? hit.seconds : 0, 1786863600);
});

test("loose-only formats are invisible to the strict tier", () => {
  for (const raw of ["2026-08-16", "Aug 16, 2026", "16/08/2026", "15:00", "PT5M"]) {
    assert.equal(detectTime(raw, { tier: "strict", nowMs: NOW }), null, raw);
  }
});

test("a bare date parses in the loose tier and flags the assumed time", () => {
  const hit = detectTime("2026-08-16", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "date-only");
  assert.equal(hit?.kind === "date-only" ? hit.timeAssumed : false, true);
  assert.equal(hit?.kind === "date-only" ? hit.dateAssumed : true, false);
});

test("named-month dates parse in both orderings", () => {
  for (const raw of ["Aug 16, 2026", "16 Aug 2026", "August 16, 2026"]) {
    const hit = detectTime(raw, { tier: "loose", nowMs: NOW });
    assert.equal(hit?.kind, "named-date", raw);
  }
});

test("slash dates read DD/MM and carry the other legal reading", () => {
  const hit = detectTime("16/08/2026", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "slash-date");
  // 08/16 is not a real month, so there is no second reading.
  assert.equal(hit?.kind === "slash-date" ? hit.alternate : undefined, null);

  const ambiguous = detectTime("08/09/2026", { tier: "loose", nowMs: NOW });
  assert.equal(ambiguous?.kind, "slash-date");
  assert.notEqual(ambiguous?.kind === "slash-date" ? ambiguous.alternate : null, null);
});

test("a bare time assumes today in tz and flags the assumed date", () => {
  const hit = detectTime("15:00", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "time-only");
  assert.equal(hit?.kind === "time-only" ? hit.dateAssumed : false, true);
});

test("time-only resolves against the SUPPLIED clock, not today", () => {
  const threeDaysEarlier = NOW - 3 * 86400_000;
  const a = detectTime("15:00", { tier: "loose", nowMs: NOW });
  const b = detectTime("15:00", { tier: "loose", nowMs: threeDaysEarlier });
  const aSec = a?.kind === "time-only" ? a.seconds : 0;
  const bSec = b?.kind === "time-only" ? b.seconds : 0;
  assert.equal(aSec - bSec, 3 * 86400);
});

test("12-hour times with no minutes parse", () => {
  assert.equal(detectTime("3pm", { tier: "loose", nowMs: NOW })?.kind, "time-only");
});

test("durations parse, and calendar units are marked approximate", () => {
  const exact = detectTime("PT5M", { tier: "loose", nowMs: NOW });
  assert.equal(exact?.kind, "duration");
  assert.equal(exact?.kind === "duration" ? exact.totalMs : 0, 300_000);
  assert.equal(exact?.kind === "duration" ? exact.approximate : true, false);

  const approx = detectTime("P1Y", { tier: "loose", nowMs: NOW });
  assert.equal(approx?.kind === "duration" ? approx.approximate : false, true);
});

test("a cron expression is explained with next runs", () => {
  const hit = detectTime("*/5 * * * *", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "cron");
  assert.equal(hit?.kind === "cron" ? hit.nextRuns.length : 0, 3);
});

test("a full ISO timestamp beats the date-only prefix at the same index", () => {
  const hit = detectTime("2026-08-16T07:00:00Z", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "iso");
});

// --- Over-match probes against plausible pasted Discord text (loose tier) ---
// Each new scanning regex runs over arbitrary chat, so every one of these
// constructs a realistic message that must NOT be misread, mirroring the
// RFC 2822 splice bug this cycle already paid for once.

test("a slash-date does not splice out of a URL path (WordPress-style /D/M/YYYY/)", () => {
  const hit = detectTime(
    "see https://blog.example.com/5/6/2026/breaking-news for details",
    { tier: "loose", nowMs: NOW },
  );
  assert.notEqual(hit?.kind, "slash-date");
});

test("a slash-date still parses when not adjacent to another slash", () => {
  const hit = detectTime("don't forget, the event is 16/08/2026 ok?", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "slash-date");
});

test("named-date does not splice a date out of a longer digit run", () => {
  // Mirrors the RFC 2822 splice bug (Invoice #4516 Aug 2026 07:00:00 GMT):
  // without a real left boundary, "16 Aug 2026" could be carved out of
  // "4516 Aug 2026". No time/zone follows here, so nothing else in the
  // registry can claim it either — the whole message must yield no hit.
  assert.equal(detectTime("Invoice #4516 Aug 2026 was voided", { tier: "loose", nowMs: NOW }), null);
});

test("named-date silently declines an ordinary capitalised word instead of misreading it", () => {
  // "Invoice" is 7 letters, matches the loose word shape, but is not a month
  // — fromFormat's real validation is what actually guards this, not the scan
  // regex, so the whole message must yield no hit at all.
  assert.equal(detectTime("Invoice 12, 2026 was sent to accounting", { tier: "loose", nowMs: NOW }), null);
});

test("time-only does not steal a full ISO timestamp's minutes:seconds as its own match", () => {
  // "14:00:00" inside a full ISO timestamp is itself \d{1,2}:\d{2}-shaped
  // starting at "00:00". Earliest-index-wins must still resolve to the ISO
  // match, which starts earlier in the string.
  const hit = detectTime("logged at 2026-08-16 14:00:00 sharp", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "iso");
});

test("time-only declines an out-of-range hour (a two-digit score, not a time)", () => {
  assert.equal(detectTime("final score was 45:32 at the buzzer", { tier: "loose", nowMs: NOW }), null);
});

test("a lone P-prefixed acronym without a duration unit is left alone", () => {
  assert.equal(detectTime("filed as P1 in the tracker", { tier: "loose", nowMs: NOW }), null);
});

test("a P+digit+unit acronym (e.g. Prepar3D's \"P3D\") reads as a duration — ACCEPTED, not desirable", () => {
  // Coordinator ruling (task-4-report.md, DURATION_SCAN_RE fix round): this is
  // a known false positive, deliberately NOT guarded against. It is accepted
  // because the loose tier is opt-in and the renderer names exactly what
  // matched, so a misfire is visible rather than fabricated — unlike the RFC
  // 2822 splice bug, which invented a plausible wrong date from text
  // containing none. Every regex tightening tried here also broke the
  // brief's own required "P1Y" case. If a future change anchors or narrows
  // DURATION_SCAN_RE, this test will fail and point straight at the ruling
  // that allowed the current behaviour — do not "fix" it by weakening this
  // assertion without re-reading that ruling.
  const hit = detectTime("just got P3D installed", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "duration");
  assert.equal(hit?.kind === "duration" ? hit.totalMs : 0, 259_200_000);
});

// --- Fix round: reviewer-found Critical bugs, both in the brief's own
// regexes, not in anything chosen during implementation. ---

test("a 12-hour time WITH minutes parses correctly, colon-then-meridiem and no space", () => {
  // Previously TIME_ONLY_SCAN_RE's bare-colon alternative won first and
  // truncated the match before the meridiem, so "3:30pm" scanned as just
  // "30pm" (no leading digit) and failed to parse at all.
  const hit = detectTime("3:30pm", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "time-only");
  assert.equal(hit?.kind === "time-only" ? hit.seconds : 0, 1786869000);
});

test("a 12-hour time WITH minutes parses correctly, with a space and uppercase meridiem", () => {
  // Previously matched only "3:30" (the meridiem was silently dropped) and
  // rendered 03:30 — twelve hours wrong, with nothing signalling the loss.
  const hit = detectTime("3:30 PM", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "time-only");
  assert.equal(hit?.kind === "time-only" ? hit.seconds : 0, 1786869000);
});

test("11:59 pm resolves to 23:59, not 11:59", () => {
  const hit = detectTime("11:59 pm", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "time-only");
  assert.equal(hit?.kind === "time-only" ? hit.seconds : 0, 1786899540);
});

test("12:00 AM resolves to midnight, not noon-ish 12:00", () => {
  const hit = detectTime("12:00 AM", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "time-only");
  assert.equal(hit?.kind === "time-only" ? hit.seconds : 0, 1786813200);
});

test("plain 24-hour and bare-meridiem times are unchanged by the regex fix", () => {
  const bare24 = detectTime("15:00", { tier: "loose", nowMs: NOW });
  assert.equal(bare24?.kind, "time-only");
  assert.equal(bare24?.kind === "time-only" ? bare24.seconds : 0, 1786867200);

  const bareMeridiem = detectTime("3pm", { tier: "loose", nowMs: NOW });
  assert.equal(bareMeridiem?.kind, "time-only");
  assert.equal(bareMeridiem?.kind === "time-only" ? bareMeridiem.seconds : 0, 1786867200);
});

test("an aspect ratio and an out-of-range score are still rejected after the regex fix", () => {
  assert.equal(detectTime("the video is 16:9", { tier: "loose", nowMs: NOW }), null);
  assert.equal(detectTime("final score was 45:32 at the buzzer", { tier: "loose", nowMs: NOW }), null);
});

test("cron no longer fabricates a schedule out of a plain list of integers", () => {
  for (const raw of [
    "scores were 1 2 3 4 5 tonight",
    "my numbers 5 4 3 2 1 go",
    "ranking: 1 2 3 4 5 6",
  ]) {
    assert.equal(detectTime(raw, { tier: "loose", nowMs: NOW }), null, raw);
  }
});

test("real cron expressions carrying a cron-only character still resolve", () => {
  for (const raw of ["*/5 * * * *", "0 15 * * *", "30 8 * * 1-5"]) {
    assert.equal(detectTime(raw, { tier: "loose", nowMs: NOW })?.kind, "cron", raw);
  }
});

test("the loose date/time/duration instants are pinned, not just their kind", () => {
  // Midnight Asia/Bangkok on 2026-08-16 is 2026-08-15T17:00:00Z — verified
  // independently, not just trusted: NOW (2026-08-16T07:00:00Z = 14:00
  // Bangkok) minus 14 hours. Without this, a bug that resolved date-only to
  // UTC midnight instead of tz midnight would leave every prior test green.
  const dateOnly = detectTime("2026-08-16", { tier: "loose", nowMs: NOW });
  assert.equal(dateOnly?.kind === "date-only" ? dateOnly.seconds : 0, 1786813200);

  const slashDate = detectTime("16/08/2026", { tier: "loose", nowMs: NOW });
  assert.equal(slashDate?.kind === "slash-date" ? slashDate.seconds : 0, 1786813200);

  const namedDate = detectTime("Aug 16, 2026", { tier: "loose", nowMs: NOW });
  assert.equal(namedDate?.kind === "named-date" ? namedDate.seconds : 0, 1786813200);
});

// --- Fix wave: whole-branch review findings ---

test("ISO does not splice a timestamp out of a longer digit run", () => {
  // ISO_SCAN_RE was the only scanning spec with no left boundary, so a 5-digit
  // year carved "2026-08-16T07:00:00Z" out of "12026-08-16T07:00:00Z" and
  // reported a confident, wrong instant. DATE_ONLY_SCAN_RE's \b already got the
  // date-only form of the same input right, which is what exposed the gap.
  assert.equal(detectTime("12026-08-16T07:00:00Z", { tier: "strict", nowMs: NOW }), null);
  assert.equal(detectTime("12026-08-16 14:00:00", { tier: "strict", nowMs: NOW }), null);
  // The date-only sibling must keep behaving the same way in the loose tier.
  assert.equal(detectTime("12026-08-16", { tier: "loose", nowMs: NOW }), null);
  // An id-looking run in prose must not donate a year either.
  assert.equal(detectTime("job 12026-08-16T07:00:00Z failed", { tier: "strict", nowMs: NOW }), null);
});

test("ISO still matches after a non-digit, and at the start of the string", () => {
  // The guard is (?<!\d), NOT \b — a bracket, letter or start-of-string prefix
  // must still resolve, which is what keeps log lines like "[2026-…]" working.
  for (const raw of [
    "2026-08-16T07:00:00Z",
    "[2026-08-16T07:00:00Z] GET /x 200",
    "at=2026-08-16T07:00:00Z",
    "deploy failed at 2026-08-16T07:00:00Z, see logs",
  ]) {
    const hit = detectTime(raw, { tier: "strict", nowMs: NOW });
    assert.equal(hit?.kind, "iso", raw);
    assert.equal(hit?.kind === "iso" ? hit.seconds : 0, 1786863600, raw);
  }
});

test("ISO carries NO trailing digit guard — a (?!\\d) would backtrack and drop the Z", () => {
  // Deliberate asymmetry, and the reason is a measured backfire, not an
  // oversight: a trailing (?!\d) does not reject a run with a digit glued to
  // the end, it makes the engine backtrack to a SHORTER still-matching run.
  // "2026-08-16T07:00:00Z9" would then match "2026-08-16T07:00:00" — the Z
  // silently dropped, a UTC stamp reread as Bangkok wall time, seven hours out.
  // This test fails the moment someone "completes the pair".
  const hit = detectTime("2026-08-16T07:00:00Z9", { tier: "strict", nowMs: NOW });
  assert.equal(hit?.kind, "iso");
  assert.equal(hit?.kind === "iso" ? hit.matched : "", "2026-08-16T07:00:00Z");
  assert.equal(hit?.kind === "iso" ? hit.seconds : 0, 1786863600);
});

test("a Discord tag outside the ±50-year window is rejected", () => {
  // The window is load-bearing on parseDiscordTag, not only on parseEpoch:
  // DISCORD_TAG_SCAN_RE accepts 1-13 digits, so an ms-valued or mistyped tag
  // resolves to the year 318857 without it. Deleting the check from
  // parseDiscordTag used to leave the whole suite green.
  assert.equal(detectTime("<t:9999999999999:F>", { tier: "strict", nowMs: NOW }), null);
  assert.equal(detectTime("meet at <t:9999999999999:R> ok?", { tier: "strict", nowMs: NOW }), null);
  // In-window tags are untouched.
  assert.equal(detectTime("<t:1786863600:F>", { tier: "strict", nowMs: NOW })?.kind, "discord-tag");
});

test("an offset-less fraction is not added twice, comma or dot", () => {
  // tzOffsetMs returned trueOffset − ms, so the millisecond was applied a second
  // time downstream. This branch is what routes chat traffic to that helper and
  // advertises comma-fraction log timestamps as a gained capability, so the
  // value — not just the kind — is pinned here too.
  const comma = detectTime("2026-08-16 14:00:00,123", { tier: "strict", nowMs: NOW });
  assert.equal(comma?.kind, "iso");
  assert.equal(comma?.kind === "iso" ? comma.ms : 0, 1786863600_123);
  const dot = detectTime("2026-08-16 14:00:00.500", { tier: "strict", nowMs: NOW });
  assert.equal(dot?.kind === "iso" ? dot.ms : 0, 1786863600_500);
  // …and the whole second must not roll forward with it.
  assert.equal(dot?.kind === "iso" ? dot.seconds : 0, 1786863600);
  // An offset-bearing value takes the other isoInfo branch and must stay exact.
  const offset = detectTime("2026-08-16T07:00:00.500Z", { tier: "strict", nowMs: NOW });
  assert.equal(offset?.kind === "iso" ? offset.ms : 0, 1786863600_500);
});

test("a bad tz makes detectTime yield null, never a zone error — the guard belongs at the caller", () => {
  // parseIso's bare catch flattens assertZone's InputError into "no match", so
  // the detector CANNOT report a bad zone: /time parse reported "Couldn't find a
  // timestamp in that" for a perfectly good timestamp with a typo'd tz. That is
  // why the command validates the option before calling in — this pins the
  // mechanism, so a future change here has to update the caller too.
  assert.equal(detectTime("2026-08-16 14:00:00", { tier: "strict", nowMs: NOW, tz: "Not/AZone" }), null);
  assert.equal(detectTime("2026-08-16 14:00:00", { tier: "loose", nowMs: NOW, tz: "Not/AZone" }), null);
});

test("a slash-date with day == month has no alternate reading to report", () => {
  // Deleting the toMillis() !== guard in parseSlashDate would leave the
  // existing ambiguous-alternate test green (08/09 vs 09/08 differ), so this
  // pins the case where dropping that guard would silently start emitting a
  // same-instant "alternate" for every day == month date.
  const hit = detectTime("08/08/2026", { tier: "loose", nowMs: NOW });
  assert.equal(hit?.kind, "slash-date");
  assert.equal(hit?.kind === "slash-date" ? hit.alternate : undefined, null);
});
