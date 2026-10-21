import { test } from "node:test";
import assert from "node:assert/strict";
import { auditSetCookie, auditCookieHeader } from "./cookie-audit.js";
import { describeCookieValue, cookieLifetime, utf8Bytes } from "./cookie-value.js";
import type { CookieLifetime, ParsedCookie, SetCookieAttributes } from "./cookie-types.js";

const NOW = 1_800_000_000_000;

function cookie(
  name: string,
  value: string,
  over: Partial<SetCookieAttributes> = {},
  lifetime?: CookieLifetime,
): ParsedCookie {
  const valueInfo = describeCookieValue(value);
  const attributes: SetCookieAttributes = {
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
    ...over,
  };
  return {
    name,
    value: valueInfo.quoted ? value.slice(1, -1) : value, // the parser strips the quotes
    bytes: utf8Bytes(`${name}=${value}`),
    attributes,
    lifetime: lifetime ?? cookieLifetime(attributes, NOW),
    valueInfo,
    audit: [],
    source: { line: 1, raw: `${name}=${value}` },
  };
}

const SAFE = { secure: true, httpOnly: true, sameSite: "Lax" as const, path: "/" };

test("host-prefix-insecure", () =>
  assert.deepEqual(auditSetCookie(cookie("__Host-id", "1", { path: "/" })), [
    { code: "host-prefix-insecure", level: "error", message: "__Host- cookies must be Secure. Browsers reject this one." },
    { code: "samesite-missing", level: "info", message: "No SameSite. Chrome treats it as Lax; cross-site POSTs won't carry it." },
  ]));

test("host-prefix-domain", () =>
  assert.deepEqual(auditSetCookie(cookie("__Host-x", "1", { ...SAFE, domain: "example.com" })), [
    { code: "host-prefix-domain", level: "error", message: "__Host- cookies must not set a Domain. Browsers reject this one." },
  ]));

test("host-prefix-path", () =>
  assert.deepEqual(auditSetCookie(cookie("__Host-x", "1", { ...SAFE, path: "/app" })), [
    { code: "host-prefix-path", level: "error", message: "__Host- cookies must set Path=/. Browsers reject this one." },
  ]));

test("secure-prefix-insecure", () =>
  assert.deepEqual(auditSetCookie(cookie("__Secure-x", "1", { sameSite: "Lax" })), [
    { code: "secure-prefix-insecure", level: "error", message: "__Secure- cookies must be Secure. Browsers reject this one." },
  ]));

test("samesite-none-insecure", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { sameSite: "None" })), [
    { code: "samesite-none-insecure", level: "error", message: "SameSite=None needs Secure. Chrome and Firefox drop this cookie." },
  ]));

test("partitioned-insecure", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { sameSite: "Lax", partitioned: true })), [
    { code: "partitioned-insecure", level: "error", message: "Partitioned cookies must be Secure. Browsers reject this one." },
  ]));

test("oversize", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "x".repeat(5000), { secure: true, sameSite: "Lax" })), [
    { code: "oversize", level: "error", message: "Name and value are 5002 bytes. Browsers drop cookies over 4096 bytes." },
  ]));

test("name-invalid", () =>
  assert.deepEqual(auditSetCookie(cookie("a;b", "1", { secure: true, sameSite: "Lax" })), [
    { code: "name-invalid", level: "error", message: "The name has a character cookies can't carry: \";\"." },
  ]));

test("samesite-invalid", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { secure: true, sameSiteRaw: "Sideways" })), [
    { code: "samesite-invalid", level: "warn", message: "SameSite=Sideways isn't Strict, Lax or None. Browsers treat it as missing." },
  ]));

test("auth-not-httponly", () =>
  assert.deepEqual(auditSetCookie(cookie("Session", "1", { secure: true, sameSite: "Lax" })), [
    { code: "auth-not-httponly", level: "warn", message: "This looks like a session or auth cookie but isn't HttpOnly, so page scripts can read it." },
  ]));

test("auth-not-secure", () =>
  assert.deepEqual(auditSetCookie(cookie("sid", "1", { httpOnly: true, sameSite: "Lax" })), [
    { code: "auth-not-secure", level: "warn", message: "This looks like a session or auth cookie but isn't Secure, so it travels over plain HTTP." },
  ]));

test("expires-too-long", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { secure: true, sameSite: "Lax", maxAge: 500 * 86_400 }), { nowMs: NOW }), [
    { code: "expires-too-long", level: "warn", message: "Expires in 500 days. Chrome caps cookie lifetime at 400 days." },
  ]));

test("expires-too-long is judged against opts.nowMs", () => {
  const c = cookie("a", "1", { secure: true, sameSite: "Lax", expires: "Wed, 21 Oct 2026 07:28:00 GMT" });
  const at = Date.UTC(2026, 9, 21, 7, 28, 0);
  assert.deepEqual(auditSetCookie(c, { nowMs: at - 399 * 86_400_000 }), []);
  assert.equal(auditSetCookie(c, { nowMs: at - 401 * 86_400_000 })[0]?.code, "expires-too-long");
});

test("expires-invalid", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { secure: true, sameSite: "Lax", expires: "soon" }), { nowMs: NOW }), [
    { code: "expires-invalid", level: "warn", message: "Expires=soon isn't a date browsers can read, so this becomes a session cookie." },
  ]));

test("domain-public-suffix", () => {
  const base = { secure: true, sameSite: "Lax" as const };
  assert.deepEqual(auditSetCookie(cookie("a", "1", { ...base, domain: "co.uk" })), [
    { code: "domain-public-suffix", level: "warn", message: "Domain=co.uk is a public suffix. Browsers refuse to set cookies there." },
  ]);
  assert.equal(auditSetCookie(cookie("a", "1", { ...base, domain: "com" }))[0]?.code, "domain-public-suffix");
  assert.deepEqual(auditSetCookie(cookie("a", "1", { ...base, domain: "example.co.uk" })), []);
});

test("domain-ip", () => {
  const base = { secure: true, sameSite: "Lax" as const };
  const expected = [
    { code: "domain-ip", level: "warn", message: "Domain is an IP address. Only an exact host match will send this cookie." },
  ];
  assert.deepEqual(auditSetCookie(cookie("a", "1", { ...base, domain: "10.0.0.1" })), expected);
  assert.deepEqual(auditSetCookie(cookie("a", "1", { ...base, domain: "[::1]" })), expected);
});

test("value-invalid", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "x y", { secure: true, sameSite: "Lax" })), [
    { code: "value-invalid", level: "warn", message: "The value has a character browsers may mangle: \" \". URL-encode it." },
  ]));

test("duplicate-attribute", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { secure: true, sameSite: "Lax", duplicates: ["max-age", "httponly"] })), [
    { code: "duplicate-attribute", level: "warn", message: "Max-Age is given twice. The last one wins." },
    { code: "duplicate-attribute", level: "warn", message: "HttpOnly is given twice. The last one wins." },
  ]));

test("priority-invalid", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { secure: true, sameSite: "Lax", unknown: [["Priority", "urgent"]] })), [
    { code: "priority-invalid", level: "warn", message: "Priority=urgent isn't Low, Medium or High." },
  ]));

test("path-relative", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { secure: true, sameSite: "Lax", path: "app" })), [
    { code: "path-relative", level: "warn", message: "Path must start with /. Browsers use the request path instead." },
  ]));

test("samesite-missing", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { secure: true })), [
    { code: "samesite-missing", level: "info", message: "No SameSite. Chrome treats it as Lax; cross-site POSTs won't carry it." },
  ]));

test("expired", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { secure: true, sameSite: "Lax", maxAge: 0 }), { nowMs: NOW }), [
    { code: "expired", level: "info", message: "Already expired. Sending this deletes the cookie." },
  ]));

test("max-age-and-expires", () =>
  assert.deepEqual(
    auditSetCookie(cookie("a", "1", { secure: true, sameSite: "Lax", maxAge: 60, expires: "Wed, 21 Oct 2026 07:28:00 GMT" }), { nowMs: NOW }),
    [{ code: "max-age-and-expires", level: "info", message: "Both Max-Age and Expires are set. Max-Age wins." }],
  ));

test("domain-leading-dot", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { secure: true, sameSite: "Lax", domain: ".example.com" })), [
    { code: "domain-leading-dot", level: "info", message: "The leading dot in Domain is ignored. Subdomains match either way." },
  ]));

test("name-empty", () =>
  assert.deepEqual(auditSetCookie(cookie("", "1", { secure: true, sameSite: "Lax" })), [
    { code: "name-empty", level: "info", message: "No name. Browsers store the whole thing as a nameless value." },
  ]));

test("value-quoted", () =>
  assert.deepEqual(auditSetCookie(cookie("a", '"abc"', { secure: true, sameSite: "Lax" })), [
    { code: "value-quoted", level: "info", message: "The value is wrapped in quotes. Browsers keep the quotes as part of the value." },
  ]));

test("unknown-attribute", () =>
  assert.deepEqual(auditSetCookie(cookie("a", "1", { secure: true, sameSite: "Lax", unknown: [["Foo", "bar"], ["Baz", null]] })), [
    { code: "unknown-attribute", level: "info", message: "Foo isn't a Set-Cookie attribute. Browsers ignore it." },
    { code: "unknown-attribute", level: "info", message: "Baz isn't a Set-Cookie attribute. Browsers ignore it." },
  ]));

test("a clean cookie has no findings", () =>
  assert.deepEqual(
    auditSetCookie(cookie("__Host-sid", "1", { secure: true, httpOnly: true, path: "/", sameSite: "Strict" }), { nowMs: NOW }),
    [],
  ));

test("ordering is error, warn, info then table order", () => {
  const found = auditSetCookie(cookie("sid", "1", { sameSite: "None", domain: ".example.com" }));
  assert.deepEqual(
    found.map((f) => f.code),
    ["samesite-none-insecure", "auth-not-httponly", "auth-not-secure", "domain-leading-dot"],
  );
});

test("auditCookieHeader only checks name, value, size", () => {
  const c = cookie("sid", "x y");
  assert.deepEqual(auditCookieHeader({ ...c, attributes: null, lifetime: null }), [
    { code: "value-invalid", level: "warn", message: "The value has a character browsers may mangle: \" \". URL-encode it." },
  ]);
  assert.deepEqual(auditCookieHeader(cookie("", '"q"')).map((f) => f.code), ["name-empty", "value-quoted"]);
  assert.deepEqual(
    auditCookieHeader(cookie("a b", "1")),
    [{ code: "name-invalid", level: "error", message: "The name has a character cookies can't carry: \" \"." }],
  );
});

test("name-invalid reports the first offending character", () => {
  assert.equal(auditCookieHeader(cookie("a b", "1"))[0]?.message, "The name has a character cookies can't carry: \" \".");
  assert.equal(auditCookieHeader(cookie("a\u0001", "1"))[0]?.message, 'The name has a character cookies can\'t carry: "\\u0001".');
});

test("oversize at exactly 4097 bytes, not 4096", () => {
  assert.equal(auditCookieHeader(cookie("a", "x".repeat(4094))).length, 0);
  assert.equal(auditCookieHeader(cookie("a", "x".repeat(4095)))[0]?.code, "oversize");
});

test("auditSetCookie: the __Host- and __Secure- prefixes match case-insensitively", () => {
  const host = auditSetCookie(cookie("__HOST-sid", "1", { path: "/" }), { nowMs: NOW });
  assert.deepEqual(host.find((f) => f.code === "host-prefix-insecure"), { code: "host-prefix-insecure", level: "error", message: "__Host- cookies must be Secure. Browsers reject this one." });
  assert.ok(auditSetCookie(cookie("__secure-x", "1"), { nowMs: NOW }).some((f) => f.code === "secure-prefix-insecure"));
});
test("auditSetCookie: Domain=localhost is not a public suffix; Domain=com still is", () => {
  const codes = (domain: string) => auditSetCookie(cookie("a", "1", { domain, secure: true, sameSite: "Lax" }), { nowMs: NOW }).map((f) => f.code);
  assert.ok(!codes("localhost").includes("domain-public-suffix"));
  assert.ok(!codes("LocalHost").includes("domain-public-suffix"));
  assert.ok(codes("com").includes("domain-public-suffix"));
});
