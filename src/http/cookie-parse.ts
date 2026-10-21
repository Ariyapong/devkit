import { InputError } from "../errors.js";
import { auditCookieHeader } from "./cookie-audit.js";
import { parseNetscapeJar } from "./cookie-out.js";
import { finishSetCookie, makeCookie } from "./cookie-row.js";
import { MAX_COOKIE_INPUT_CHARS } from "./cookie-types.js";
import type { AuditFinding, CookieInputKind, CookieParseResult, ParsedCookie, SetCookieAttributes } from "./cookie-types.js";

const SEPARATORS = "()<>@,;:\\\"/[]?={} \t";

/** True for an RFC 7230 token character, judged by code point. */
function isTokenChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code > 32 && code < 127 && !SEPARATORS.includes(ch);
}

function isLetter(ch: string): boolean {
  const lower = ch.toLowerCase();
  return lower >= "a" && lower <= "z" && lower.length === 1;
}

function splitPair(pair: string): [name: string, value: string] {
  const eq = pair.indexOf("=");
  return eq === -1 ? ["", pair] : [pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()];
}

function emptyAttributes(): SetCookieAttributes {
  return {
    domain: null,
    path: null,
    expires: null,
    maxAge: null,
    secure: false,
    httpOnly: false,
    sameSite: null,
    sameSiteRaw: null,
    partitioned: false,
    priority: null,
    unknown: [],
    duplicates: [],
  };
}

export function parseCookieHeader(text: string): ParsedCookie[] {
  const body = text.replace(/^\s*cookie\s*:/i, "");
  const out: ParsedCookie[] = [];
  for (const segment of body.split(";")) {
    const pair = segment.trim();
    if (pair === "") continue;
    const [name, value] = splitPair(pair);
    const cookie = makeCookie(name, value, null, pair);
    cookie.audit = auditCookieHeader(cookie);
    out.push(cookie);
  }
  return out;
}

const SAME_SITE = { strict: "Strict", lax: "Lax", none: "None" } as const;
const KNOWN_ATTRIBUTES = ["expires", "max-age", "domain", "path", "secure", "httponly", "samesite", "partitioned", "priority"];
const PRIORITY = { low: "Low", medium: "Medium", high: "High" } as const;

export function parseSetCookie(line: string, opts?: { nowMs?: number }): ParsedCookie {
  const nowMs = opts?.nowMs ?? Date.now();
  const trimmed = line.trim();
  const segments = trimmed.replace(/^set-cookie\s*:/i, "").split(";");
  const [name, value] = splitPair((segments[0] ?? "").trim());
  const attrs = emptyAttributes();
  const seen = new Set<string>();
  const repeated = new Set<string>();

  for (const segment of segments.slice(1)) {
    const text = segment.trim();
    if (text === "") continue;
    const eq = text.indexOf("=");
    const attrName = (eq === -1 ? text : text.slice(0, eq)).trim();
    const attrValue = eq === -1 ? null : text.slice(eq + 1).trim();
    const key = attrName.toLowerCase();
    if (KNOWN_ATTRIBUTES.includes(key)) {
      if (seen.has(key)) repeated.add(key);
      seen.add(key);
    }
    switch (key) {
      case "secure":
        attrs.secure = true;
        break;
      case "httponly":
        attrs.httpOnly = true;
        break;
      case "partitioned":
        attrs.partitioned = true;
        break;
      case "domain":
      case "path":
      case "expires":
        attrs[key] = attrValue ?? "";
        break;
      case "max-age":
        if (attrValue !== null && /^-?\d+$/.test(attrValue)) attrs.maxAge = Number(attrValue);
        else attrs.unknown.push([attrName, attrValue]);
        break;
      case "samesite": {
        const canonical = SAME_SITE[(attrValue ?? "").toLowerCase() as keyof typeof SAME_SITE];
        if (canonical) {
          attrs.sameSite = canonical;
          attrs.sameSiteRaw = null;
        } else {
          attrs.sameSite = null;
          attrs.sameSiteRaw = attrValue ?? "";
        }
        break;
      }
      case "priority": {
        const canonical = PRIORITY[(attrValue ?? "").toLowerCase() as keyof typeof PRIORITY];
        if (canonical) attrs.priority = canonical;
        else attrs.unknown.push([attrName, attrValue]);
        break;
      }
      default:
        attrs.unknown.push([attrName, attrValue]);
    }
  }
  attrs.duplicates = [...repeated];
  return finishSetCookie(name, value, attrs, trimmed, nowMs);
}

const WEEKDAY_END = /(?:^|[^A-Za-z])(?:mon|tue|wed|thu|fri|sat|sun)$/i;

export function splitSetCookieHeaders(joined: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] !== ",") continue;
    let j = i + 1;
    while (j < joined.length && (joined[j] === " " || joined[j] === "\t")) j++;
    const tokenStart = j;
    while (j < joined.length && isTokenChar(joined[j] as string)) j++;
    if (j === tokenStart || joined[j] !== "=") continue;
    const before = joined.slice(start, i);
    const tail = before.slice(-4);
    if (WEEKDAY_END.test(tail) && isLetter(tail.slice(-1))) continue;
    parts.push(before.trim());
    start = i + 1;
  }
  parts.push(joined.slice(start).trim());
  return parts;
}

// ---- Input detection -------------------------------------------------------

const MAX_TOTAL_BYTES = 8192;
// An optional quote may close the name, as in a JSON log's "cookie": key.
const HEADER_NAME = /(^|[\s"',{])(set-cookie|cookie)(["']?)\s*:/i;
const SET_COOKIE_NAME = /^\s*set-cookie\s*:/i;
const TRAILING_LOG_NOISE = "\"',}]";

interface Line {
  n: number; // 1-based line number in the input
  text: string;
}

/** Non-blank lines with their 1-based numbers; a CR before the LF is dropped. */
function inputLines(text: string): Line[] {
  const out: Line[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() !== "") out.push({ n: i + 1, text: line });
  });
  return out;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function isJarComment(line: string): boolean {
  return line.startsWith("#") && !line.startsWith("#HttpOnly_");
}

function looksNetscape(lines: Line[]): boolean {
  if ((lines[0]?.text ?? "").trimStart().startsWith("# Netscape HTTP Cookie File")) return true;
  const rows = lines.filter((l) => !isJarComment(l.text));
  return (
    rows.length > 0 &&
    rows.every((l) => {
      const fields = l.text.split("\t");
      return fields.length === 7 && (fields[1] === "TRUE" || fields[1] === "FALSE");
    })
  );
}

/** Letters, digits, dots and hyphens with an optional leading dot, judged by code point. */
function looksLikeHost(field: string): boolean {
  const body = field.startsWith(".") ? field.slice(1) : field;
  if (body === "") return false;
  for (const ch of body) {
    const cp = ch.codePointAt(0) ?? 0;
    const ok = (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || ch === "." || ch === "-";
    if (!ok) return false;
  }
  return true;
}

function isDevtoolsHeader(line: string): boolean {
  return (line.split("\t")[0] ?? "").trim().toLowerCase() === "name";
}

function isDevtoolsRow(line: string): boolean {
  const fields = line.split("\t");
  return fields.length >= 6 && fields.some((field, i) => i > 0 && field.startsWith("/") && looksLikeHost(fields[i - 1] ?? ""));
}

function devtoolsRows(lines: Line[]): Line[] {
  return lines[0] !== undefined && isDevtoolsHeader(lines[0].text) ? lines.slice(1) : lines;
}

function looksDevtools(lines: Line[]): boolean {
  const rows = devtoolsRows(lines);
  return rows.length > 0 && rows.every((l) => isDevtoolsRow(l.text));
}

interface HeaderHit {
  name: "set-cookie" | "cookie";
  value: string;
  noisy: boolean; // the header name came after log noise rather than at the start of the line
}

/** Finds a Cookie or Set-Cookie header anywhere in a line and cuts its value out of any log wrapping. */
function findHeader(line: string): HeaderHit | null {
  const m = HEADER_NAME.exec(line);
  if (m === null) return null;
  const lead = m[1] ?? "";
  const name = (m[2] ?? "").toLowerCase() === "cookie" ? "cookie" : "set-cookie";
  const noisy = line.slice(0, m.index + lead.length).trim() !== "";
  let value = line.slice(m.index + m[0].length);
  const opener = value.trimStart().slice(0, 1);
  if ((m[3] ?? "") !== "" && (opener === '"' || opener === "'")) {
    // A quoted key with a quoted value: the value ends at its own closing quote.
    value = value.trimStart().slice(1);
    const close = value.indexOf(opener);
    if (close !== -1) value = value.slice(0, close);
    value = value.trimEnd();
    while (value !== "" && TRAILING_LOG_NOISE.includes(value.slice(-1))) value = value.slice(0, -1);
  } else if (lead === '"' || lead === "'") {
    const close = value.indexOf(lead);
    if (close !== -1) value = value.slice(0, close);
    value = value.trimEnd();
    while (value !== "" && TRAILING_LOG_NOISE.includes(value.slice(-1))) value = value.slice(0, -1);
  }
  return { name, value: value.trim(), noisy };
}

function looksHeaderBlock(lines: Line[]): boolean {
  const hits = lines.map((l) => findHeader(l.text));
  return hits.some((h) => h !== null) && hits.some((h) => h === null || h.noisy);
}

function hasSetCookieShape(line: string): boolean {
  if (SET_COOKIE_NAME.test(line)) return true;
  return line
    .split(";")
    .slice(1)
    .some((segment) => KNOWN_ATTRIBUTES.includes((segment.split("=")[0] ?? "").trim().toLowerCase()));
}

function looksSetCookie(lines: Line[]): boolean {
  if (lines.every((l) => hasSetCookieShape(l.text))) return true;
  return lines.length === 1 && splitSetCookieHeaders(lines[0]?.text ?? "").length > 1;
}

export function detectCookieInput(text: string): CookieInputKind {
  if (text.trim() === "") return "empty";
  const lines = inputLines(text.trim());
  if (looksNetscape(lines)) return "netscape";
  if (looksDevtools(lines)) return "devtools-table";
  if (looksHeaderBlock(lines)) return "header-block";
  if (looksSetCookie(lines)) return "set-cookie";
  return "cookie-header";
}

// ---- Readers, one per input kind -------------------------------------------

interface Reading {
  cookies: ParsedCookie[];
  notes: string[]; // the opening note, then any split notes
  skipped: number; // lines read as cookie lines that yielded no cookie
}

function atLine(cookie: ParsedCookie, n: number): ParsedCookie {
  cookie.source.line = n;
  return cookie;
}

/** Parses one Set-Cookie value, splitting a comma-joined one; returns the split note when it split. */
function readSetCookieValue(value: string, n: number, nowMs: number, out: ParsedCookie[]): string | null {
  const parts = splitSetCookieHeaders(value).filter((part) => part.replace(SET_COOKIE_NAME, "").trim() !== "");
  for (const part of parts) out.push(atLine(parseSetCookie(part, { nowMs }), n));
  return parts.length > 1 ? `Split one comma-joined Set-Cookie value into ${parts.length} headers.` : null;
}

function readCookieHeader(text: string): Reading {
  const cookies: ParsedCookie[] = [];
  let skipped = 0;
  for (const line of inputLines(text)) {
    const rows = parseCookieHeader(line.text);
    if (rows.length === 0) skipped++;
    for (const row of rows) cookies.push(atLine(row, line.n));
  }
  return { cookies, notes: ["Read as a Cookie request header."], skipped };
}

function readSetCookie(text: string, nowMs: number): Reading {
  const cookies: ParsedCookie[] = [];
  const splits: string[] = [];
  let skipped = 0;
  for (const line of inputLines(text)) {
    const before = cookies.length;
    const split = readSetCookieValue(line.text, line.n, nowMs, cookies);
    if (split !== null) splits.push(split);
    if (cookies.length === before) skipped++;
  }
  return { cookies, notes: [`Read as ${plural(cookies.length, "Set-Cookie header")}.`, ...splits], skipped };
}

function readHeaderBlock(text: string, nowMs: number): Reading {
  const cookies: ParsedCookie[] = [];
  const splits: string[] = [];
  let setCookies = 0;
  let cookieHeaders = 0;
  let skipped = 0;
  for (const line of inputLines(text)) {
    const hit = findHeader(line.text);
    if (hit === null) continue;
    const before = cookies.length;
    if (hit.name === "set-cookie") {
      const split = readSetCookieValue(hit.value, line.n, nowMs, cookies);
      if (split !== null) splits.push(split);
      setCookies += cookies.length - before;
    } else {
      for (const row of parseCookieHeader(hit.value)) cookies.push(atLine(row, line.n));
      if (cookies.length > before) cookieHeaders++;
    }
    if (cookies.length === before) skipped++;
  }
  const clauses: string[] = [];
  if (setCookies > 0) clauses.push(plural(setCookies, "Set-Cookie header"));
  if (cookieHeaders > 0) clauses.push(plural(cookieHeaders, "Cookie header"));
  const opening = `Read ${clauses.length === 0 ? "no cookies" : clauses.join(" and ")} out of a pasted header block.`;
  return { cookies, notes: [opening, ...splits], skipped };
}

type DevtoolsColumn = "name" | "value" | "domain" | "path" | "expires" | "httpOnly" | "secure" | "sameSite" | "partitionKey" | "priority";

/** Chromium Application → Cookies panel order; index 5 is Size, which is recomputed. */
const DEVTOOLS_POSITIONS: Record<DevtoolsColumn, number> = {
  name: 0, value: 1, domain: 2, path: 3, expires: 4, httpOnly: 6, secure: 7, sameSite: 8, partitionKey: 9, priority: 10,
};

/** Current Chromium adds Cross Site at index 10, which is ignored, and moves Priority to 11. */
const DEVTOOLS_POSITIONS_12: Record<DevtoolsColumn, number> = { ...DEVTOOLS_POSITIONS, priority: 11 };

/** Header-less rows map by field count: 12 or more fields is the Cross Site layout. */
function positionsFor(line: Line): Record<DevtoolsColumn, number> {
  return line.text.split("\t").length >= 12 ? DEVTOOLS_POSITIONS_12 : DEVTOOLS_POSITIONS;
}

const DEVTOOLS_HEADERS: Record<string, DevtoolsColumn> = {
  name: "name",
  value: "value",
  domain: "domain",
  path: "path",
  "expires / max-age": "expires",
  expires: "expires",
  httponly: "httpOnly",
  secure: "secure",
  samesite: "sameSite",
  "partition key": "partitionKey",
  "partition key site": "partitionKey",
  priority: "priority",
};

function devtoolsColumns(header: string): Partial<Record<DevtoolsColumn, number>> {
  const columns: Partial<Record<DevtoolsColumn, number>> = {};
  header.split("\t").forEach((title, i) => {
    const column = DEVTOOLS_HEADERS[title.trim().toLowerCase()];
    if (column !== undefined && columns[column] === undefined) columns[column] = i;
  });
  return columns;
}

function isTicked(cell: string): boolean {
  const lower = cell.toLowerCase();
  return cell === "✓" || lower === "true" || lower === "yes";
}

function devtoolsCookie(line: Line, columns: Partial<Record<DevtoolsColumn, number>>, nowMs: number): ParsedCookie {
  const fields = line.text.split("\t");
  const cell = (column: DevtoolsColumn): string => {
    const i = columns[column];
    return i === undefined ? "" : (fields[i] ?? "").trim();
  };
  const attrs = emptyAttributes();
  attrs.domain = cell("domain") || null;
  attrs.path = cell("path") || null;
  const expires = cell("expires");
  attrs.expires = expires === "" || expires.toLowerCase() === "session" ? null : expires;
  attrs.httpOnly = isTicked(cell("httpOnly"));
  attrs.secure = isTicked(cell("secure"));
  const sameSite = cell("sameSite");
  attrs.sameSite = SAME_SITE[sameSite.toLowerCase() as keyof typeof SAME_SITE] ?? null;
  if (attrs.sameSite === null && sameSite !== "") attrs.sameSiteRaw = sameSite;
  attrs.partitioned = cell("partitionKey") !== "";
  const priority = cell("priority");
  attrs.priority = PRIORITY[priority.toLowerCase() as keyof typeof PRIORITY] ?? null;
  if (attrs.priority === null && priority !== "") attrs.unknown.push(["Priority", priority]);
  return atLine(finishSetCookie(cell("name"), cell("value"), attrs, line.text, nowMs), line.n);
}

function readDevtoolsTable(text: string, nowMs: number): Reading {
  const lines = inputLines(text);
  const rows = devtoolsRows(lines);
  const header = rows === lines ? undefined : lines[0];
  const columns = header === undefined ? null : devtoolsColumns(header.text);
  const cookies = rows.map((row) => devtoolsCookie(row, columns ?? positionsFor(row), nowMs));
  return { cookies, notes: [`Read as a devtools cookie table (${plural(cookies.length, "row")}).`], skipped: 0 };
}

function readNetscape(text: string, nowMs: number): Reading {
  const cookies = parseNetscapeJar(text, { nowMs });
  return { cookies, notes: [`Read as a Netscape cookies.txt jar (${plural(cookies.length, "cookie")}).`], skipped: 0 };
}

function read(kind: CookieInputKind, text: string, nowMs: number): Reading {
  switch (kind) {
    case "empty":
      return { cookies: [], notes: ["Nothing to read."], skipped: 0 };
    case "netscape":
      return readNetscape(text, nowMs);
    case "devtools-table":
      return readDevtoolsTable(text, nowMs);
    case "header-block":
      return readHeaderBlock(text, nowMs);
    case "set-cookie":
      return readSetCookie(text, nowMs);
    case "cookie-header":
      return readCookieHeader(text);
  }
}

// ---- parseCookieInput ------------------------------------------------------

/** Findings about the cookies as a set: repeated names and the combined size. */
function auditCookieSet(cookies: ParsedCookie[], totalBytes: number): AuditFinding[] {
  const counts = new Map<string, number>();
  for (const cookie of cookies) counts.set(cookie.name, (counts.get(cookie.name) ?? 0) + 1);
  const findings: AuditFinding[] = [];
  for (const [name, n] of counts) {
    if (n < 2) continue;
    findings.push({
      code: "duplicate-name",
      level: "warn",
      message: `"${name}" appears ${n} times. The last one wins in a Cookie header; browsers keep the one whose Domain and Path match best.`,
    });
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    findings.push({
      code: "total-size",
      level: "warn",
      message: `All cookies together are ${totalBytes} bytes. Browsers send every matching cookie on every request.`,
    });
  }
  return findings;
}

export function parseCookieInput(text: string, opts?: { nowMs?: number }): CookieParseResult {
  if (text.length > MAX_COOKIE_INPUT_CHARS) {
    throw new InputError(`Too long — the input is over ${MAX_COOKIE_INPUT_CHARS} characters.`);
  }
  const nowMs = opts?.nowMs ?? Date.now();
  const kind = detectCookieInput(text);
  const { cookies, notes, skipped } = read(kind, text, nowMs);

  if (skipped > 0) notes.push(`Skipped ${plural(skipped, "line")} that held no cookie.`);
  const quoted = cookies.filter((c) => c.valueInfo.quoted).length;
  if (quoted > 0) notes.push(`Stripped a wrapping quote from ${plural(quoted, "value")}.`);
  // Cookie values are URL-encoded once by convention; a second url-encoded layer is the extra one.
  const doubled = cookies.filter((c) => c.valueInfo.layers.filter((layer) => layer === "url-encoded").length > 1).length;
  if (doubled > 0) notes.push(`Removed one extra layer of URL encoding from ${plural(doubled, "value")}.`);

  const totalBytes = cookies.reduce((sum, c) => sum + c.bytes, 0);
  return { kind, cookies, audit: auditCookieSet(cookies, totalBytes), totalBytes, notes };
}
