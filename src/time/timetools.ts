import cronstrue from "cronstrue";
import cronParser from "cron-parser";
import { InputError } from "../errors.js";

export const COMMON_ZONES: readonly string[] = [
  "UTC",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Seoul",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export const DEFAULT_TZ = "Asia/Bangkok";

/**
 * Exported so every command surface can validate a `tz` option defensively.
 * An autocompleting string option does NOT constrain what Discord submits — the
 * user can type anything — so each entry point that accepts a zone must check
 * it, or the bad value reaches the formatter and renders "Invalid DateTime"
 * into the channel instead of the shared error text.
 */
export function assertZone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new InputError(`Unknown timezone "${tz}" — use an IANA name like Asia/Bangkok.`);
  }
}

/** Format an instant as "YYYY-MM-DD HH:mm" wall time in the given zone. */
export function formatInZone(date: Date, tz: string): string {
  assertZone(tz);
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${p["year"]}-${p["month"]}-${p["day"]} ${p["hour"]}:${p["minute"]}`;
}

/**
 * Offset of `tz` from UTC at the given instant, in ms (east = positive).
 *
 * `utcMs` is floored to the second before the subtraction because the formatter
 * above only resolves to `second`: `asIfUtc` therefore carries no milliseconds,
 * and subtracting an unfloored `utcMs` returned `trueOffset − ms`. zonedToUtc
 * then subtracts that from a wall time that already carries the same ms, so the
 * millisecond was added twice — "07:56:00.123" resolved to …:00.246. Floor,
 * not round: it must match how Intl truncates, and it is correct either side of
 * the epoch.
 */
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]),
  );
  const asIfUtc = Date.UTC(
    Number(p["year"]),
    Number(p["month"]) - 1,
    Number(p["day"]),
    Number(p["hour"]),
    Number(p["minute"]),
    Number(p["second"]),
  );
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Interpret wall-clock fields as a time in `tz`, return the UTC instant.
 * Single-pass offset correction — accurate to the minute except exactly at a
 * DST jump (acceptable for a chat utility; Thailand has no DST).
 */
function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
  s = 0,
  ms = 0,
): Date {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  return new Date(asUtc - tzOffsetMs(asUtc, tz));
}

const FULL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

function parseWallTime(
  time: string,
  tz: string,
  nowMs: number,
): Date {
  const full = FULL_RE.exec(time.trim());
  if (full) {
    return zonedToUtc(
      Number(full[1]),
      Number(full[2]),
      Number(full[3]),
      Number(full[4]),
      Number(full[5]),
      tz,
    );
  }
  const short = TIME_RE.exec(time.trim());
  if (short) {
    const today = formatInZone(new Date(nowMs), tz); // "YYYY-MM-DD HH:mm"
    const [y, mo, d] = today.slice(0, 10).split("-").map(Number);
    return zonedToUtc(y!, mo!, d!, Number(short[1]), Number(short[2]), tz);
  }
  throw new InputError('Time must look like "15:00" or "2026-07-20 15:00".');
}

export interface EpochInfo {
  seconds: number;
  ms: number;
  isoUtc: string;
  bangkok: string;
  detected: "seconds" | "ms" | "now";
}

export function epochInfo(value?: number, nowMs = Date.now()): EpochInfo {
  let ms: number;
  let detected: EpochInfo["detected"];
  if (value === undefined) {
    ms = nowMs;
    detected = "now";
  } else if (Math.abs(value) >= 1e12) {
    ms = value;
    detected = "ms";
  } else {
    ms = value * 1000;
    detected = "seconds";
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new InputError("Not a valid epoch value.");
  return {
    seconds: Math.floor(ms / 1000),
    ms,
    isoUtc: date.toISOString(),
    bangkok: formatInZone(date, DEFAULT_TZ),
    detected,
  };
}

/**
 * Lenient ISO 8601: date, then optional [ T]HH:mm[:ss[.fff]] with an optional
 * Z/±hh/±hhmm/±hh:mm offset. Offset is only legal when a time is present
 * ("2026-07-26Z" is not ISO). Lowercase t/z accepted; space separator and
 * hour-only offsets cover what Postgres and log files actually emit.
 */
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ tT](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([zZ]|[+-]\d{2}(?::?\d{2})?)?)?$/;

function parseOffsetMin(raw: string): number {
  if (raw.toLowerCase() === "z") return 0;
  const sign = raw.startsWith("-") ? -1 : 1;
  const digits = raw.slice(1).replace(":", "");
  const hh = Number(digits.slice(0, 2));
  const mm = digits.length > 2 ? Number(digits.slice(2)) : 0;
  if (mm >= 60 || hh * 60 + mm > 14 * 60) {
    throw new InputError(`Offset "${raw}" is out of range — real offsets stay within ±14:00.`);
  }
  return sign * (hh * 60 + mm);
}

function formatOffset(min: number): string {
  const abs = Math.abs(min);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${min < 0 ? "-" : "+"}${hh}:${mm}`;
}

/** Date.UTC silently rolls 2026-02-30 into March and maps years 0-99 into 1900-1999 — the round-trip catches both. */
function assertRealDate(y: number, mo: number, d: number): void {
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new InputError(`"${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}" is not a real calendar date.`);
  }
}

export interface IsoInfo {
  seconds: number;
  ms: number;
  isoUtc: string;
  bangkok: string;
  /** How the input was anchored: "offset +07:00 from input" or "<zone> wall time". */
  readAs: string;
}

export function isoInfo(input: string, tz?: string): IsoInfo {
  const m = ISO_RE.exec(input.trim());
  if (!m) {
    throw new InputError(
      'Couldn\'t read that as an ISO 8601 timestamp — try "2026-07-26T08:30:00Z" or "2026-07-26 08:30".',
    );
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4] ?? 0);
  const mi = Number(m[5] ?? 0);
  const s = Number(m[6] ?? 0);
  const msPart = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  const offRaw = m[8];

  assertRealDate(y, mo, d);
  if (h > 23 || mi > 59 || s > 59) {
    throw new InputError("Time of day out of range — hours 00-23, minutes and seconds 00-59.");
  }

  let instantMs: number;
  let readAs: string;
  if (offRaw) {
    if (tz !== undefined) {
      throw new InputError("The timestamp carries its own offset — drop the tz option.");
    }
    const offsetMin = parseOffsetMin(offRaw);
    instantMs = Date.UTC(y, mo - 1, d, h, mi, s, msPart) - offsetMin * 60_000;
    readAs = `offset ${formatOffset(offsetMin)} from input`;
  } else {
    const zone = tz ?? DEFAULT_TZ;
    assertZone(zone);
    instantMs = zonedToUtc(y, mo, d, h, mi, zone, s, msPart).getTime();
    readAs = `${zone} wall time`;
  }

  const date = new Date(instantMs);
  return {
    seconds: Math.floor(instantMs / 1000),
    ms: instantMs,
    isoUtc: date.toISOString(),
    bangkok: formatInZone(date, DEFAULT_TZ),
    readAs,
  };
}

export function convertTz(
  time: string,
  from: string,
  to: string,
  nowMs = Date.now(),
): { input: string; output: string } {
  assertZone(from);
  assertZone(to);
  const instant = parseWallTime(time, from, nowMs);
  return {
    input: formatInZone(instant, from),
    output: formatInZone(instant, to),
  };
}

export function explainCron(
  expression: string,
  tz = DEFAULT_TZ,
): { text: string; tz: string; nextRuns: string[] } {
  assertZone(tz);
  let text: string;
  try {
    text = cronstrue.toString(expression);
  } catch {
    throw new InputError("Invalid cron expression (expected 5 or 6 space-separated fields).");
  }
  let nextRuns: string[];
  try {
    const interval = cronParser.parseExpression(expression, { tz });
    nextRuns = Array.from({ length: 3 }, () =>
      formatInZone(interval.next().toDate(), tz),
    );
  } catch {
    throw new InputError("Cron expression could not be scheduled — check field ranges.");
  }
  return { text, tz, nextRuns };
}

const RELATIVE_RE = /^\+(\d+)([mhd])$/;

export function parseStamp(when: string, tz?: string, nowMs = Date.now()): number {
  if (tz !== undefined) assertZone(tz);
  const relative = RELATIVE_RE.exec(when.trim());
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[
      relative[2] as "m" | "h" | "d"
    ];
    return Math.floor((nowMs + amount * unitMs) / 1000);
  }
  const instant = parseWallTime(when, tz ?? DEFAULT_TZ, nowMs);
  return Math.floor(instant.getTime() / 1000);
}

/** Reply body for an explained cron — shared by /time cron and the message menu. */
export function renderCron(result: { text: string; tz: string; nextRuns: string[] }): string {
  return [
    `**${result.text}** (${result.tz})`,
    "Next runs:",
    ...result.nextRuns.map((run) => `• ${run}`),
  ].join("\n");
}
