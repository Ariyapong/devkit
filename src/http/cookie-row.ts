// Shared ParsedCookie row builder for cookie-parse and cookie-out. Internal: nothing here reaches the barrel.

import { auditSetCookie } from "./cookie-audit.js";
import { cookieLifetime, describeCookieValue, utf8Bytes } from "./cookie-value.js";
import type { ParsedCookie, SetCookieAttributes } from "./cookie-types.js";

function stripQuotes(raw: string): string {
  return raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

/** Builds a ParsedCookie from a raw value; the audit is filled by the caller. */
export function makeCookie(name: string, rawValue: string, attributes: SetCookieAttributes | null, raw: string): ParsedCookie {
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

/** A Set-Cookie style row: builds the cookie, then fills lifetime and audit. */
export function finishSetCookie(name: string, value: string, attrs: SetCookieAttributes, raw: string, nowMs: number): ParsedCookie {
  const cookie = makeCookie(name, value, attrs, raw);
  cookie.lifetime = cookieLifetime(attrs, nowMs);
  cookie.audit = auditSetCookie(cookie, { nowMs });
  return cookie;
}
