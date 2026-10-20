import { auditCookieHeader, auditSetCookie } from "./cookie-audit.js";
import { cookieLifetime, describeCookieValue, utf8Bytes } from "./cookie-value.js";
import type { ParsedCookie, SetCookieAttributes } from "./cookie-types.js";

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

function stripQuotes(raw: string): string {
  return raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
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

/** Builds a ParsedCookie from a raw value; the audit is filled by the caller. */
function makeCookie(name: string, rawValue: string, attributes: SetCookieAttributes | null, raw: string): ParsedCookie {
  const value = stripQuotes(rawValue);
  return {
    name,
    value,
    bytes: utf8Bytes(`${name}=${value}`),
    attributes,
    lifetime: null,
    valueInfo: describeCookieValue(rawValue),
    audit: [],
    source: { line: 1, raw },
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
    const known = ["expires", "max-age", "domain", "path", "secure", "httponly", "samesite", "partitioned", "priority"];
    if (known.includes(key)) {
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

  const cookie = makeCookie(name, value, attrs, trimmed);
  cookie.lifetime = cookieLifetime(attrs, nowMs);
  cookie.audit = auditSetCookie(cookie, { nowMs });
  return cookie;
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
