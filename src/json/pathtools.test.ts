import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PATH_CHARS, parsePath, queryJson } from "./pathtools.js";
import { InputError } from "../errors.js";

const key = (k: string) => ({ kind: "key" as const, key: k });
const idx = (i: number) => ({ kind: "index" as const, index: i });

test("parsePath: accepted forms", () => {
  const table: [string, ReturnType<typeof parsePath>][] = [
    ["", []],
    ["$", []],
    ["a", [key("a")]],
    [".a", [key("a")]],
    ["$.a", [key("a")]],
    ["a.b", [key("a"), key("b")]],
    ["a[0]", [key("a"), idx(0)]],
    ["a[-1]", [key("a"), idx(-1)]],
    ["[0]", [idx(0)]],
    ["$[0].x", [idx(0), key("x")]],
    ['a["weird key"]', [key("a"), key("weird key")]],
    ["a['it\\'s']", [key("a"), key("it's")]],
    ['a["q\\"b\\\\"]', [key("a"), key('q"b\\')]],
    ["$a", [key("$a")]],
    ["a. b", [key("a"), key(" b")]],
    ["สวัสดี.x", [key("สวัสดี"), key("x")]],
    ["a[0][1]", [key("a"), idx(0), idx(1)]],
  ];
  for (const [path, want] of table) assert.deepEqual(parsePath(path), want, JSON.stringify(path));
});

test("parsePath: rejected forms, with the caret column", () => {
  const table: [string, number][] = [
    ["a..b", 3], // empty dot segment, caret on the second '.'
    ["a.", 2], // trailing dot
    ["a[", 3], // unterminated bracket
    ["a[x]", 3], // not an index, not a quoted key
    ["a[1.5]", 4],
    ['a["x]', 2], // unterminated quote: caret on the '[' that opened it
    ["a]", 2],
    ["a\nb", 2], // control character
    ["a\tb", 2],
    ["a\u0000b", 2], // NUL
  ];
  for (const [path, column] of table) {
    assert.throws(
      () => parsePath(path),
      (e) => {
        assert.ok(e instanceof InputError, JSON.stringify(path));
        assert.equal(e.message, "Invalid path.", JSON.stringify(path));
        assert.equal(e.detail?.position?.column, column, JSON.stringify(path));
        assert.equal(e.detail?.lines.length, 2, JSON.stringify(path)); // one row + caret, never a neighbour
        assert.equal(e.detail?.positionLine, undefined);
        return true;
      },
    );
  }
});

test("parsePath: the length cap", () => {
  assert.doesNotThrow(() => parsePath("a".repeat(MAX_PATH_CHARS)));
  assert.throws(() => parsePath("a".repeat(MAX_PATH_CHARS + 1)), (e) => e instanceof InputError && e.message === "Path is too long.");
});

const DOC = '{"a": {"b": [10, 20, {"c": "deep"}], "__proto__": {"x": 1}, "0": "zero"}, "n": null, "s": "str"}';

test("queryJson: walks keys and indices", () => {
  assert.deepEqual(queryJson(DOC, ""), JSON.parse(DOC));
  assert.equal(queryJson(DOC, "a.b[0]"), 10);
  assert.equal(queryJson(DOC, "a.b[-1].c"), "deep");
  assert.equal(queryJson(DOC, '$["a"]["b"][1]'), 20);
  assert.equal(queryJson(DOC, "n"), null);
  assert.equal(queryJson(DOC, "a.0"), "zero"); // .name is always a key, even when numeric
  assert.deepEqual(queryJson(DOC, "a.__proto__"), { x: 1 }); // own data, never the prototype
});

test("queryJson: every miss clause", () => {
  const cases: [string, string][] = [
    ["a.b.c", 'Path not found at "a.b.c": the value there is an array with 3 item(s), not an object.'],
    ["a[0]", 'Path not found at "a[0]": the value there is an object with 3 key(s), not an array.'],
    ["a.zzz", 'Path not found at "a.zzz": the key does not exist.'],
    ["a.b[3]", 'Path not found at "a.b[3]": the index is out of range (3 item(s)).'],
    ["a.b[-4]", 'Path not found at "a.b[-4]": the index is out of range (3 item(s)).'],
    ["s.x", 'Path not found at "s.x": the value there is a string.'],
    ["n.x", 'Path not found at "n.x": the value there is a null.'],
    ["a.constructor", 'Path not found at "a.constructor": the key does not exist.'],
  ];
  for (const [path, message] of cases) {
    assert.throws(() => queryJson(DOC, path), (e) => {
      assert.ok(e instanceof InputError);
      assert.equal(e.message, message, path);
      assert.equal(e.detail?.kind, "excerpt");
      assert.equal(e.detail?.lines.length, 2);
      return true;
    });
  }
});

test("queryJson: a scalar root with a non-empty path is a miss, not a TypeError", () => {
  assert.throws(() => queryJson("42", "a"), (e) => e instanceof InputError && e.message === 'Path not found at "a": the value there is a number.');
  assert.equal(queryJson("42", ""), 42);
});

test("queryJson: a bad document throws the located JSON error, not a path error", () => {
  assert.throws(() => queryJson("{nope", "a"), (e) => e instanceof InputError && e.message.startsWith("Invalid JSON"));
});

test("queryJson: the miss caret sits under the failing segment", () => {
  try {
    queryJson(DOC, "a.b[3]");
    assert.fail("expected a throw");
  } catch (e) {
    assert.ok(e instanceof InputError);
    assert.deepEqual(e.detail?.lines, ["  1 | a.b[3]", "    |    ^"]);
    assert.equal(e.detail?.caretLine, 1);
  }
});

test("queryJson: miss after a quoted key that ends in an escaped backslash (prefix and caret stay right)", () => {
  const doc = '{"a": {"x\\\\": 5}}'; // the key is x\
  assert.equal(queryJson(doc, 'a["x\\\\"]'), 5);
  assert.throws(() => queryJson(doc, 'a["x\\\\"].y'), (e) => {
    assert.ok(e instanceof InputError);
    assert.equal(e.message, 'Path not found at "a["x\\\\"].y": the value there is a number.');
    assert.equal(e.detail?.position?.column, 9); // the '.' of .y
    assert.deepEqual(e.detail?.lines, ['  1 | a["x\\\\"].y', "    |         ^"]);
    return true;
  });
  assert.throws(() => queryJson(doc, 'a["zz"].y'), (e) => e instanceof InputError && e.message === 'Path not found at "a["zz"]": the key does not exist.');
});
