import { InputError } from "../errors.js";

/** Cap measured in UTF-16 units (`input.length`) — the unit Discord itself limits. */
export const MAX_COUNT_CHARS = 4000;

/** Words per minute used for the reading-time estimate (English-calibrated). */
const READING_WPM = 200;

// Constructed once — Segmenters are stateless and construction is the costly part.
// Locale is deliberately `undefined` (runtime default); hardcoding "en" would
// disable Thai dictionary segmentation.
const GRAPHEME_SEG = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WORD_SEG = new Intl.Segmenter(undefined, { granularity: "word" });
const SENTENCE_SEG = new Intl.Segmenter(undefined, { granularity: "sentence" });
const ENCODER = new TextEncoder();

const WHITESPACE_ONLY = /^[\s\p{Zs}]+$/u;

export interface CountResult {
  graphemes: number;
  graphemesNoSpace: number;
  words: number;
  lines: number;
  sentences: number; // approximate — see renderCount's footnote
  codepoints: number;
  utf16units: number;
  utf8bytes: number;
  readingSeconds: number; // approximate
}

export function countText(rawInput: string): CountResult {
  if (rawInput.trim().length === 0) throw new InputError("Enter some text to count.");
  if (rawInput.length > MAX_COUNT_CHARS) {
    throw new InputError(
      `Too long — count at most ${MAX_COUNT_CHARS} UTF-16 units (got ${rawInput.length}).`,
    );
  }

  // Normalize line endings first so CRLF does not inflate grapheme/byte counts.
  const input = rawInput.replace(/\r\n/g, "\n");

  const graphemeSegments = [...GRAPHEME_SEG.segment(input)];
  const words = [...WORD_SEG.segment(input)].filter((s) => s.isWordLike).length;

  // A trailing newline terminates the last line rather than starting an empty
  // one: "a\nb\n" is 2 lines, matching wc -l.
  const rawLines = input.split("\n");
  const lines =
    rawLines.length > 1 && rawLines.at(-1) === "" ? rawLines.length - 1 : rawLines.length;

  return {
    graphemes: graphemeSegments.length,
    graphemesNoSpace: graphemeSegments.filter((s) => !WHITESPACE_ONLY.test(s.segment)).length,
    words,
    lines,
    sentences: [...SENTENCE_SEG.segment(input)].filter((s) => s.segment.trim().length > 0).length,
    codepoints: [...input].length,
    utf16units: input.length,
    utf8bytes: ENCODER.encode(input).length,
    readingSeconds: Math.max(1, Math.ceil((words / READING_WPM) * 60)),
  };
}

/** "45s" · "2m 30s" · "2m" — never "2m 0s". */
function formatReadingTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/** Render an aligned monospace block for a fenced code block. */
export function renderCount(r: CountResult): string {
  const rows: [string, string][] = [
    ["Characters", `${r.graphemes}`],
    ["Words", `${r.words}`],
    ["Lines", `${r.lines}`],
    ["Sentences", `~${r.sentences}`],
    ["Reading time", `~${formatReadingTime(r.readingSeconds)}`],
    ["  Code points", `${r.codepoints}`],
    ["  UTF-16 units", `${r.utf16units}`],
    ["  UTF-8 bytes", `${r.utf8bytes}`],
  ];
  // One width across both blocks so the value column lines up throughout.
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const valueWidth = Math.max(...rows.map(([, value]) => value.length));
  const fmt = ([label, value]: [string, string]) =>
    `${label.padEnd(labelWidth)}  ${value.padStart(valueWidth)}`;

  const main = rows.slice(0, 5).map(fmt);
  main[0] += `   (no spaces: ${r.graphemesNoSpace})`;
  const encoding = rows.slice(5).map(fmt);

  return [
    ...main,
    "",
    "Encoding",
    ...encoding,
    "",
    "ⓘ Sentence and reading-time figures are estimates. Thai and Chinese text",
    "  has no sentence punctuation, so counts there run low.",
  ].join("\n");
}
