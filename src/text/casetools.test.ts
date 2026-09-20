import { test } from "node:test";
import assert from "node:assert/strict";
import { allCases, convertCase, tokenizeWords } from "./casetools.js";
import { InputError } from "../errors.js";

test("tokenizeWords: camel/acronym/digit/unicode boundaries", () => {
  const cases: [string, string[]][] = [
    ["fooBarBaz", ["foo", "Bar", "Baz"]],
    ["XMLHttpRequest", ["XML", "Http", "Request"]],
    ["parseURLQuery", ["parse", "URL", "Query"]],
    ["URLId", ["URL", "Id"]],
    ["ID", ["ID"]],
    ["user2Id", ["user2", "Id"]],
    ["v3Api", ["v3", "Api"]],
    ["sha256Sum", ["sha256", "Sum"]],
    ["utf8", ["utf8"]],
    ["i18n", ["i18n"]],
    ["3dModel", ["3d", "Model"]],
    ["naïveCafé", ["naïve", "Café"]],
    ["MÜLLERStraße", ["MÜLLER", "Straße"]],
    ["名前Value", ["名前", "Value"]],
    ["foo-bar_baz.qux hey", ["foo", "bar", "baz", "qux", "hey"]],
    ["snake_case", ["snake", "case"]],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(tokenizeWords(input), expected, input);
  }
});

test("convertCase: all 8 cases for XMLHttpRequest (acronyms down-cased)", () => {
  assert.equal(convertCase("XMLHttpRequest", "camel"), "xmlHttpRequest");
  assert.equal(convertCase("XMLHttpRequest", "pascal"), "XmlHttpRequest");
  assert.equal(convertCase("XMLHttpRequest", "snake"), "xml_http_request");
  assert.equal(convertCase("XMLHttpRequest", "kebab"), "xml-http-request");
  assert.equal(convertCase("XMLHttpRequest", "constant"), "XML_HTTP_REQUEST");
  assert.equal(convertCase("XMLHttpRequest", "dot"), "xml.http.request");
  assert.equal(convertCase("XMLHttpRequest", "title"), "Xml Http Request");
  assert.equal(convertCase("XMLHttpRequest", "space"), "xml http request");
});

test("convertCase: idempotent", () => {
  assert.equal(convertCase("snake_case", "snake"), "snake_case");
  assert.equal(convertCase("kebab-case", "kebab"), "kebab-case");
  assert.equal(convertCase("CONSTANT_CASE", "constant"), "CONSTANT_CASE");
});

test("allCases: returns all 8 labelled entries", () => {
  const entries = allCases("fooBar");
  assert.equal(entries.length, 8);
  assert.deepEqual(
    entries.map((e) => e.key),
    ["camel", "pascal", "snake", "kebab", "constant", "dot", "title", "space"],
  );
  assert.equal(entries.find((e) => e.key === "constant")!.value, "FOO_BAR");
});

test("tokenizeWords: nothing to convert throws InputError", () => {
  for (const bad of ["___", "🚀", "  ", "--"]) {
    assert.throws(() => tokenizeWords(bad), InputError, bad);
  }
});
