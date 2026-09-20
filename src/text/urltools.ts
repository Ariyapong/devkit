import { toUnicode } from "punycode/punycode.es6.js";

export interface UrlParts {
  scheme: string;          // url.protocol without the trailing ":"
  host: string;            // url.hostname (no port)
  hostUnicode?: string;    // toUnicode(host), only when it differs
  port?: string;           // url.port — WHATWG drops scheme-default ports
  path: string;            // url.pathname
  pathDecoded?: string;    // only when it differs from path
  fragment?: string;       // url.hash without "#", only when present
  fragmentDecoded?: string;
  user?: string;           // url.username, only when present
  hasPassword: boolean;    // the password itself is never stored
  hasQuery: boolean;
  href: string;            // normalized reconstruction, password stripped
}

// Code-point comparison, not a \u-range regex: \u-range regexes have been
// corrupted twice in this repo by escape-flattening, once into raw bytes
// that made a source file git-binary.
function hasC0Control(value: string): boolean {
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || cp === 0x7f) return true;
  }
  return false;
}

function decodedIfDiffers(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded === value) return undefined;
    // A decoded newline/control char would forge component lines inside
    // the structured breakdown (e.g. a fake "Host: trusted.example") — raw
    // form only, the same policy already used for malformed percent-sequences.
    if (hasC0Control(decoded)) return undefined;
    return decoded;
  } catch {
    return undefined; // malformed percent-sequence — raw form only
  }
}

export function parseUrl(raw: string): UrlParts | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  let href = url.href;
  if (url.password !== "") {
    // Echoing a credential into a fresh message is the wrong direction even
    // when the source was already public.
    const stripped = new URL(url.href);
    stripped.password = "";
    href = stripped.href;
  }
  const parts: UrlParts = {
    scheme: url.protocol.slice(0, -1),
    host: url.hostname,
    path: url.pathname,
    hasPassword: url.password !== "",
    hasQuery: url.search !== "",
    href,
  };
  if (url.hostname !== "") {
    // url.hostname is already lowercase ASCII/punycode per WHATWG for special
    // schemes; a non-special scheme (git, ssh, redis, …) keeps an opaque host
    // with no IDNA, so a malformed xn-- label can reach toUnicode intact —
    // punycode throws RangeError on it. Undecodable ⇒ no Unicode form to
    // report (the bot's node:url-based domainToUnicode returned "" here).
    try {
      const unicode = toUnicode(url.hostname);
      if (unicode !== url.hostname) parts.hostUnicode = unicode;
    } catch {
      // not decodable punycode — ASCII form only
    }
  }
  if (url.port !== "") parts.port = url.port;
  const pathDecoded = decodedIfDiffers(url.pathname);
  if (pathDecoded !== undefined) parts.pathDecoded = pathDecoded;
  if (url.hash !== "") {
    parts.fragment = url.hash.slice(1);
    const fragmentDecoded = decodedIfDiffers(parts.fragment);
    if (fragmentDecoded !== undefined) parts.fragmentDecoded = fragmentDecoded;
  }
  if (url.username !== "") parts.user = url.username;
  return parts;
}
