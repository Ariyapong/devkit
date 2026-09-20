import { DateTime, Duration } from "luxon";
import { explainCron, isoInfo, DEFAULT_TZ } from "./timetools.js";
import { findCron } from "./find-cron.js";

export { DEFAULT_TZ };

export type InstantKind =
  | "iso" | "epoch" | "rfc2822" | "basic-iso"
  | "discord-tag" | "date-only" | "named-date" | "slash-date" | "time-only";

export type TimeHit =
  | {
      kind: InstantKind;
      matched: string;
      seconds: number;
      ms: number;
      /** How the instant was anchored, e.g. "epoch seconds", "offset +07:00 from input". */
      readAs: string;
      /** A second legal reading of an ambiguous value, e.g. MM/DD vs DD/MM. */
      alternate: { reading: string; seconds: number } | null;
      /** True when the wall-clock time was assumed rather than supplied. */
      timeAssumed: boolean;
      /** True when the calendar date was assumed rather than supplied. */
      dateAssumed: boolean;
    }
  | { kind: "duration"; matched: string; totalMs: number; approximate: boolean }
  | { kind: "cron"; matched: string; text: string; nextRuns: string[] };

export interface DetectOpts {
  tier: "strict" | "loose";
  nowMs?: number;
  tz?: string;
}

export interface ParseCtx {
  nowMs: number;
  tz: string;
}

export interface FormatSpec {
  tier: "strict" | "loose";
  /**
   * Anchored formats only match the whole trimmed string. This is INDEPENDENT
   * of tier: epoch is strict AND anchored (a bare digit run mid-sentence is far
   * more likely an id than an instant), while ISO is strict AND scanning (no
   * ordinary sentence contains "2026-08-16T07:00:00Z" by accident).
   */
  anchored: boolean;
  /** Anchored specs use ^…$ and no /g; scanning specs MUST carry /g. */
  re: RegExp;
  parse(matched: string, ctx: ParseCtx): TimeHit | null;
}

const FIFTY_YEARS_S = 50 * 365 * 24 * 3600;

/**
 * Leading zero rejected so a Thai phone number (0812345678) is not read as
 * ~1995 — inherited verbatim from detect-decode.ts's EPOCH_RE, which learned it
 * the hard way. Widths are seconds/millis/micros/nanos.
 */
const EPOCH_RE = /^(?:[1-9]\d{9}|[1-9]\d{12}|[1-9]\d{15}|[1-9]\d{18})$/;

const EPOCH_UNITS: Record<number, { divisor: number; label: string }> = {
  10: { divisor: 1, label: "epoch seconds" },
  13: { divisor: 1e3, label: "epoch milliseconds" },
  16: { divisor: 1e6, label: "epoch microseconds" },
  19: { divisor: 1e9, label: "epoch nanoseconds" },
};

function parseEpoch(matched: string, ctx: ParseCtx): TimeHit | null {
  const unit = EPOCH_UNITS[matched.length];
  if (unit === undefined) return null;
  // A 19-digit value exceeds Number.MAX_SAFE_INTEGER, so the double is rounded
  // by up to ~256 ns. After dividing to seconds that is sub-microsecond error —
  // irrelevant at the second precision we render.
  const seconds = Number(matched) / unit.divisor;
  if (!Number.isFinite(seconds)) return null;
  // The window is what stops a 16-digit card number parsing as microseconds.
  // It must cover every width, not just the two that existed before.
  if (Math.abs(seconds - ctx.nowMs / 1000) > FIFTY_YEARS_S) return null;
  return {
    kind: "epoch",
    matched,
    seconds: Math.floor(seconds),
    ms: Math.round(seconds * 1000),
    readAs: unit.label,
    alternate: null,
    timeAssumed: false,
    dateAssumed: false,
  };
}

/**
 * Lenient ISO: date, then a space or T, then a time, optionally with a dot- or
 * comma-separated fraction and an offset. The comma form is what Java and
 * Python logging emit; Luxon's fromISO rejects it (probed), so it is normalised
 * before parsing.
 *
 * The leading (?<!\d) is the same left-boundary guard RFC2822_SCAN_RE and
 * DATE_ONLY_SCAN_RE already carry — this was the one scanning spec without one,
 * so "12026-08-16T07:00:00Z" spliced the year out of a longer digit run and
 * reported a confident, wrong instant (date-only's \b already got the same
 * input right, which is what exposed the gap).
 *
 * ⚠️ There is deliberately NO trailing (?!\d). It was tested and BACKFIRES: the
 * engine backtracks to a shorter still-matching run, so "2026-08-16T07:00:00Z9"
 * would match "2026-08-16T07:00:00" — silently dropping the Z and turning a UTC
 * stamp into a Bangkok wall-clock reading, seven hours out. The leading guard is
 * the safe half; do not "complete the pair".
 */
const ISO_SCAN_RE =
  /(?<!\d)\d{4}-\d{2}-\d{2}[ Tt]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?/g;

const HAS_OFFSET_RE = /(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/;

function parseIso(matched: string, ctx: ParseCtx): TimeHit | null {
  const normalised = matched.replace(",", ".");
  const carriesOffset = HAS_OFFSET_RE.test(normalised);
  try {
    // isoInfo THROWS when handed both an offset and a tz. Passing tz only when
    // the value lacks one implements "a redundant tz is ignored, never
    // rejected" at the detector, so no caller has to remember the rule.
    const info = carriesOffset ? isoInfo(normalised) : isoInfo(normalised, ctx.tz);
    return {
      kind: "iso",
      matched,
      seconds: info.seconds,
      ms: info.ms,
      readAs: info.readAs,
      alternate: null,
      timeAssumed: false,
      dateAssumed: false,
    };
  } catch {
    return null;
  }
}

/**
 * Weekday is optional; the zone is either a numeric offset or an alphabetic
 * abbreviation. Luxon validates the rest — including that a supplied weekday
 * agrees with the date, which it treats as a hard error (probed).
 *
 * The leading \b (mirroring BASIC_ISO_SCAN_RE's \b\d{8}) stops the
 * day-of-month group from starting mid-digit-run — without it, "#4516 Aug
 * 2026 07:00:00 GMT" matched "16 Aug 2026 07:00:00 GMT" starting inside
 * "4516" and Luxon happily parsed the splice as a valid date (reviewer
 * finding, regression-tested).
 */
const RFC2822_SCAN_RE =
  /(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+)?\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:[+-]\d{4}|[A-Z]{2,4})/g;

function fromLuxon(
  dt: DateTime,
  kind: InstantKind,
  matched: string,
  readAs: string,
  assumed: { timeAssumed: boolean; dateAssumed: boolean } = { timeAssumed: false, dateAssumed: false },
  alternate: { reading: string; seconds: number } | null = null,
): TimeHit | null {
  if (!dt.isValid) return null;
  const ms = dt.toMillis();
  return {
    kind,
    matched,
    seconds: Math.floor(ms / 1000),
    ms,
    readAs,
    alternate,
    ...assumed,
  };
}

function parseRfc2822(matched: string): TimeHit | null {
  // No fromHTTP fallback: fromRFC2822 and fromHTTP both funnel through Luxon's
  // same internal parser, so anything RFC2822_SCAN_RE captures that also
  // satisfies HTTP's stricter grammar is a strict subset fromRFC2822 already
  // accepts — fromHTTP never fires (reviewer finding, probed against Luxon's
  // source). The rfc850/asctime HTTP sub-formats aren't captured by this scan
  // regex at all, so a real HTTP Date header (rfc1123 form) still resolves,
  // just reported as "rfc2822" rather than a separate unreachable label.
  return fromLuxon(DateTime.fromRFC2822(matched), "rfc2822", matched, "RFC 2822, offset from input");
}

const BASIC_ISO_SCAN_RE = /\b\d{8}T\d{6}(?:Z|[+-]\d{2}:?\d{2})?\b/g;

function parseBasicIso(matched: string, ctx: ParseCtx): TimeHit | null {
  const dt = DateTime.fromISO(matched, { zone: ctx.tz });
  const readAs = /(?:Z|[+-]\d{2}:?\d{2})$/.test(matched)
    ? "basic ISO, offset from input"
    : `basic ISO, ${ctx.tz} wall time`;
  return fromLuxon(dt, "basic-iso", matched, readAs);
}

/** Discord renders these itself; we decode one back to an instant. */
const DISCORD_TAG_SCAN_RE = /<t:(\d{1,13}):[tTdDfFR]>/g;

function parseDiscordTag(matched: string, ctx: ParseCtx): TimeHit | null {
  const digits = /<t:(\d{1,13}):/.exec(matched)?.[1];
  if (digits === undefined) return null;
  const seconds = Number(digits);
  if (!Number.isFinite(seconds)) return null;
  // The ±50-year window is load-bearing HERE, not only on parseEpoch: the scan
  // regex accepts 1-13 digits, so "<t:9999999999999:F>" (a mistyped or ms-valued
  // tag) would otherwise resolve to the year 318857 and render as a real
  // instant. Pinned by test — deleting this line used to leave the suite green.
  if (Math.abs(seconds - ctx.nowMs / 1000) > FIFTY_YEARS_S) return null;
  return {
    kind: "discord-tag",
    matched,
    seconds,
    ms: seconds * 1000,
    readAs: "Discord timestamp tag",
    alternate: null,
    timeAssumed: false,
    dateAssumed: false,
  };
}

const DATE_ONLY_SCAN_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

function parseDateOnly(matched: string, ctx: ParseCtx): TimeHit | null {
  return fromLuxon(
    DateTime.fromISO(matched, { zone: ctx.tz }),
    "date-only",
    matched,
    `date only — midnight ${ctx.tz} assumed`,
    { timeAssumed: true, dateAssumed: false },
  );
}

const NAMED_DATE_SCAN_RE =
  /\b(?:[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})\b/g;

const NAMED_DATE_FORMATS = ["LLL d, yyyy", "LLL d yyyy", "LLLL d, yyyy", "LLLL d yyyy", "d LLL yyyy", "d LLLL yyyy"];

function parseNamedDate(matched: string, ctx: ParseCtx): TimeHit | null {
  // The scan regex accepts any 3-9 letter word, not just month names — an
  // ordinary capitalised word ("Invoice 12 2026") matches the shape but never
  // parses, because fromFormat validates the month token for real. That keeps
  // this a performance-only concern, not a correctness one: a non-month word
  // yields null here and detectTime never adds it as a candidate.
  const cleaned = matched.replace(".", "");
  for (const fmt of NAMED_DATE_FORMATS) {
    const dt = DateTime.fromFormat(cleaned, fmt, { zone: ctx.tz });
    if (dt.isValid) {
      return fromLuxon(dt, "named-date", matched, `date only — midnight ${ctx.tz} assumed`, {
        timeAssumed: true,
        dateAssumed: false,
      });
    }
  }
  return null;
}

// Guarded against splicing a date-shaped run out of a URL path — a pasted
// link like ".../blog/5/6/2026/post" is day/month/year-shaped and would
// otherwise misread as a real date. Neither side may butt against another
// slash; an ordinary "16/08/2026" in prose is unaffected either way.
const SLASH_DATE_SCAN_RE = /(?<!\/)\b\d{1,2}\/\d{1,2}\/\d{4}\b(?!\/)/g;

function parseSlashDate(matched: string, ctx: ParseCtx): TimeHit | null {
  // DD/MM is the reading everywhere except the US, and this bot's default zone
  // is Asia/Bangkok. When MM/DD is ALSO legal the other reading rides along so
  // the renderer can name it — never silently picked.
  const dayFirst = DateTime.fromFormat(matched, "d/M/yyyy", { zone: ctx.tz });
  if (!dayFirst.isValid) return null;
  const monthFirst = DateTime.fromFormat(matched, "M/d/yyyy", { zone: ctx.tz });
  const alternate =
    monthFirst.isValid && monthFirst.toMillis() !== dayFirst.toMillis()
      ? { reading: "MM/DD/YYYY", seconds: Math.floor(monthFirst.toMillis() / 1000) }
      : null;
  return fromLuxon(
    dayFirst,
    "slash-date",
    matched,
    `DD/MM/YYYY — midnight ${ctx.tz} assumed`,
    { timeAssumed: true, dateAssumed: false },
    alternate,
  );
}

// Longest alternative FIRST — alternation is first-match-wins at a position,
// so a 12-hour time WITH minutes (colon + meridiem) must be tried before the
// bare-colon and bare-meridiem alternatives, or it gets truncated to just the
// colon part and the meridiem is silently dropped (reviewer finding: "3:30
// PM" rendered as 03:30 with nothing signalling the AM/PM was lost, and
// "3:30pm" — no space, the commonest way this is typed — matched only
// "30pm" and failed to parse at all).
const TIME_ONLY_SCAN_RE =
  /\b\d{1,2}:\d{2}\s?[AaPp][Mm]\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?[AaPp][Mm]\b/g;

// "h a" (space before the meridiem) was dead code: parseTimeOnly strips every
// space out of the matched text before formatting, so no cleaned string could
// ever contain one.
const TIME_ONLY_FORMATS = ["H:mm", "h:mma", "ha"];

function parseTimeOnly(matched: string, ctx: ParseCtx): TimeHit | null {
  // "today" is whatever clock the caller supplied — the message's own timestamp
  // on the reaction path, not Date.now(). Getting this wrong makes an old
  // "meeting at 15:00" resolve to today.
  const today = DateTime.fromMillis(ctx.nowMs).setZone(ctx.tz).toFormat("yyyy-MM-dd");
  const cleaned = matched.replace(/\s+/g, "").toLowerCase();
  for (const fmt of TIME_ONLY_FORMATS) {
    const dt = DateTime.fromFormat(`${today} ${cleaned}`, `yyyy-MM-dd ${fmt}`, { zone: ctx.tz });
    if (dt.isValid) {
      return fromLuxon(dt, "time-only", matched, `time only — ${today} in ${ctx.tz} assumed`, {
        timeAssumed: false,
        dateAssumed: true,
      });
    }
  }
  return null;
}

// Known, ACCEPTED limitation (coordinator ruling, task-4-report.md): a short
// P+digit+unit acronym reads as a duration even when it isn't one — "P3D" is
// common flight-sim shorthand for Prepar3D, and "just got P3D installed"
// parses as a 3-day duration. The accepted class is wider than that one
// example: any product/trim code shaped like P+digits+[YMWD] collides the
// same way — a "Model S P100D" reads as a 100-day duration, and P85D/P2W
// are the same shape. Left as-is on purpose: the loose tier is opt-in, the
// renderer names exactly what matched ("read as ISO 8601 duration `P3D`") so
// a misfire is visible rather than silently fabricated — unlike the RFC 2822
// splice bug this cycle fixed, which invented a plausible wrong date from
// text containing none, this is a correct parse of a genuinely ambiguous
// token. Every tightening tried also broke the brief's own required P1Y
// case, so the regex stays exactly as specified.
const DURATION_SCAN_RE = /\bP(?:\d+[YMWD])+(?:T(?:\d+[HMS])+)?\b|\bPT(?:\d+[HMS])+\b/g;

function parseDuration(matched: string): TimeHit | null {
  const d = Duration.fromISO(matched);
  if (!d.isValid) return null;
  // Luxon resolves P1Y to a flat 365 days (probed) and calendar months vary by
  // definition, so anything with Y or M before the T is approximate.
  const approximate = /^P[^T]*[YM]/.test(matched);
  return { kind: "duration", matched, totalMs: d.toMillis(), approximate };
}

function parseCronText(text: string, ctx: ParseCtx): TimeHit | null {
  const found = findCron(text);
  if (found === null) return null;
  // A plain list of integers ("scores were 1 2 3 4 5 tonight") is five
  // space-separated tokens, and every field alone is in-range, so findCron
  // happily explains it as a real schedule — fabricating a cron out of
  // ordinary prose containing no timestamp at all (reviewer finding, same
  // splice-bug class the RFC 2822 \b fix already paid for once this cycle).
  // Require at least one cron-only character before accepting; every
  // real-world cron expression uses one of these somewhere. Accepted
  // trade-off: an all-numeric cron like "0 0 1 1 0" is now unreachable too —
  // rare and semantically odd (it pins day-of-month AND day-of-week
  // simultaneously), and losing it is far cheaper than fabricating
  // schedules from a list of scores.
  if (!/[*/,-]/.test(found)) return null;
  try {
    const result = explainCron(found, ctx.tz);
    return { kind: "cron", matched: found, text: result.text, nextRuns: result.nextRuns };
  } catch {
    return null;
  }
}

export const FORMATS: readonly FormatSpec[] = [
  { tier: "strict", anchored: false, re: ISO_SCAN_RE, parse: parseIso },
  { tier: "strict", anchored: false, re: RFC2822_SCAN_RE, parse: parseRfc2822 },
  { tier: "strict", anchored: false, re: BASIC_ISO_SCAN_RE, parse: parseBasicIso },
  { tier: "strict", anchored: false, re: DISCORD_TAG_SCAN_RE, parse: parseDiscordTag },
  { tier: "strict", anchored: true, re: EPOCH_RE, parse: parseEpoch },
  { tier: "loose", anchored: false, re: DATE_ONLY_SCAN_RE, parse: parseDateOnly },
  { tier: "loose", anchored: false, re: NAMED_DATE_SCAN_RE, parse: parseNamedDate },
  { tier: "loose", anchored: false, re: SLASH_DATE_SCAN_RE, parse: parseSlashDate },
  { tier: "loose", anchored: false, re: TIME_ONLY_SCAN_RE, parse: parseTimeOnly },
  { tier: "loose", anchored: false, re: DURATION_SCAN_RE, parse: parseDuration },
];

interface Candidate {
  index: number;
  length: number;
  hit: TimeHit;
}

export function detectTime(text: string, opts: DetectOpts): TimeHit | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const ctx: ParseCtx = {
    nowMs: opts.nowMs ?? Date.now(),
    tz: opts.tz ?? DEFAULT_TZ,
  };

  const candidates: Candidate[] = [];
  for (const spec of FORMATS) {
    if (opts.tier === "strict" && spec.tier === "loose") continue;
    if (spec.anchored) {
      const m = spec.re.exec(trimmed);
      if (m === null) continue;
      const hit = spec.parse(m[0], ctx);
      if (hit !== null) candidates.push({ index: 0, length: m[0].length, hit });
      continue;
    }
    // matchAll needs /g and does not mutate lastIndex on the shared literal.
    for (const m of trimmed.matchAll(spec.re)) {
      const hit = spec.parse(m[0], ctx);
      if (hit !== null) candidates.push({ index: m.index, length: m[0].length, hit });
    }
  }
  if (candidates.length === 0) {
    // Cron does not fit the regex-driven FormatSpec shape — findCron already
    // scans lines and token windows itself. Reached only when the registry
    // found nothing, so a real timestamp always outranks a cron guess.
    if (opts.tier === "loose") return parseCronText(trimmed, ctx);
    return null;
  }
  // Earliest by index wins — the rule a user can predict without reading a
  // design doc. Length breaks an exact tie so the longer, more specific match
  // (a full ISO timestamp) beats the date-only prefix starting at the same
  // character.
  candidates.sort((a, b) => a.index - b.index || b.length - a.length);
  return candidates[0]!.hit;
}
