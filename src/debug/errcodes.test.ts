import { test } from "node:test";
import assert from "node:assert/strict";
import { allErrCodes, lookupErrCode, scanErrTokens } from "./errcodes.js";

test("lookup: errno name, case-insensitive", () => {
  assert.equal(lookupErrCode("econnrefused")?.family, "errno");
  assert.equal(lookupErrCode("ECONNREFUSED")?.code, "ECONNREFUSED");
});

test("lookup: numeric 100-599 resolves as HTTP", () => {
  const info = lookupErrCode("502");
  assert.equal(info?.family, "http");
  assert.match(info?.meaning ?? "", /gateway|upstream/i);
});

test("lookup: numeric outside HTTP range resolves as exit code", () => {
  assert.equal(lookupErrCode("137")?.family, "exit");
});

test("lookup: SIG-prefixed resolves as signal", () => {
  assert.equal(lookupErrCode("sigkill")?.code, "SIGKILL");
});

test("lookup: .NET exception with and without namespace", () => {
  assert.equal(lookupErrCode("System.NullReferenceException")?.family, "dotnet");
  assert.equal(lookupErrCode("nullreferenceexception")?.code, "NullReferenceException");
});

test("lookup: unknown returns null", () => {
  assert.equal(lookupErrCode("EWHATEVER"), null);
  assert.equal(lookupErrCode("999"), null);
});

test("scan: word-bounded errno in prose", () => {
  const hits = scanErrTokens("connect ECONNREFUSED 127.0.0.1:5432");
  assert.equal(hits[0]?.code, "ECONNREFUSED");
});

test("scan: bare number never fires as HTTP", () => {
  assert.equal(scanErrTokens("retried 502 times").length, 0);
});

test("scan: HTTP number with context fires", () => {
  assert.equal(scanErrTokens("upstream returned status 502")[0]?.family, "http");
  assert.equal(scanErrTokens("HTTP 404 from api")[0]?.code, "404");
  assert.equal(scanErrTokens("got 502 Bad Gateway")[0]?.code, "502");
});

test("scan: .NET name requires the Exception suffix", () => {
  assert.equal(scanErrTokens("System.NullReferenceException: boom")[0]?.family, "dotnet");
  assert.equal(scanErrTokens("NullReference happened").length, 0);
});

test("scan: exit code and signal need explicit tokens", () => {
  assert.equal(scanErrTokens("process exited with code 137")[0]?.code, "137");
  assert.equal(scanErrTokens("killed by SIGKILL")[0]?.code, "SIGKILL");
  assert.equal(scanErrTokens("we have 137 users").length, 0);
});

test("scan: deduped and capped at 3", () => {
  const text =
    "ECONNREFUSED then ECONNREFUSED again, status 502, exited with code 137, ETIMEDOUT too";
  const hits = scanErrTokens(text);
  assert.equal(hits.length, 3);
  assert.equal(new Set(hits.map((h) => h.code)).size, 3);
});

test("allErrCodes: contains one canonical entry per family", () => {
  const codes = allErrCodes();
  for (const expected of ["ECONNREFUSED", "502", "NullReferenceException", "SIGKILL"]) {
    assert.ok(codes.includes(expected), expected);
  }
});
