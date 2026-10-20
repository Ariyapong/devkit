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
};
