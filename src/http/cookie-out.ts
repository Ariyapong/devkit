// Cookie output formats: Cookie header, Netscape cookies.txt jar (write and read) and JSON.

import { InputError } from "../errors.js";
import { finishSetCookie } from "./cookie-row.js";
import type { CookieParseResult, ParsedCookie, SetCookieAttributes } from "./cookie-types.js";

const HTTP_ONLY_PREFIX = "#HttpOnly_";
const JAR_HEADER = "# Netscape HTTP Cookie File";
const MAX_JAR_MS = 253_402_300_799_000; // 9999-12-31T23:59:59Z, the last year parseCookieDate reads

function jarCookie(name: string, rawValue: string, attrs: SetCookieAttributes, raw: string, line: number, nowMs: number): ParsedCookie {
  const cookie = finishSetCookie(name, rawValue, attrs, raw, nowMs);
  cookie.source.line = line;
  return cookie;
}

/** Unix seconds as an HTTP date, so the lifetime and audit read it like an Expires attribute. */
function jarExpires(field: string, line: number): string | null {
  if (!/^\d+$/.test(field)) throw new InputError(`Line ${line} has a non-numeric expiry.`);
  if (field === "0") return null;
  return new Date(Math.min(Number(field) * 1000, MAX_JAR_MS)).toUTCString();
}

export function parseNetscapeJar(text: string, opts?: { nowMs?: number }): ParsedCookie[] {
  const nowMs = opts?.nowMs ?? Date.now();
  const cookies: ParsedCookie[] = [];
  text.split("\n").forEach((rawLine, i) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === "") return;
    const httpOnly = line.startsWith(HTTP_ONLY_PREFIX);
    if (line.startsWith("#") && !httpOnly) return;
    const fields = (httpOnly ? line.slice(HTTP_ONLY_PREFIX.length) : line).split("\t");
    if (fields.length !== 7) throw new InputError(`Line ${i + 1} has ${fields.length} fields, not 7.`);
    const [domain, , path, secure, expiry, name, value] = fields as [string, string, string, string, string, string, string];
    const attrs: SetCookieAttributes = {
      domain: domain === "" ? null : domain,
      path: path === "" ? null : path,
      expires: jarExpires(expiry, i + 1),
      maxAge: null,
      secure: secure === "TRUE",
      httpOnly,
      sameSite: null,
      sameSiteRaw: null,
      partitioned: false,
      priority: null,
      unknown: [],
      duplicates: [],
    };
    cookies.push(jarCookie(name, value, attrs, line, i + 1, nowMs));
  });
  return cookies;
}

export function toCookieHeader(cookies: ParsedCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function jarExpiry(cookie: ParsedCookie): number {
  const life = cookie.lifetime;
  return life && (life.kind === "expires" || life.kind === "expired") ? Math.floor(life.atMs / 1000) : 0;
}

function jarLine(cookie: ParsedCookie): string {
  const attrs = cookie.attributes;
  const domain = attrs?.domain ?? "";
  const fields = [domain, domain.startsWith(".") ? "TRUE" : "FALSE", attrs?.path ?? "/", attrs?.secure ? "TRUE" : "FALSE", String(jarExpiry(cookie)), cookie.name, cookie.value];
  return (attrs?.httpOnly ? HTTP_ONLY_PREFIX : "") + fields.join("\t");
}

// The max-age lifetime already carries its absolute time, so nowMs needs no clock read here.
export function toNetscapeJar(cookies: ParsedCookie[], _opts?: { nowMs?: number }): string {
  return [JAR_HEADER, ...cookies.map(jarLine)].join("\n") + "\n";
}

export function cookiesToJson(result: CookieParseResult): string {
  const cookies = result.cookies.map(({ name, value, bytes, attributes, lifetime, valueInfo, audit }) => ({ name, value, bytes, attributes, lifetime, valueInfo, audit }));
  return JSON.stringify({ kind: result.kind, notes: result.notes, totalBytes: result.totalBytes, audit: result.audit, cookies }, null, 2);
}
