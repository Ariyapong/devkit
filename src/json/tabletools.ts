import { toRows } from "./datatools.js";
import { InputError } from "../errors.js";

/** Cells are capped to keep rows short enough to avoid wrapping, which destroys
 *  the column alignment entirely. The cap counts graphemes BEFORE pipe-escaping,
 *  so a pipe-dense cell can still print about twice this wide — alignment holds
 *  regardless, because widths are measured post-escape. The ellipsis counts
 *  toward the cap. */
export const MAX_CELL = 24;

// Runtime default locale is required — a fixed locale silently degrades Thai.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Display width in graphemes. `.length` is wrong here: it counts เสี่ยวเอ้อ as
 * 10 and 🎲 as 2, so padding on it visibly breaks alignment on Thai data.
 * CJK and emoji stay undercounted (1 grapheme, ~2 columns) — documented limit.
 */
export function graphemeLength(text: string): number {
  return [...segmenter.segment(text)].length;
}

/** Truncate to `cap` graphemes, the ellipsis counting toward the cap. Never
 *  splits a combining sequence. */
export function truncateGraphemes(text: string, cap: number): string {
  const parts = [...segmenter.segment(text)].map((part) => part.segment);
  if (parts.length <= cap) return text;
  // Clamped: an unguarded cap <= 0 reads as slice(0, -1) and would return
  // nearly the whole string instead of cutting it.
  return parts.slice(0, Math.max(0, cap - 1)).join("") + "…";
}

export interface CellRender {
  text: string;
  truncated: boolean;
}

/**
 * JSON value → one table cell. The order is load-bearing: flatten before
 * truncating so no newline survives, and truncate BEFORE escaping so a cut can
 * never land between the backslash and pipe of an escaped `\|`.
 */
export function cellDisplay(value: unknown): CellRender {
  const raw =
    value === null || value === undefined ? ""
    : typeof value === "string" ? value
    : typeof value === "number" || typeof value === "boolean" ? String(value)
    : (JSON.stringify(value) ?? "");
  const flat = raw.replace(/[\n\r\t\f\v\u2028\u2029]+/g, " ");
  const cut = truncateGraphemes(flat, MAX_CELL);
  return { text: cut.replaceAll("|", "\\|"), truncated: cut !== flat };
}

/**
 * A column is numeric iff it holds at least one non-empty value and every
 * non-empty value is a JSON number. "Empty" means null/undefined only — an
 * empty *string* is a string value and makes the column non-numeric.
 * Detection is on the JSON type, so "30" as a string stays left-aligned.
 */
function isNumericColumn(rows: unknown[][], index: number): boolean {
  let seen = false;
  for (const row of rows) {
    const value = row[index];
    if (value === null || value === undefined) continue;
    if (typeof value !== "number") return false;
    seen = true;
  }
  return seen;
}

/** JSON array of objects (or of arrays) -> aligned markdown pipe table. */
export function jsonToTable(input: string): string {
  const source = toRows(input);
  const columnCount =
    source.kind === "objects"
      ? source.keys.length
      : Math.max(...source.rows.map((row) => row.length));
  if (columnCount === 0) {
    throw new InputError("No columns found — the rows carry no keys or values.");
  }
  // Markdown requires a header row, so positional data gets synthetic names.
  const headers =
    source.kind === "objects"
      ? source.keys
      : Array.from({ length: columnCount }, (_, i) => `c${i + 1}`);
  // Positional rows arrive ragged; object rows are already key-aligned.
  const values = source.rows.map((row) =>
    Array.from({ length: columnCount }, (_, i) => row[i]),
  );

  let truncated = 0;
  const render = (value: unknown): string => {
    const cell = cellDisplay(value);
    if (cell.truncated) truncated++;
    return cell.text;
  };
  const headerCells = headers.map(render);
  const bodyCells = values.map((row) => row.map(render));

  const numeric = Array.from({ length: columnCount }, (_, i) => isNumericColumn(values, i));
  const widths = Array.from({ length: columnCount }, (_, i) =>
    Math.max(
      graphemeLength(headerCells[i] ?? ""),
      ...bodyCells.map((row) => graphemeLength(row[i] ?? "")),
    ),
  );

  const pad = (text: string, width: number, right: boolean): string => {
    const gap = " ".repeat(Math.max(0, width - graphemeLength(text)));
    return right ? gap + text : text + gap;
  };
  const line = (cells: string[]): string => `| ${cells.join(" | ")} |`;

  const lines = [
    line(headerCells.map((cell, i) => pad(cell, widths[i]!, false))),
    `|${widths.map((w, i) => (numeric[i] ? "-".repeat(w + 1) + ":" : "-".repeat(w + 2))).join("|")}|`,
    ...bodyCells.map((row) => line(row.map((cell, i) => pad(cell, widths[i]!, numeric[i]!)))),
  ];
  if (truncated > 0) lines.push("", `… ${truncated} cell(s) shortened to fit`);
  return lines.join("\n");
}
