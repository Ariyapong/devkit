// Cookie value decoding and lifetime. Neither function throws: bad input yields plain, invalid or session.
// Pure JS only: base64 goes through atob and bytes through TextDecoder, never Buffer.

import { parseCookieDate } from "./cookie-date.js";
import type { CookieLifetime, CookieValueInfo, CookieValueKind, SetCookieAttributes } from "./cookie-types.js";

const MAX_LAYERS = 4;
const MIN_BASE64_CHARS = 8;
const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/;
const BASE64_SHAPE = /^[A-Za-z0-9+/_-]+={0,2}$/;
const BASE64URL_SHAPE = /^[A-Za-z0-9_-]+$/;

/** Number of UTF-8 bytes in `text`. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function tryDecodeUri(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** Decodes base64 or base64url to bytes; null when the text is not valid base64. */
function base64Bytes(text: string): Uint8Array | null {
  if (!BASE64_SHAPE.test(text)) return null;
  let b64 = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (b64.length % 4 === 1) return null;
  b64 += "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function utf8Text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** True when `text` has a control character other than tab, newline and carriage return. */
function hasControlCharacter(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) continue;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true;
  }
  return false;
}

function parseJsonContainer(text: string): object | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function isJwt(text: string): boolean {
  const parts = text.split(".");
  if (parts.length !== 3) return false;
  // The signature may be empty (alg "none"); the header and payload may not.
  if (!BASE64URL_SHAPE.test(parts[0]!) || !BASE64URL_SHAPE.test(parts[1]!)) return false;
  if (parts[2] !== "" && !BASE64URL_SHAPE.test(parts[2]!)) return false;
  const bytes = base64Bytes(parts[0]!);
  const header = bytes === null ? null : utf8Text(bytes);
  const json = header === null ? null : parseJsonContainer(header);
  return json !== null && !Array.isArray(json) && "alg" in json;
}

function isSigned(text: string): boolean {
  // Express cookie-signature: "s:" + value + "." + signature.
  return text.startsWith("s:") && text.indexOf(".", 2) !== -1;
}

function isForm(text: string): boolean {
  return text.includes("&") && text.split("&").every((segment) => segment.includes("="));
}

function formText(text: string): string {
  return text
    .split("&")
    .map((segment) => {
      const at = segment.indexOf("=");
      const key = segment.slice(0, at);
      const value = segment.slice(at + 1);
      return `${tryDecodeUri(key) ?? key}=${tryDecodeUri(value) ?? value}`;
    })
    .join("\n");
}

/** One peeled layer: the kind, the new text, and whether peeling stops here. */
function peel(text: string): { kind: CookieValueKind; text: string; terminal: boolean } | null {
  // Form-shaped text skips the URL-decode step so its escapes are decoded per field, not across the string.
  if (!isForm(text) && PERCENT_ESCAPE.test(text)) {
    const decoded = tryDecodeUri(text);
    if (decoded !== null && decoded !== text) return { kind: "url-encoded", text: decoded, terminal: false };
  }
  if (isJwt(text)) return { kind: "jwt", text, terminal: true };
  if (isSigned(text)) return { kind: "signed", text, terminal: true };
  const json = parseJsonContainer(text);
  if (json !== null) return { kind: "json", text: JSON.stringify(json, null, 2), terminal: true };
  if (isForm(text)) return { kind: "form", text: formText(text), terminal: true };
  if (text.length >= MIN_BASE64_CHARS) {
    const bytes = base64Bytes(text);
    const decoded = bytes === null ? null : utf8Text(bytes);
    if (decoded !== null && decoded !== "" && decoded !== text && !hasControlCharacter(decoded)) {
      return { kind: "base64", text: decoded, terminal: false };
    }
  }
  return null;
}

/** Works out what a cookie value is wrapped in (quotes, URL encoding, base64, JSON, JWT, ...) and unwraps it. */
export function describeCookieValue(value: string): CookieValueInfo {
  if (value === "") return { kind: "empty", decoded: null, layers: [], quoted: false };
  const quoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
  let text = quoted ? value.slice(1, -1) : value;
  const layers: CookieValueKind[] = [];
  while (layers.length < MAX_LAYERS) {
    const step = peel(text);
    if (step === null) break;
    layers.push(step.kind);
    text = step.text;
    if (step.terminal) break;
  }
  const kind = layers[layers.length - 1];
  if (kind === undefined) return { kind: "plain", decoded: null, layers, quoted };
  return { kind, decoded: text, layers, quoted };
}

/** When a cookie dies. Max-Age wins over Expires; no clock is read, `nowMs` is passed in. */
export function cookieLifetime(attributes: SetCookieAttributes, nowMs: number): CookieLifetime {
  if (attributes.maxAge !== null) {
    const atMs = nowMs + attributes.maxAge * 1000;
    if (attributes.maxAge <= 0) return { kind: "expired", atMs, source: "max-age" };
    return { kind: "expires", atMs, remainingMs: atMs - nowMs, source: "max-age" };
  }
  if (attributes.expires !== null) {
    const atMs = parseCookieDate(attributes.expires);
    if (atMs === null) return { kind: "invalid", raw: attributes.expires };
    if (atMs <= nowMs) return { kind: "expired", atMs, source: "expires" };
    return { kind: "expires", atMs, remainingMs: atMs - nowMs, source: "expires" };
  }
  return { kind: "session" };
}
