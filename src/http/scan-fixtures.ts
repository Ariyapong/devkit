import type { FixtureTable } from "../scan/output-scan.js";

export const fixtures: FixtureTable = {
  // Returns null for anything it cannot read, by design; it has no throw statement.
  parseCookieDate: { returns: [["Wed, 21 Oct 2026 07:28:00 GMT"], ["nope"]], throws: "never" },
  // Bad input yields "plain" (a malformed % sequence is caught), never a throw.
  describeCookieValue: { returns: [["a%20b"], ['{"a":1}'], [""]], throws: "never" },
  // Unreadable Expires yields { kind: "invalid" }; there is no throw statement.
  cookieLifetime: {
    returns: [[{ domain: null, path: null, expires: null, maxAge: 60, secure: false, httpOnly: false, sameSite: null, sameSiteRaw: null, partitioned: false, priority: null, unknown: [], duplicates: [] }, 1_800_000_000_000]],
    throws: "never",
  },
  // Pure checks over a ParsedCookie; no throw statement. Date.now() is only the nowMs default.
  auditSetCookie: {
    returns: [[{ name: "sid", value: "1", bytes: 5, attributes: { domain: null, path: null, expires: null, maxAge: null, secure: false, httpOnly: false, sameSite: null, sameSiteRaw: null, partitioned: false, priority: null, unknown: [], duplicates: [] }, lifetime: { kind: "session" }, valueInfo: { kind: "plain", decoded: null, layers: [], quoted: false }, audit: [], source: { line: 1, raw: "sid=1" } }]],
    throws: "never",
  },
  // Pure checks over name, value and size; no throw statement.
  auditCookieHeader: {
    returns: [[{ name: "sid", value: "1", bytes: 5, attributes: null, lifetime: null, valueInfo: { kind: "plain", decoded: null, layers: [], quoted: false }, audit: [], source: { line: 1, raw: "sid=1" } }]],
    throws: "never",
  },
  // Plain string splitting; unreadable input yields empty or partial rows, and there is no throw statement.
  parseCookieHeader: { returns: [["Cookie: sid=1; theme=dark"], [""]], throws: "never" },
  // Plain string splitting plus pure helpers; there is no throw statement.
  parseSetCookie: { returns: [["sid=1; Path=/; Secure", { nowMs: 1_800_000_000_000 }], ["", { nowMs: 1_800_000_000_000 }]], throws: "never" },
  // Index scanning over a string; there is no throw statement.
  splitSetCookieHeaders: { returns: [["a=1, b=2"], [""]], throws: "never" },
  detectCookieInput: { returns: [["a=1; b=2"], ["Set-Cookie: a=1"], [""]], throws: "never" },
  parseCookieInput: {
    returns: [["Set-Cookie: a=1; Secure", { nowMs: 1_800_000_000_000 }], ["a=1; a=2"], [""]],
    throws: [["a".repeat(1_000_001)]],
  },
  // Pure string joins over parsed rows; there is no throw statement.
  toCookieHeader: { returns: [[[]]], throws: "never" },
  toNetscapeJar: { returns: [[[]]], throws: "never" },
  cookiesToJson: { returns: [[{ kind: "empty", cookies: [], audit: [], totalBytes: 0, notes: [] }]], throws: "never" },
  parseNetscapeJar: {
    returns: [["# Netscape HTTP Cookie File\n#HttpOnly_.x.test\tTRUE\t/\tTRUE\t0\ta\t1", { nowMs: 1_800_000_000_000 }]],
    throws: [["a\tb"]],
  },
  // Only a blank name, a bad Max-Age or an unreadable Expires throws.
  buildSetCookie: {
    returns: [[{ name: "sid", value: "1", domain: "", path: "", lifetime: "session", maxAge: "", expires: "", secure: false, httpOnly: false, partitioned: false, sameSite: "", priority: "" }, { nowMs: 1_800_000_000_000 }]],
    throws: [[{ ...{ name: "sid", value: "1", domain: "", path: "", lifetime: "session", maxAge: "", expires: "", secure: false, httpOnly: false, partitioned: false, sameSite: "", priority: "" }, name: " " }]],
  },
  // Pure field copying over a ParsedCookie; there is no throw statement.
  formFromCookie: {
    returns: [[{ name: "sid", value: "1", bytes: 5, attributes: null, lifetime: null, valueInfo: { kind: "plain", decoded: null, layers: [], quoted: false }, audit: [], source: { line: 1, raw: "sid=1" } }]],
    throws: "never",
  },
};
