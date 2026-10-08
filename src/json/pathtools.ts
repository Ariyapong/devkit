import { InputError } from "../errors.js";
import type { ErrorDetail } from "../errors.js";
import { excerptAt } from "./json-error.js";
import { parseJsonOrThrow } from "./parse.js";

export type PathSegment = { kind: "key"; key: string } | { kind: "index"; index: number };

export const MAX_PATH_CHARS = 1024;

/** Excerpt over the path with C0 controls shown as spaces, so it is always one row. */
function pathDetail(path: string, column: number): ErrorDetail {
  const shown = path.replace(/[\u0000-\u001f]/g, " ");
  const { lines, caretLine } = excerptAt(shown, { line: 1, column });
  return { kind: "excerpt", position: { line: 1, column }, lines, caretLine };
}

function syntaxError(path: string, at: number): InputError {
  return new InputError("Invalid path.", pathDetail(path, at + 1));
}

/**
 * `$`-optional dot/bracket paths: `.name`, `["name"]`, `['name']`, `[n]`,
 * `[-n]`. `$` is consumed only when followed by `.`, `[` or the end, so `$a`
 * is the key `$a`. Whitespace is literal. Empty dot segments and C0 controls
 * are syntax errors.
 */
export function parsePath(path: string): PathSegment[] {
  if (path.length > MAX_PATH_CHARS) throw new InputError("Path is too long.");
  const control = /[\u0000-\u001f]/.exec(path);
  if (control) throw syntaxError(path, control.index);

  const segments: PathSegment[] = [];
  let i = 0;
  if (path[0] === "$" && (path.length === 1 || path[1] === "." || path[1] === "[")) i = 1;
  if (i === path.length) return segments;
  // A leading '.' is optional on the first segment; a bracket may start too.
  let first = true;
  while (i < path.length) {
    const ch = path[i]!;
    if (ch === "." || (first && ch !== "[")) {
      const start = ch === "." ? i + 1 : i;
      if (ch === "." ) i++;
      let end = i;
      while (end < path.length && path[end] !== "." && path[end] !== "[" && path[end] !== "]") end++;
      if (end === start) throw syntaxError(path, start < path.length ? start : start - 1);
      segments.push({ kind: "key", key: path.slice(start, end) });
      i = end;
    } else if (ch === "[") {
      const open = i;
      i++;
      const q = path[i];
      if (q === '"' || q === "'") {
        i++;
        let key = "";
        for (;;) {
          if (i >= path.length) throw syntaxError(path, open);
          const c = path[i]!;
          if (c === "\\") {
            const next = path[i + 1];
            if (next !== q && next !== "\\") throw syntaxError(path, i);
            key += next;
            i += 2;
            continue;
          }
          if (c === q) break;
          key += c;
          i++;
        }
        i++; // closing quote
        if (path[i] !== "]") throw syntaxError(path, i < path.length ? i : open);
        i++;
        segments.push({ kind: "key", key });
      } else {
        const m = /^-?\d+/.exec(path.slice(i));
        if (!m || path[i + m[0].length] !== "]") throw syntaxError(path, i + (m ? m[0].length : 0));
        segments.push({ kind: "index", index: Number(m[0]) });
        i += m[0].length + 1;
      }
    } else {
      throw syntaxError(path, i);
    }
    first = false;
  }
  return segments;
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return `an array with ${value.length} item(s)`;
  if (value !== null && typeof value === "object") return `an object with ${Object.keys(value).length} key(s)`;
  return `a ${value === null ? "null" : typeof value}`;
}

/** Column (1-based) where segment `n` starts in `path`, for the miss caret. */
function segmentStart(path: string, n: number): number {
  let i = 0;
  if (path[0] === "$" && (path.length === 1 || path[1] === "." || path[1] === "[")) i = 1;
  let seen = 0;
  while (i < path.length) {
    const ch = path[i]!;
    if (ch === ".") {
      if (seen === n) return i + 1;
      seen++;
      i++;
      while (i < path.length && path[i] !== "." && path[i] !== "[") i++;
    } else if (ch === "[") {
      if (seen === n) return i + 1;
      seen++;
      const q = path[i + 1];
      if (q === '"' || q === "'") {
        i += 2;
        while (i < path.length && !(path[i] === q && path[i - 1] !== "\\")) i++;
        i += 2;
      } else {
        while (i < path.length && path[i] !== "]") i++;
        i++;
      }
    } else {
      if (seen === n) return i + 1;
      seen++;
      while (i < path.length && path[i] !== "." && path[i] !== "[") i++;
    }
  }
  return path.length + 1;
}

function pathPrefix(path: string, upToSegment: number): string {
  // The text of the path up to and including segment `upToSegment`.
  const nextStart = segmentStart(path, upToSegment + 1);
  const raw = path.slice(0, nextStart - 1);
  return raw.endsWith(".") ? raw.slice(0, -1) : raw;
}

/** Parses `input` and walks `path`. Misses throw InputError with the segment named. */
export function queryJson(input: string, path: string): unknown {
  const segments = parsePath(path);
  let value: unknown = parseJsonOrThrow(input);
  for (let n = 0; n < segments.length; n++) {
    const seg = segments[n]!;
    const where = pathPrefix(path, n);
    const miss = (reason: string) =>
      new InputError(`Path not found at "${where}": ${reason}.`, pathDetail(path, segmentStart(path, n)));
    // Scalars get a bare description; a container of the wrong kind names
    // the kind that was wanted. Both wordings are pinned in the tests.
    const isContainer = value !== null && typeof value === "object";
    if (seg.kind === "key") {
      if (!isContainer) throw miss(`the value there is ${describe(value)}`);
      if (Array.isArray(value)) throw miss(`the value there is ${describe(value)}, not an object`);
      if (!Object.hasOwn(value as object, seg.key)) throw miss("the key does not exist");
      value = (value as Record<string, unknown>)[seg.key];
    } else {
      if (!isContainer) throw miss(`the value there is ${describe(value)}`);
      if (!Array.isArray(value)) throw miss(`the value there is ${describe(value)}, not an array`);
      const at = seg.index < 0 ? value.length + seg.index : seg.index;
      if (at < 0 || at >= value.length) throw miss(`the index is out of range (${value.length} item(s))`);
      value = value[at];
    }
  }
  return value;
}
