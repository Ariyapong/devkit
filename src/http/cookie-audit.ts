// Cookie audit. Both functions are pure and never throw; the only clock is the `nowMs` the caller passes.

import { COOKIE_MAX_AGE_DAYS, COOKIE_MAX_BYTES } from "./cookie-types.js";
import type { AuditFinding, ParsedCookie } from "./cookie-types.js";
import { cookieLifetime, utf8Bytes } from "./cookie-value.js";

export const AUTH_NAME_HINTS = ["sess", "sid", "token", "auth", "jwt", "login", "csrf", "xsrf"];

const DAY_MS = 86_400_000;
const LEVEL_RANK = { error: 0, warn: 1, info: 2 } as const;
const TOKEN_SEPARATORS = '()<>@,;:\\"/[]?={}';
const PUBLIC_SUFFIXES = ["co.uk", "com.au", "co.jp", "com.br", "co.nz", "co.za", "github.io", "herokuapp.com", "azurewebsites.net"];
const ATTRIBUTE_NAMES: Record<string, string> = {
  domain: "Domain",
  path: "Path",
  expires: "Expires",
  "max-age": "Max-Age",
  secure: "Secure",
  httponly: "HttpOnly",
  samesite: "SameSite",
  partitioned: "Partitioned",
  priority: "Priority",
};
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

type Finding = AuditFinding;

function finding(code: Finding["code"], level: Finding["level"], message: string): Finding {
  return { code, level, message };
}

/** RFC 6265 token character: printable ASCII that is not a separator. */
function isTokenCodePoint(cp: number): boolean {
  return cp > 0x20 && cp < 0x7f && !TOKEN_SEPARATORS.includes(String.fromCodePoint(cp));
}

/** RFC 6265 cookie-octet; non-ASCII is tolerated because browsers send it. */
function isCookieOctet(cp: number): boolean {
  if (cp >= 0x80) return true;
  return (
    cp === 0x21 ||
    (cp >= 0x23 && cp <= 0x2b) ||
    (cp >= 0x2d && cp <= 0x3a) ||
    (cp >= 0x3c && cp <= 0x5b) ||
    (cp >= 0x5d && cp <= 0x7e)
  );
}

function firstBad(text: string, ok: (cp: number) => boolean): string | null {
  for (const ch of text) {
    if (!ok(ch.codePointAt(0)!)) return ch;
  }
  return null;
}

function looksLikeAuth(name: string): boolean {
  const lower = name.toLowerCase();
  return AUTH_NAME_HINTS.some((hint) => lower.includes(hint));
}

function isIpLiteral(domain: string): boolean {
  return IPV4.test(domain) || (domain.startsWith("[") && domain.endsWith("]"));
}

function isPublicSuffix(domain: string): boolean {
  const host = domain.toLowerCase();
  return host !== "" && (!host.includes(".") || PUBLIC_SUFFIXES.includes(host));
}

function sortByLevel(findings: Finding[]): Finding[] {
  // Array.prototype.sort is stable, so table order survives within a level.
  return findings.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

/** Findings shared by Set-Cookie and Cookie rows, pushed in table order per level. */
function nameValueFindings(cookie: ParsedCookie) {
  const errors: Finding[] = [];
  const warns: Finding[] = [];
  const infos: Finding[] = [];
  if (cookie.bytes > COOKIE_MAX_BYTES) {
    errors.push(finding("oversize", "error", `Name and value are ${cookie.bytes} bytes. Browsers drop cookies over ${COOKIE_MAX_BYTES} bytes.`));
  }
  const badName = firstBad(cookie.name, isTokenCodePoint);
  if (badName !== null) {
    errors.push(finding("name-invalid", "error", `The name has a character cookies can't carry: ${JSON.stringify(badName)}.`));
  }
  const badValue = firstBad(cookie.value, isCookieOctet);
  if (badValue !== null) {
    warns.push(finding("value-invalid", "warn", `The value has a character browsers may mangle: ${JSON.stringify(badValue)}. URL-encode it.`));
  }
  if (cookie.name === "") {
    infos.push(finding("name-empty", "info", "No name. Browsers store the whole thing as a nameless value."));
  }
  if (cookie.valueInfo.quoted) {
    infos.push(finding("value-quoted", "info", "The value is wrapped in quotes. Browsers keep the quotes as part of the value."));
  }
  return { errors, warns, infos };
}

/** Audits a Set-Cookie style row. `opts.nowMs` defaults to the current time. */
export function auditSetCookie(cookie: ParsedCookie, opts?: { nowMs?: number }): AuditFinding[] {
  const attrs = cookie.attributes;
  if (attrs === null) return auditCookieHeader(cookie);
  const nowMs = opts?.nowMs ?? Date.now();
  const shared = nameValueFindings(cookie);
  const errors: Finding[] = [];
  const warns: Finding[] = [];
  const infos: Finding[] = [];

  if (cookie.name.startsWith("__Host-")) {
    if (!attrs.secure) errors.push(finding("host-prefix-insecure", "error", "__Host- cookies must be Secure. Browsers reject this one."));
    if (attrs.domain !== null) errors.push(finding("host-prefix-domain", "error", "__Host- cookies must not set a Domain. Browsers reject this one."));
    if (attrs.path !== "/") errors.push(finding("host-prefix-path", "error", "__Host- cookies must set Path=/. Browsers reject this one."));
  }
  if (cookie.name.startsWith("__Secure-") && !attrs.secure) {
    errors.push(finding("secure-prefix-insecure", "error", "__Secure- cookies must be Secure. Browsers reject this one."));
  }
  if (attrs.sameSite === "None" && !attrs.secure) {
    errors.push(finding("samesite-none-insecure", "error", "SameSite=None needs Secure. Chrome and Firefox drop this cookie."));
  }
  if (attrs.partitioned && !attrs.secure) {
    errors.push(finding("partitioned-insecure", "error", "Partitioned cookies must be Secure. Browsers reject this one."));
  }
  errors.push(...shared.errors);

  if (attrs.sameSiteRaw !== null) {
    warns.push(finding("samesite-invalid", "warn", `SameSite=${attrs.sameSiteRaw} isn't Strict, Lax or None. Browsers treat it as missing.`));
  }
  if (looksLikeAuth(cookie.name)) {
    if (!attrs.httpOnly) {
      warns.push(finding("auth-not-httponly", "warn", "This looks like a session or auth cookie but isn't HttpOnly, so page scripts can read it."));
    }
    if (!attrs.secure) {
      warns.push(finding("auth-not-secure", "warn", "This looks like a session or auth cookie but isn't Secure, so it travels over plain HTTP."));
    }
  }
  // Recomputed from the attributes so a re-audit with a different nowMs is judged against that clock.
  const life = cookieLifetime(attrs, nowMs);
  if (life.kind === "expires" && life.remainingMs > COOKIE_MAX_AGE_DAYS * DAY_MS) {
    warns.push(finding("expires-too-long", "warn", `Expires in ${Math.round(life.remainingMs / DAY_MS)} days. Chrome caps cookie lifetime at ${COOKIE_MAX_AGE_DAYS} days.`));
  }
  if (life.kind === "invalid") {
    warns.push(finding("expires-invalid", "warn", `Expires=${life.raw} isn't a date browsers can read, so this becomes a session cookie.`));
  }
  const domain = attrs.domain === null ? "" : attrs.domain.replace(/^\./, "");
  if (!isIpLiteral(domain) && isPublicSuffix(domain)) {
    warns.push(finding("domain-public-suffix", "warn", `Domain=${domain} is a public suffix. Browsers refuse to set cookies there.`));
  }
  if (isIpLiteral(domain)) {
    warns.push(finding("domain-ip", "warn", "Domain is an IP address. Only an exact host match will send this cookie."));
  }
  warns.push(...shared.warns);
  for (const name of attrs.duplicates) {
    const canonical = ATTRIBUTE_NAMES[name.toLowerCase()] ?? name;
    warns.push(finding("duplicate-attribute", "warn", `${canonical} is given twice. The last one wins.`));
  }
  // An unrecognized Priority value is carried in `unknown`; report it as priority-invalid instead.
  const isPriority = (entry: [string, string | null]) => entry[0].toLowerCase() === "priority";
  for (const entry of attrs.unknown.filter(isPriority)) {
    warns.push(finding("priority-invalid", "warn", `Priority=${entry[1] ?? ""} isn't Low, Medium or High.`));
  }
  if (attrs.path !== null && !attrs.path.startsWith("/")) {
    warns.push(finding("path-relative", "warn", "Path must start with /. Browsers use the request path instead."));
  }

  if (attrs.sameSite === null && attrs.sameSiteRaw === null) {
    infos.push(finding("samesite-missing", "info", "No SameSite. Chrome treats it as Lax; cross-site POSTs won't carry it."));
  }
  if (life.kind === "expired") infos.push(finding("expired", "info", "Already expired. Sending this deletes the cookie."));
  if (attrs.maxAge !== null && attrs.expires !== null) {
    infos.push(finding("max-age-and-expires", "info", "Both Max-Age and Expires are set. Max-Age wins."));
  }
  if (attrs.domain !== null && attrs.domain.startsWith(".")) {
    infos.push(finding("domain-leading-dot", "info", "The leading dot in Domain is ignored. Subdomains match either way."));
  }
  infos.push(...shared.infos);
  for (const [name] of attrs.unknown.filter((entry) => !isPriority(entry))) {
    infos.push(finding("unknown-attribute", "info", `${name} isn't a Set-Cookie attribute. Browsers ignore it.`));
  }

  return sortByLevel([...errors, ...warns, ...infos]);
}

/** Audits a Cookie request-header row: only the name, the value and the size can be checked. */
export function auditCookieHeader(cookie: ParsedCookie): AuditFinding[] {
  const { errors, warns, infos } = nameValueFindings(cookie);
  return [...errors, ...warns, ...infos];
}
