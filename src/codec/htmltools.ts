/** The five characters that carry meaning in HTML markup. */
const ENCODE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape the five markup-significant characters. Everything else passes through
 * as UTF-8 — Thai and emoji stay readable, which is the point.
 *
 * The single pass is load-bearing: replacing `&` in an earlier pass would
 * re-encode the ampersands this function itself emits (`&amp;amp;`).
 * `'` becomes `&#39;` and not `&apos;` — the latter is absent from HTML 4.01.
 */
export function htmlEncode(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ENCODE_MAP[char]!);
}

import { NAMED_ENTITIES } from "./htmlentities.js";

/**
 * HTML remaps the C1 range 0x80-0x9F through windows-1252 rather than taking it
 * literally, because pages authored in that encoding depend on it. Without this
 * `&#128;` yields an invisible control character instead of `€`.
 */
const WINDOWS_1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

const REPLACEMENT = "�";

/** Numeric character reference → the character it denotes. */
function numericToChar(digits: string, hex: boolean): string {
  const code = Number.parseInt(digits, hex ? 16 : 10);
  if (!Number.isFinite(code)) return REPLACEMENT;
  const remapped = WINDOWS_1252[code];
  if (remapped !== undefined) return String.fromCodePoint(remapped);
  // Null, the surrogate range, and anything past the Unicode maximum are not
  // representable — the spec says emit U+FFFD rather than throw.
  if (code === 0 || code > 0x10ffff) return REPLACEMENT;
  if (code >= 0xd800 && code <= 0xdfff) return REPLACEMENT;
  return String.fromCodePoint(code);
}

/**
 * The `;?` on the numeric branches is load-bearing — without it `&#39;` decodes
 * to "'" and strands the semicolon, breaking every round-trip containing an
 * apostrophe. The `0-9` in the name tail is too: 24 entity names carry digits
 * (`frac12`, `emsp13`, `sup1`), which a bare `[a-zA-Z]+` would never match.
 */
const REFERENCE = /&(?:#([0-9]+);?|#[xX]([0-9a-fA-F]+);?|([a-zA-Z][a-zA-Z0-9]*);)/g;

/**
 * HTML entities → text. Named references require the semicolon; numeric ones
 * accept it optionally. Anything unrecognised is left exactly as it was, which
 * is what a browser does — so this never throws, unlike `urlDecode`.
 *
 * One pass only: `&amp;lt;` yields `&lt;`, not `<`. Decoding until stable would
 * hide the double-encoding the user is usually trying to diagnose.
 */
export function htmlDecode(input: string): string {
  return input.replace(REFERENCE, (match, decimal, hex, name) => {
    if (decimal !== undefined) return numericToChar(decimal, false);
    if (hex !== undefined) return numericToChar(hex, true);
    const hit = Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : undefined;
    return hit ?? match;
  });
}
