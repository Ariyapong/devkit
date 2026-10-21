// RFC 6265 §5.1.1 cookie-date parser, with a hand-rolled ISO 8601 fallback.
// Never throws and never calls Date.parse, so results do not depend on the host zone.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MIN_YEAR = 1601;

/** RFC 6265 §5.1.1 delimiter: tab, space, and the ASCII punctuation ranges around digits and letters. */
function isDelimiter(cp: number): boolean {
  return (
    cp === 0x09 ||
    (cp >= 0x20 && cp <= 0x2f) ||
    (cp >= 0x3b && cp <= 0x40) ||
    (cp >= 0x5b && cp <= 0x60) ||
    (cp >= 0x7b && cp <= 0x7e)
  );
}

function isDigit(cp: number): boolean {
  return cp >= 0x30 && cp <= 0x39;
}

function tokenise(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const ch of text) {
    if (isDelimiter(ch.codePointAt(0)!)) {
      if (current !== "") tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

/** Reads between `min` and `max` ASCII digits from `chars` at `at`; the value and the next index, or null. */
function readDigits(chars: string[], at: number, min: number, max: number): { value: number; next: number } | null {
  let value = 0;
  let n = 0;
  while (at + n < chars.length && n < max && isDigit(chars[at + n]!.codePointAt(0)!)) {
    value = value * 10 + (chars[at + n]!.codePointAt(0)! - 0x30);
    n++;
  }
  return n < min ? null : { value, next: at + n };
}

/** True when `chars` has ended at `at` or the next character is not a digit (the RFC's "non-digit *OCTET" tail). */
function endsOrNonDigit(chars: string[], at: number): boolean {
  return at >= chars.length || !isDigit(chars[at]!.codePointAt(0)!);
}

function readTime(token: string): { h: number; m: number; s: number } | null {
  const chars = [...token];
  const h = readDigits(chars, 0, 1, 2);
  if (!h || chars[h.next] !== ":") return null;
  const m = readDigits(chars, h.next + 1, 1, 2);
  if (!m || chars[m.next] !== ":") return null;
  const s = readDigits(chars, m.next + 1, 1, 2);
  if (!s || !endsOrNonDigit(chars, s.next)) return null;
  return { h: h.value, m: m.value, s: s.value };
}

function readNumber(token: string, min: number, max: number): number | null {
  const chars = [...token];
  const d = readDigits(chars, 0, min, max);
  return d && endsOrNonDigit(chars, d.next) ? d.value : null;
}

function daysInMonth(year: number, month: number): number {
  // month is 0-based; day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function build(year: number, month: number, day: number, h: number, m: number, s: number, ms: number): number | null {
  if (year < MIN_YEAR || month < 0 || month > 11) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (h > 23 || m > 59 || s > 59) return null;
  return Date.UTC(year, month, day, h, m, s, ms);
}

function parseRfc(text: string): number | null {
  let time: { h: number; m: number; s: number } | null = null;
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  for (const token of tokenise(text)) {
    if (time === null) {
      const t = readTime(token);
      if (t) {
        time = t;
        continue;
      }
    }
    if (day === null) {
      const d = readNumber(token, 1, 2);
      if (d !== null) {
        day = d;
        continue;
      }
    }
    if (month === null && token.length >= 3) {
      const idx = MONTHS.indexOf(token.slice(0, 3).toLowerCase());
      if (idx !== -1) {
        month = idx;
        continue;
      }
    }
    if (year === null) {
      const y = readNumber(token, 2, 4);
      if (y !== null) year = y;
    }
  }
  if (time === null || day === null || month === null || year === null) return null;
  if (year >= 70 && year <= 99) year += 1900;
  else if (year >= 0 && year <= 69) year += 2000;
  return build(year, month, day, time.h, time.m, time.s, 0);
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** `YYYY-MM-DD`, or a full date-time with `Z` or an explicit `±HH:mm` offset. A bare local time is rejected. */
function parseIso(text: string): number | null {
  const m = ISO_RE.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (m[8] === undefined) return build(year, month, day, 0, 0, 0, 0);
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0"));
  const at = build(year, month, day, Number(m[4]), Number(m[5]), m[6] === undefined ? 0 : Number(m[6]), ms);
  if (at === null) return null;
  if (m[8] === "Z") return at;
  const offH = Number(m[8].slice(1, 3));
  const offM = Number(m[8].slice(4, 6));
  if (offH > 23 || offM > 59) return null;
  const offset = (offH * 60 + offM) * 60_000;
  return m[8].startsWith("-") ? at + offset : at - offset;
}

/** Epoch milliseconds (UTC) for an RFC 6265 cookie-date, or an ISO 8601 UTC/offset form; null when unreadable. */
export function parseCookieDate(text: string): number | null {
  return parseRfc(text) ?? parseIso(text.trim());
}
