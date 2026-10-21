import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../errors.js";
import { parseCookieHeader } from "./cookie-parse.js";
import { buildSetCookie, formFromCookie, ERR_COOKIE_NAME, ERR_MAX_AGE, ERR_EXPIRES } from "./cookie-build.js";
import type { SetCookieForm } from "./cookie-build.js";

const NOW = 1_800_000_000_000;
const FULL: SetCookieForm = {
  name: "sid", value: "a b", domain: "example.com", path: "/",
  lifetime: "max-age", maxAge: "3600", expires: "",
  secure: true, httpOnly: true, partitioned: true, sameSite: "Lax", priority: "High",
};

test("buildSetCookie: attribute order and snippets", () => {
  const b = buildSetCookie(FULL, { nowMs: NOW });
  assert.equal(b.header, "sid=a b; Max-Age=3600; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax; Partitioned; Priority=High");
  assert.equal(b.express, 'res.cookie("sid", "a b", {\n  domain: "example.com",\n  path: "/",\n  maxAge: 3600 * 1000,        // Express takes milliseconds\n  secure: true,\n  httpOnly: true,\n  sameSite: "lax",            // lowercase, as Express expects\n  partitioned: true,\n  priority: "high",\n});');
  assert.ok(b.dotnet.startsWith('Response.Cookies.Append("sid", "a b", new CookieOptions\n{\n'));
  assert.ok(b.dotnet.includes("MaxAge = TimeSpan.FromSeconds(3600),"));
  assert.ok(b.dotnet.includes("// Partitioned and Priority have no CookieOptions property; append them to the header yourself."));
  assert.ok(b.cookie.audit.some((f) => f.code === "value-invalid")); // the space
});
test("buildSetCookie: Expires is IMF-fixdate; session emits nothing", () => {
  assert.ok(buildSetCookie({ ...FULL, lifetime: "expires", expires: "2026-10-21T07:28:00Z" }).header.includes("Expires=Wed, 21 Oct 2026 07:28:00 GMT"));
  assert.equal(buildSetCookie({ ...FULL, lifetime: "session", domain: "", path: "", partitioned: false, priority: "" }).header, "sid=a b; Secure; HttpOnly; SameSite=Lax");
});
test("buildSetCookie: errors", () => {
  assert.throws(() => buildSetCookie({ ...FULL, name: " " }), (e: unknown) => e instanceof InputError && e.message === ERR_COOKIE_NAME);
  assert.throws(() => buildSetCookie({ ...FULL, maxAge: "1.5" }), (e: unknown) => e instanceof InputError && e.message === ERR_MAX_AGE);
  assert.throws(() => buildSetCookie({ ...FULL, lifetime: "expires", expires: "2026-10-21T07:28" }), (e: unknown) => e instanceof InputError && e.message === ERR_EXPIRES);
});
test("formFromCookie round trip", () => {
  const b = buildSetCookie(FULL, { nowMs: NOW });
  assert.deepEqual(formFromCookie(b.cookie), FULL);
  assert.deepEqual(formFromCookie(parseCookieHeader("a=1")[0]!), { name: "a", value: "1", domain: "", path: "", lifetime: "session", maxAge: "", expires: "", secure: false, httpOnly: false, partitioned: false, sameSite: "", priority: "" });
});
