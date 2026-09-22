/**
 * Turns a JSON.parse failure into a message that shows WHERE the problem is.
 *
 * Callers: jsontools.parseJsonOrThrow and datatools.toRows — two independent
 * copies of the same throw, which is why this lives in a leaf module both can
 * import. It must never import from either of them: jsontools already imports
 * datatools, and closing that loop is a TDZ crash at startup.
 *
 * The result reaches the user's reply, never a log line — sanitizeError
 * collapses an InputError to its class name (`sanitizeError` in errors.ts). The excerpt fence
 * is no longer applied here — `./discord`'s `renderErrorDetail` renders
 * `detail` into the fenced, Discord-shaped string.
 */
import type { ErrorDetail } from "../errors.js";

export interface LocatedError {
  message: string;
  detail?: ErrorDetail;
}

interface Position {
  line: number;
  column: number;
}

/**
 * Node 22's V8 reports "(line 5 column 3)"; Node 20 reports only
 * "at position 60". Prefer the explicit pair, derive it otherwise, and give up
 * when neither exists ("Unexpected end of JSON input" carries no position).
 */
function readPosition(message: string, input: string): Position | null {
  // Anchored to the end: every genuine V8 shape (the line/column pair, the
  // offset-only fallback, and the "after JSON at position N" variant) ends
  // its message with the position clause. An unanchored match lets a
  // "<snippet> is not valid JSON" message — which echoes user input verbatim
  // — get hijacked by payload text that merely looks like a position clause.
  const pair = /\(line (\d+) column (\d+)\)$/.exec(message);
  if (pair !== null) {
    return { line: Number(pair[1]), column: Number(pair[2]) };
  }
  const offset = /at position (\d+)$/.exec(message);
  if (offset === null) return null;
  return fromOffset(input, Number(offset[1]));
}

function fromOffset(input: string, offset: number): Position {
  const clamped = Math.min(Math.max(offset, 0), input.length);
  const before = input.slice(0, clamped);
  const lastBreak = before.lastIndexOf("\n");
  return {
    line: before.split("\n").length,
    column: clamped - lastBreak,
  };
}

/** The reason without its position suffix; unmodified if the shape differs. */
function stripPosition(message: string): string {
  // Anchored for the same reason as readPosition's regexes: unanchored, these
  // can eat a fragment of a "<snippet> is not valid JSON" echo that merely
  // contains the words "at position N", degrading the reason instead of
  // leaving it untouched.
  return message
    .replace(/\s*in JSON at position \d+(\s*\(line \d+ column \d+\))?$/, "")
    .replace(/\s*at position \d+(\s*\(line \d+ column \d+\))?$/, "")
    .trim();
}

/**
 * Upper bound on every line printed in the excerpt. The line containing the
 * error is windowed around the column when it exceeds this; every other
 * printed line is hard-truncated to it. Unbounded neighbour lines are how a
 * long value (a JWT, a base64 blob) next to the error — not on it — used to
 * blow Discord's 2000-char reply cap on a path with no attachment fallback.
 */
const MAX_LINE = 100;
/** Characters kept either side of the error column when windowing. */
const WINDOW = 40;

/**
 * A minified payload is one enormous line, so the line number is worthless and
 * only the neighbourhood of the column helps. `…` marks a side that was cut;
 * the caret index is relative to the returned slice, not the original line.
 */
function windowLine(line: string, column: number): { text: string; caret: number } {
  const at = column - 1;
  const start = Math.max(0, at - WINDOW);
  const end = Math.min(line.length, at + WINDOW + 1);
  const head = start > 0 ? "…" : "";
  const tail = end < line.length ? "…" : "";
  return { text: head + line.slice(start, end) + tail, caret: head.length + (at - start) };
}

export function locateJsonError(input: string, error: unknown): LocatedError {
  const native = error instanceof Error ? error.message : String(error);
  const position = readPosition(native, input);
  if (position === null) return { message: `Invalid JSON: ${native}` };

  const lines = input.split(/\r?\n/);
  const index = Math.min(
    Math.max(position.line - 1, 0),
    Math.max(lines.length - 1, 0),
  );
  const target = lines[index] ?? "";
  // length + 1, not length: "unexpected end" points one past the last
  // character, and clamping harder would put the caret under the wrong column
  // while the header above it still reported the real one.
  const column = Math.min(Math.max(position.column, 1), target.length + 1);

  const windowed = target.length > MAX_LINE;
  const shown = windowed
    ? [index]
    : [index - 1, index, index + 1].filter((i) => i >= 0 && i < lines.length);
  const gutter = String(Math.max(...shown) + 1).length;

  // Loop-invariant: `windowed` implies `shown` is the single-element
  // `[index]`, so this depends only on values fixed before the loop starts.
  // Computed once here rather than per-iteration.
  const slice = windowed ? windowLine(target, column) : null;

  const rows: string[] = [];
  let caretLine = -1;
  for (const i of shown) {
    const raw = lines[i]!;
    const text = slice ? slice.text : raw.length > MAX_LINE ? raw.slice(0, MAX_LINE) + "…" : raw;
    rows.push(`  ${String(i + 1).padStart(gutter)} | ${text}`);
    if (i === index) {
      const caret = slice ? slice.caret : column - 1;
      rows.push(`  ${" ".repeat(gutter)} | ${" ".repeat(caret)}^`);
      caretLine = rows.length - 1;
    }
  }
  return {
    message: `Invalid JSON: ${stripPosition(native)}`,
    detail: {
      kind: "excerpt",
      position,
      positionLine: `  line ${position.line}, column ${position.column}`,
      lines: rows,
      caretLine,
    },
  };
}
