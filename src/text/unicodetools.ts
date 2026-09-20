import { InputError } from "../errors.js";

export type NormForm = "NFC" | "NFD" | "NFKC" | "NFKD";

export const UNICODE_MAX_CODEPOINTS = 64;

// Probed in order; the first matching general-category wins. Dep-free.
const GC_CLASSES = [
  "Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Nl", "No",
  "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po", "Sm", "Sc", "Sk", "So",
  "Zs", "Zl", "Zp", "Cc", "Cf", "Cs", "Co",
] as const;
const GC_REGEX: [string, RegExp][] = GC_CLASSES.map((gc) => [gc, new RegExp(`\\p{gc=${gc}}`, "u")]);

/** General category via stdlib regex probing; "Cn" (unassigned) if nothing matches. */
export function generalCategory(cp: number): string {
  const ch = String.fromCodePoint(cp);
  for (const [gc, re] of GC_REGEX) if (re.test(ch)) return gc;
  return "Cn";
}

function hex4(cp: number): string {
  return cp.toString(16).toUpperCase().padStart(4, "0");
}

const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;

/**
 * Default-ignorable code points have no visible glyph (variation selectors,
 * Hangul fillers, ZWJ/ZWSP, bidi controls, BOM, combining grapheme joiner).
 * Label them, never emit raw — this is the tool's Trojan-Source defense.
 */
function isDefaultIgnorable(cp: number): boolean {
  return DEFAULT_IGNORABLE.test(String.fromCodePoint(cp));
}

/** A safe display glyph: never emit raw control/bidi/format characters. */
function displayGlyph(cp: number, gc: string): string {
  if (cp <= 0x20) return String.fromCodePoint(0x2400 + cp); // Control Pictures (incl. space)
  if (cp === 0x7f) return "␡"; // SYMBOL FOR DELETE
  if (["Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp", "Zs"].includes(gc)) return `[U+${hex4(cp)}]`;
  if (isDefaultIgnorable(cp)) return `[U+${hex4(cp)}]`;
  if (/\p{M}/u.test(String.fromCodePoint(cp))) return "◌" + String.fromCodePoint(cp); // ◌ + mark
  return String.fromCodePoint(cp);
}

function surrogatePair(cp: number): string {
  const c = cp - 0x10000;
  const hi = 0xd800 + (c >> 10);
  const lo = 0xdc00 + (c & 0x3ff);
  return `\\u${hi.toString(16).toUpperCase()}\\u${lo.toString(16).toUpperCase()}`;
}

export interface CodepointRow {
  hex: string; // "U+0041"
  glyph: string;
  category: string;
  jsEscape: string;
  xEscape: string;
  htmlEntity: string;
  utf8: string;
  illFormed: boolean;
}

export interface InspectSummary {
  graphemes: number;
  codepoints: number;
  utf16units: number;
  utf8bytes: number;
  isNFC: boolean;
  normalizedApplied: NormForm | null;
}

export interface InspectResult {
  summary: InspectSummary;
  rows: CodepointRow[];
}

export function inspectUnicode(rawInput: string, normalize?: NormForm): InspectResult {
  const input = normalize ? rawInput.normalize(normalize) : rawInput;
  if (input.length === 0) throw new InputError("Enter some text to inspect.");
  const codepoints = [...input];
  if (codepoints.length > UNICODE_MAX_CODEPOINTS) {
    throw new InputError(
      `Too long — inspect at most ${UNICODE_MAX_CODEPOINTS} code points (got ${codepoints.length}).`,
    );
  }
  const encoder = new TextEncoder();
  const rows: CodepointRow[] = codepoints.map((ch) => {
    const cp = ch.codePointAt(0)!;
    const gc = generalCategory(cp);
    const isSurrogate = cp >= 0xd800 && cp <= 0xdfff;
    return {
      hex: `U+${hex4(cp)}`,
      glyph: displayGlyph(cp, gc),
      category: gc,
      jsEscape:
        cp <= 0xffff
          ? `\\u${hex4(cp)}`
          : `\\u{${cp.toString(16).toUpperCase()}} (${surrogatePair(cp)})`,
      xEscape: cp <= 0xff ? `\\x${cp.toString(16).toUpperCase().padStart(2, "0")}` : "—",
      htmlEntity: `&#x${cp.toString(16).toUpperCase()};`,
      utf8: isSurrogate
        ? "— (ill-formed)"
        : [...encoder.encode(ch)].map((b) => b.toString(16).padStart(2, "0")).join(" "),
      illFormed: isSurrogate,
    };
  });
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const summary: InspectSummary = {
    graphemes: [...seg.segment(input)].length,
    codepoints: codepoints.length,
    utf16units: input.length,
    utf8bytes: encoder.encode(input).length,
    isNFC: input === input.normalize("NFC"),
    normalizedApplied: normalize ?? null,
  };
  return { summary, rows };
}

/** Render an aligned monospace table for a fenced code block. */
export function renderInspection(result: InspectResult): string {
  const s = result.summary;
  const summaryLine =
    `Graphemes ${s.graphemes} · Code points ${s.codepoints} · ` +
    `UTF-16 units ${s.utf16units} · UTF-8 bytes ${s.utf8bytes} · ` +
    `NFC: ${s.isNFC ? "yes" : "no"}` +
    (s.normalizedApplied ? ` · normalized: ${s.normalizedApplied}` : "");
  const header = ["CP", "CHAR", "GC", "JS", "\\x", "HTML", "UTF-8"];
  const table = result.rows.map((r) => [
    r.hex, r.glyph, r.category, r.jsEscape, r.xEscape, r.htmlEntity, r.utf8,
  ]);
  const widths = header.map((h, c) => Math.max(h.length, ...table.map((row) => row[c]!.length)));
  const fmt = (row: string[]) => row.map((cell, c) => cell.padEnd(widths[c]!)).join("  ").trimEnd();
  const lines = [fmt(header), ...table.map(fmt)];
  return `${summaryLine}\n\n${lines.join("\n")}\n\nⓘ Character names are not shown in this version.`;
}
