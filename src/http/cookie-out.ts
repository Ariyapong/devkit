// Cookie output formats. This task adds only the read side of the Netscape cookies.txt jar.

import { InputError } from "../errors.js";
import { finishSetCookie } from "./cookie-row.js";
import type { ParsedCookie, SetCookieAttributes } from "./cookie-types.js";

const HTTP_ONLY_PREFIX = "#HttpOnly_";

function jarCookie(name: string, rawValue: string, attrs: SetCookieAttributes, raw: string, line: number, nowMs: number): ParsedCookie {
  const cookie = finishSetCookie(name, rawValue, attrs, raw, nowMs);
  cookie.source.line = line;
  return cookie;
}

/** Unix seconds as an HTTP date, so the lifetime and audit read it like an Expires attribute. */
function jarExpires(field: string): string | null {
  if (field === "0") return null;
  return /^\d+$/.test(field) ? new Date(Number(field) * 1000).toUTCString() : field;
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
      expires: jarExpires(expiry),
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
