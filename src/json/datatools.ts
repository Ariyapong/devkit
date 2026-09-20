import { InputError } from "../errors.js";
import { locateJsonError } from "./json-error.js";

export interface DsvCell {
  text: string;
  quoted: boolean;
}

/**
 * RFC-4180 parser shared by CSV and TSV. Quoted fields may contain the
 * delimiter, doubled-quote escapes ("" -> ") and newlines. LF/CRLF row
 * endings; one trailing newline tolerated. The quoted flag drives type
 * inference later (quoted cells always stay strings).
 */
export function parseDsv(text: string, delimiter: "," | "\t"): DsvCell[][] {
  const src =
    text.endsWith("\r\n") ? text.slice(0, -2)
    : text.endsWith("\n") ? text.slice(0, -1)
    : text;
  if (src === "") throw new InputError("Empty input.");

  const rows: DsvCell[][] = [];
  let row: DsvCell[] = [];
  let cell = "";
  let quoted = false; // current cell started with an opening quote
  let inQuotes = false;
  let closed = false; // quoted cell has seen its closing quote

  const endCell = () => {
    row.push({ text: cell, quoted });
    cell = "";
    quoted = false;
    closed = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
          closed = true;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "" && !closed) {
      quoted = true;
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      endCell();
      continue;
    }
    if (ch === "\r" && src[i + 1] === "\n") continue; // the \n ends the row
    if (ch === "\n") {
      endRow();
      continue;
    }
    if (closed) {
      throw new InputError(
        `Row ${rows.length + 1}: unexpected text after a closing quote.`,
      );
    }
    cell += ch; // includes stray quotes mid-cell (lenient, like most parsers)
  }
  if (inQuotes) throw new InputError(`Row ${rows.length + 1}: unclosed quote.`);
  endRow();
  return rows;
}

/** Matches cells eligible for number conversion (a leading digit required). */
export const NUMERIC_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/** Smart inference for UNQUOTED cells; quoted cells are always strings. */
export function inferValue(cell: DsvCell): string | number | boolean | null {
  if (cell.quoted) return cell.text;
  const t = cell.text;
  if (t === "") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (NUMERIC_RE.test(t)) {
    if (/^-?0\d/.test(t)) return t; // 01234, -01: a redundant leading zero is data, not a number
    const n = Number(t);
    if (!Number.isFinite(n)) return t; // 1e999 etc. — not representable
    if (Number.isInteger(n) && !/[.eE]/.test(t) && !Number.isSafeInteger(n)) {
      return t; // a 19-digit ID must not silently lose precision
    }
    return n;
  }
  return t;
}

/** CSV/TSV text -> pretty JSON array of objects. First row = keys. */
export function csvToJson(input: string, delimiter: "," | "\t"): string {
  const [header, ...data] = parseDsv(input, delimiter);
  const keys = header!.map((c) => c.text);
  keys.forEach((k, i) => {
    if (k === "") throw new InputError(`Column ${i + 1} has an empty name.`);
    if (keys.indexOf(k) !== i) throw new InputError(`Duplicate column name "${k}".`);
  });
  const out = data.map((cells, i) => {
    if (cells.length !== keys.length) {
      throw new InputError(
        `Row ${i + 2} has ${cells.length} field(s), expected ${keys.length}.`,
      );
    }
    const obj: Record<string, unknown> = Object.create(null);
    cells.forEach((cell, ci) => {
      obj[keys[ci]!] = inferValue(cell);
    });
    return obj;
  });
  return JSON.stringify(out, null, 2);
}

/**
 * One output cell. Strings are quoted when they contain structure chars OR
 * would be inferred as non-string on the way back ("30", "true", ""), so
 * from-csv(to-csv(x)) round-trips for arrays of objects with uniform keys.
 */
function cellText(value: unknown, delimiter: "," | "\t"): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const s = typeof value === "string" ? value : JSON.stringify(value);
  const needsQuote =
    s.includes(delimiter) ||
    s.includes('"') ||
    s.includes("\n") ||
    s.includes("\r") ||
    s === "" ||
    s === "true" ||
    s === "false" ||
    NUMERIC_RE.test(s);
  return needsQuote ? `"${s.replaceAll('"', '""')}"` : s;
}

export type TableSource =
  | { kind: "objects"; keys: string[]; rows: unknown[][] }
  | { kind: "arrays"; rows: unknown[][] };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Shared input contract for /json to-csv, to-tsv and table: a non-empty array
 * of objects (keys unioned in first-seen order, rows aligned to them) or of
 * arrays (positional, rows left ragged — padding is the caller's business).
 *
 * The `kind` discriminator is required, not decoration: `[{}, {}]` is a valid
 * array *of objects* with zero keys, so an empty key list cannot signal
 * "positional" without silently changing to-csv's header behaviour.
 */
export function toRows(input: string): TableSource {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch (error) {
    const located = locateJsonError(input, error);
    throw new InputError(located.message, located.detail);
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new InputError("Input must be a non-empty JSON array of objects or of arrays.");
  }
  if (value.every(isPlainObject)) {
    const keys: string[] = [];
    for (const obj of value) {
      for (const k of Object.keys(obj)) if (!keys.includes(k)) keys.push(k);
    }
    const rows = value.map((obj) =>
      keys.map((k) => (Object.hasOwn(obj, k) ? obj[k] : undefined)),
    );
    return { kind: "objects", keys, rows };
  }
  if (value.every((v) => Array.isArray(v))) {
    return { kind: "arrays", rows: value as unknown[][] };
  }
  throw new InputError("Input must be a JSON array of objects or an array of arrays.");
}

/** JSON array (of objects, or of arrays) -> delimited text, LF endings. */
export function jsonToCsv(input: string, delimiter: "," | "\t"): string {
  const source = toRows(input);
  const body = source.rows.map((row) =>
    row.map((v) => cellText(v, delimiter)).join(delimiter),
  );
  if (source.kind === "arrays") return body.join("\n");
  return [source.keys.map((k) => cellText(k, delimiter)).join(delimiter), ...body].join("\n");
}

/** JSON Lines: every line must parse. ok ⇒ body is the records as a JSON array. */
export function validateJsonl(input: string): { ok: boolean; body: string } {
  const src =
    input.endsWith("\r\n") ? input.slice(0, -2)
    : input.endsWith("\n") ? input.slice(0, -1)
    : input;
  if (src.trim() === "") throw new InputError("Empty input.");
  const lines = src.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const values: unknown[] = [];
  const errors: string[] = [];
  lines.forEach((line, i) => {
    try {
      values.push(JSON.parse(line));
    } catch (error) {
      errors.push(`line ${i + 1}: ${(error as Error).message}`);
    }
  });
  if (errors.length === 0) return { ok: true, body: JSON.stringify(values, null, 2) };
  const more = errors.length > 10 ? [`…and ${errors.length - 10} more`] : [];
  return {
    ok: false,
    body: [
      `❌ ${errors.length} of ${lines.length} line(s) invalid`,
      ...errors.slice(0, 10),
      ...more,
    ].join("\n"),
  };
}

/** Query string / URL -> JSON object. Values stay strings; repeats become arrays. */
export function queryToJson(input: string): string {
  let q = input.trim();
  const qm = q.indexOf("?");
  if (qm !== -1) {
    q = q.slice(qm + 1);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(q)) {
    // A "scheme:" prefix with no "?" is a URI carrying no query — including
    // opaque ones like mailto:/tel:/urn: that have no "//". Bare query strings
    // start with "key=", so the "=" stops the scheme match before any ":".
    throw new InputError("No query parameters found.");
  }
  const hash = q.indexOf("#");
  if (hash !== -1) q = q.slice(0, hash);
  // Null prototype so a "__proto__" key is stored as plain data.
  const out: Record<string, string | string[]> = Object.create(null);
  for (const [key, val] of new URLSearchParams(q)) {
    const existing = out[key];
    if (existing === undefined) out[key] = val;
    else if (Array.isArray(existing)) existing.push(val);
    else out[key] = [existing, val];
  }
  if (Object.keys(out).length === 0) throw new InputError("No query parameters found.");
  return JSON.stringify(out, null, 2);
}
