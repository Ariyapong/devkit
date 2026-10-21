export const MAX_COOKIE_INPUT_CHARS = 1_000_000;
export const COOKIE_MAX_BYTES = 4096; // name + value, RFC 6265bis §5.5 / browsers
export const COOKIE_MAX_AGE_DAYS = 400; // Chrome 104+ cap

export type CookieInputKind =
  | "cookie-header" // name=value; name=value   (request header or document.cookie)
  | "set-cookie" // one or more Set-Cookie values
  | "header-block" // a pasted header block; Cookie/Set-Cookie lines were extracted
  | "devtools-table" // tab-separated rows from a devtools Cookies panel
  | "netscape" // cookies.txt jar
  | "empty";

export interface CookieSource {
  line: number;
  raw: string;
}

export interface SetCookieAttributes {
  domain: string | null; // as written, leading dot kept
  path: string | null;
  expires: string | null; // raw attribute text
  maxAge: number | null; // parsed integer, may be negative
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None" | null;
  sameSiteRaw: string | null; // as written when it is not one of the three
  partitioned: boolean;
  priority: "Low" | "Medium" | "High" | null;
  unknown: [name: string, value: string | null][];
  duplicates: string[]; // attribute names given twice (lowercased)
}

export type CookieLifetime =
  | { kind: "session" }
  | { kind: "expires"; atMs: number; remainingMs: number; source: "max-age" | "expires" }
  | { kind: "expired"; atMs: number; source: "max-age" | "expires" }
  | { kind: "invalid"; raw: string };

export type CookieValueKind = "empty" | "plain" | "url-encoded" | "base64" | "json" | "jwt" | "form" | "signed";

export interface CookieValueInfo {
  kind: CookieValueKind;
  decoded: string | null; // the readable form; for jwt/signed the peeled inner text; null for plain/empty
  layers: CookieValueKind[]; // decoding steps applied, outermost first, e.g. ["url-encoded","base64","json"]
  quoted: boolean; // value arrived wrapped in double quotes (stripped)
}

export type CookieAuditCode =
  | "host-prefix-insecure" | "host-prefix-domain" | "host-prefix-path"
  | "secure-prefix-insecure"
  | "samesite-none-insecure" | "samesite-missing" | "samesite-invalid"
  | "partitioned-insecure"
  | "auth-not-httponly" | "auth-not-secure"
  | "oversize" | "expires-too-long" | "expired" | "expires-invalid" | "max-age-and-expires"
  | "domain-leading-dot" | "domain-public-suffix" | "domain-ip"
  | "path-relative"
  | "name-empty" | "name-invalid" | "value-invalid" | "value-quoted"
  | "duplicate-attribute" | "unknown-attribute" | "priority-invalid"
  | "duplicate-name" | "total-size";

export interface AuditFinding {
  code: CookieAuditCode;
  level: "error" | "warn" | "info";
  message: string;
}

export interface ParsedCookie {
  name: string;
  value: string; // after quote stripping, otherwise raw
  bytes: number; // UTF-8 bytes of name + "=" + value
  attributes: SetCookieAttributes | null; // null for cookie-header rows
  lifetime: CookieLifetime | null; // null for cookie-header rows
  valueInfo: CookieValueInfo;
  audit: AuditFinding[];
  source: CookieSource;
}

export interface CookieParseResult {
  kind: CookieInputKind;
  cookies: ParsedCookie[];
  audit: AuditFinding[]; // set-level findings (duplicate names, total size)
  totalBytes: number;
  notes: string[]; // plain sentences about how the input was read
}
