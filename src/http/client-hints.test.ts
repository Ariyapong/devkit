import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClientHints } from "./client-hints.js";
import { parseSfItem, parseSfList } from "./structured-field.js";

const HEADERS = 'Sec-CH-UA: "Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"\nSec-CH-UA-Mobile: ?0\nSec-CH-UA-Platform: "Windows"\nSec-CH-UA-Platform-Version: "15.0.0"\nsec-ch-ua-arch: "x86"\nSec-CH-UA-Full-Version-List: "Chromium";v="124.0.6367.60", "Not(A:Brand";v="8.0.0.0"';
test("parseClientHints: header block, GREASE removed, Windows 11 mapping", () => {
  const h = parseClientHints(HEADERS)!;
  assert.deepEqual(h.brands, [{ brand: "Chromium", version: "124" }, { brand: "Google Chrome", version: "124" }]);
  assert.deepEqual(h.fullVersionList, [{ brand: "Chromium", version: "124.0.6367.60" }]);
  assert.equal(h.mobile, false); assert.equal(h.platform, "Windows"); assert.equal(h.architecture, "x86");
  assert.equal(h.osGuess, "Windows 11");
  assert.deepEqual(h.notes, ["Windows 11 reports platform version 13 or higher."]);
});
test("parseClientHints: object from getHighEntropyValues, macOS and Android guesses, null when absent", () => {
  assert.equal(parseClientHints({ brands: [{ brand: "Not/A)Brand", version: "8" }, { brand: "Chromium", version: "124" }], mobile: true, platform: "Android", platformVersion: "14.0.0", model: "Pixel 8" })!.osGuess, "Android 14.0.0");
  assert.equal(parseClientHints({ platform: "macOS", platformVersion: "14.4.1" })!.osGuess, "macOS 14.4.1");
  assert.equal(parseClientHints({ platform: "Windows", platformVersion: "10.0.0" })!.osGuess, "Windows 10");
  assert.equal(parseClientHints({ platform: "Windows", platformVersion: "0.3.0" })!.osGuess, "Windows 7/8");
  assert.equal(parseClientHints("Accept: */*"), null);
  assert.equal(parseClientHints({}), null);
});
test("structured fields: quoted strings with escapes, ?1/?0, params", () => {
  assert.deepEqual(parseSfList('"A\\"B";v="1", "C"'), [{ value: 'A"B', params: { v: "1" } }, { value: "C", params: {} }]);
  assert.equal(parseSfItem("?1"), true); assert.equal(parseSfItem("?0"), false); assert.equal(parseSfItem("nope"), null);
});
