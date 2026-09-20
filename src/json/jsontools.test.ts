import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatJson,
  jsonParseString,
  jsonStringify,
  jsonToTs,
  jsonToYaml,
  minifyJson,
  validateJson,
  yamlToJson,
} from "./jsontools.js";
import { InputError } from "../errors.js";
import { toRows } from "./datatools.js";
import { renderErrorDetail } from "../discord/render-error-detail.js";

test("formatJson / minifyJson", () => {
  assert.equal(formatJson('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(minifyJson('{\n  "a": 1\n}'), '{"a":1}');
  assert.throws(() => formatJson("{nope"), InputError);
});

test("validateJson summaries", () => {
  assert.equal(validateJson('{"a":1,"b":2}'), "✅ Valid JSON — object, 2 key(s)");
  assert.equal(validateJson("[1,2,3]"), "✅ Valid JSON — array, 3 item(s)");
  assert.equal(validateJson("42"), "✅ Valid JSON — number");
});

test("jsonStringify escapes raw text", () => {
  assert.equal(jsonStringify('{"a":1}'), '"{\\"a\\":1}"');
});

test("jsonParseString unescapes double-encoded JSON", () => {
  assert.equal(jsonParseString('"{\\"a\\":1}"'), '{\n  "a": 1\n}');
  assert.equal(jsonParseString('"plain text"'), "plain text");
  assert.throws(() => jsonParseString('{"a":1}'), InputError); // already plain JSON
});

test("jsonToTs infers nested interfaces", () => {
  const output = jsonToTs('{"id":1,"name":"a","tags":["x"],"meta":{"ok":true}}');
  assert.ok(output.startsWith("interface Root {"));
  assert.ok(output.includes("id: number;"));
  assert.ok(output.includes("tags: string[];"));
  assert.ok(output.includes("meta: Meta;"));
  assert.ok(output.includes("interface Meta {"));
  assert.ok(output.includes("ok: boolean;"));
});

test("jsonToTs non-object root becomes type alias", () => {
  assert.equal(jsonToTs("[1,2]"), "type Root = number[];");
});

test("jsonToTs uniquifies array-item interfaces with differing shapes", () => {
  const output = jsonToTs('{"items":[{"a":1},{"a":1,"b":"x"}]}');
  assert.equal(output.match(/interface ItemsItem \{/g)?.length, 1);
  assert.equal(output.match(/interface ItemsItem2 \{/g)?.length, 1);
  assert.ok(output.includes("items: (ItemsItem | ItemsItem2)[];"));
});

test("jsonToTs collapses array-item interfaces with identical shapes", () => {
  const output = jsonToTs('{"items":[{"a":1},{"a":2}]}');
  assert.equal(output.match(/interface ItemsItem \{/g)?.length, 1);
  assert.ok(output.includes("items: ItemsItem[];"));
});

test("jsonToTs uniquifies same-named interfaces from different branches", () => {
  const output = jsonToTs('{"data":{"items":{"a":1}},"meta":{"items":{"b":"x"}}}');
  assert.equal(output.match(/interface Items \{/g)?.length, 1);
  assert.equal(output.match(/interface Items2 \{/g)?.length, 1);
  assert.ok(output.includes("items: Items;"));
  assert.ok(output.includes("items: Items2;"));
});

test("jsonToTs empty object has no blank line in body", () => {
  assert.equal(jsonToTs("{}"), "interface Root {}");
});

test("yaml conversions", () => {
  assert.equal(yamlToJson("a: 1"), '{\n  "a": 1\n}');
  assert.equal(jsonToYaml('{"a":1}'), "a: 1\n");
  assert.throws(() => yamlToJson("a: [unclosed"), InputError);
});

test("yamlToJson error carries line/col and a fenced caret frame", () => {
  assert.throws(
    () => yamlToJson("key: value: other\n"),
    (error: unknown) =>
      error instanceof InputError &&
      error.message + (error.detail ? renderErrorDetail(error.detail) : "") ===
        "Invalid YAML (line 1, col 6): Nested mappings are not allowed in compact mappings\n```\nkey: value: other\n     ^\n```",
  );
});

test("a located error still carries the Invalid JSON prefix", () => {
  // datatools.test.ts asserts /Invalid JSON/ on toRows; keep that contract.
  assert.throws(() => toRows("{bad"), /Invalid JSON/);
});
