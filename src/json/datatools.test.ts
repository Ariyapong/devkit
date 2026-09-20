import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDsv, csvToJson, jsonToCsv, toRows, validateJsonl, queryToJson } from "./datatools.js";
import { InputError } from "../errors.js";

test("parseDsv: basic rows and cells", () => {
  assert.deepEqual(parseDsv("a,b\n1,2", ","), [
    [{ text: "a", quoted: false }, { text: "b", quoted: false }],
    [{ text: "1", quoted: false }, { text: "2", quoted: false }],
  ]);
});

test("parseDsv: quoted fields — embedded delimiter, escaped quote, newline", () => {
  assert.deepEqual(parseDsv('"a,x","say ""hi""","l1\nl2"', ","), [
    [
      { text: "a,x", quoted: true },
      { text: 'say "hi"', quoted: true },
      { text: "l1\nl2", quoted: true },
    ],
  ]);
});

test("parseDsv: CRLF row endings and one trailing newline tolerated", () => {
  const expected = [
    [{ text: "a", quoted: false }, { text: "b", quoted: false }],
    [{ text: "1", quoted: false }, { text: "2", quoted: false }],
  ];
  assert.deepEqual(parseDsv("a,b\r\n1,2\r\n", ","), expected);
  assert.deepEqual(parseDsv("a,b\n1,2\n", ","), expected);
});

test("parseDsv: tab delimiter", () => {
  assert.deepEqual(parseDsv("a\tb\n1\t2", "\t"), [
    [{ text: "a", quoted: false }, { text: "b", quoted: false }],
    [{ text: "1", quoted: false }, { text: "2", quoted: false }],
  ]);
});

test("parseDsv: empty cells vs empty quoted cells", () => {
  assert.deepEqual(parseDsv('a,,""', ","), [
    [
      { text: "a", quoted: false },
      { text: "", quoted: false },
      { text: "", quoted: true },
    ],
  ]);
});

test("parseDsv: stray quote inside an unquoted cell is literal", () => {
  assert.deepEqual(parseDsv('a"b', ","), [[{ text: 'a"b', quoted: false }]]);
});

test("parseDsv: errors — unclosed quote, text after closing quote, empty input", () => {
  assert.throws(() => parseDsv('"unclosed', ","), InputError);
  assert.throws(() => parseDsv('"a"x,b', ","), InputError);
  assert.throws(() => parseDsv("", ","), InputError);
  assert.throws(() => parseDsv("\n", ","), InputError);
});

test("csvToJson: objects with smart inference", () => {
  const json = JSON.parse(csvToJson("name,age,active,note\nann,30,true,hi\nbo,,false,", ","));
  assert.deepEqual(json, [
    { name: "ann", age: 30, active: true, note: "hi" },
    { name: "bo", age: null, active: false, note: null },
  ]);
});

test("csvToJson: quoted cells always stay strings", () => {
  const json = JSON.parse(csvToJson('a,b,c\n"30","true",""', ","));
  assert.deepEqual(json, [{ a: "30", b: "true", c: "" }]);
});

test("csvToJson: integers past MAX_SAFE_INTEGER stay strings", () => {
  const json = JSON.parse(csvToJson("id\n9007199254740993", ","));
  assert.deepEqual(json, [{ id: "9007199254740993" }]);
});

test("csvToJson: numeric shapes — converted and not", () => {
  const json = JSON.parse(csvToJson("a,b,c,d,e\n-1.5,2e3,1e999, 30,.5", ","));
  // 1e999 overflows to Infinity (not JSON-safe) -> string; unquoted cells are
  // never trimmed, so " 30" is a string; ".5" lacks a leading digit -> string
  assert.deepEqual(json, [{ a: -1.5, b: 2000, c: "1e999", d: " 30", e: ".5" }]);
});

test("csvToJson: redundant leading zeros stay strings, plain zero/decimals do not", () => {
  const json = JSON.parse(csvToJson("a,b,c,d,e\n01234,-01,0,0.5,-0.5", ","));
  assert.deepEqual(json, [{ a: "01234", b: "-01", c: 0, d: 0.5, e: -0.5 }]);
});

test("csvToJson: header-only input gives an empty array", () => {
  assert.equal(csvToJson("a,b", ","), "[]");
});

test("csvToJson: header and row-shape errors", () => {
  assert.throws(() => csvToJson("a,,c\n1,2,3", ","), /empty name/);
  assert.throws(() => csvToJson("a,a\n1,2", ","), /Duplicate column/);
  assert.throws(() => csvToJson("a,b\n1,2,3", ","), /Row 2 has 3 field\(s\), expected 2/);
});

test("csvToJson: __proto__ header column is kept as data", () => {
  assert.match(csvToJson("__proto__,a\nx,1", ","), /"__proto__": "x"/);
});

test("jsonToCsv: array of objects, union header in first-seen order", () => {
  const csv = jsonToCsv('[{"a":1,"b":"x"},{"b":"y","c":true}]', ",");
  assert.equal(csv, "a,b,c\n1,x,\n,y,true");
});

test("jsonToCsv: quotes delimiters, quotes, and infer-lookalike strings", () => {
  const csv = jsonToCsv('[{"s":"a,b","q":"say \\"hi\\"","n":"30","t":"true","e":""}]', ",");
  assert.equal(csv, 's,q,n,t,e\n"a,b","say ""hi""","30","true",""');
});

test("jsonToCsv: nested values are JSON-stringified into cells", () => {
  const csv = jsonToCsv('[{"m":{"x":1},"l":[1,2]}]', ",");
  assert.equal(csv, 'm,l\n"{""x"":1}","[1,2]"');
});

test("jsonToCsv: array of arrays emits rows verbatim, no header", () => {
  assert.equal(jsonToCsv('[[1,"a"],[2,"b"]]', ","), "1,a\n2,b");
});

test("jsonToCsv: tab delimiter", () => {
  assert.equal(jsonToCsv('[{"a":1,"b":2}]', "\t"), "a\tb\n1\t2");
});

test("jsonToCsv: rejected shapes", () => {
  assert.throws(() => jsonToCsv('{"a":1}', ","), InputError);
  assert.throws(() => jsonToCsv("[]", ","), InputError);
  assert.throws(() => jsonToCsv("[1,2]", ","), InputError);
  assert.throws(() => jsonToCsv('[{"a":1},[2]]', ","), InputError);
  assert.throws(() => jsonToCsv("{nope", ","), InputError);
});

test("round-trip: from-csv(to-csv(x)) = x for uniform keys", () => {
  const original = [
    { name: "ann", age: 30, active: true, note: "hi", empty: "", id: "9007199254740993" },
    { name: "bo", age: null, active: false, note: "a,b", empty: "x", id: "1" },
  ];
  const csv = jsonToCsv(JSON.stringify(original), ",");
  assert.deepEqual(JSON.parse(csvToJson(csv, ",")), original);
});

test("jsonToCsv: missing keys named after Object.prototype methods stay empty", () => {
  assert.equal(jsonToCsv('[{"toString":1},{"other":2}]', ","), "toString,other\n1,\n,2");
});

test("validateJsonl: all valid converts to a JSON array", () => {
  const res = validateJsonl('{"a":1}\n[2]\n"x"\n');
  assert.equal(res.ok, true);
  assert.deepEqual(JSON.parse(res.body), [{ a: 1 }, [2], "x"]);
});

test("validateJsonl: broken rows reported with line numbers (blank line = broken)", () => {
  const res = validateJsonl('{"a":1}\n{nope\n\n{"b":2}');
  assert.equal(res.ok, false);
  assert.match(res.body, /^❌ 2 of 4 line\(s\) invalid/);
  assert.match(res.body, /line 2: /);
  assert.match(res.body, /line 3: /);
});

test("validateJsonl: CRLF tolerated", () => {
  assert.equal(validateJsonl("1\r\n2\r\n").ok, true);
});

test("validateJsonl: caps the report at 10 broken lines", () => {
  const res = validateJsonl(Array.from({ length: 12 }, () => "{nope").join("\n"));
  assert.match(res.body, /12 of 12/);
  assert.match(res.body, /…and 2 more/);
  assert.equal(res.body.split("\n").length, 12); // header + 10 lines + "more"
});

test("validateJsonl: empty input throws", () => {
  assert.throws(() => validateJsonl("\n"), InputError);
});

test("queryToJson: bare list, repeated keys, valueless key", () => {
  assert.deepEqual(JSON.parse(queryToJson("a=1&b=x&b=y&flag")), {
    a: "1",
    b: ["x", "y"],
    flag: "",
  });
});

test("queryToJson: full URL — query extracted, fragment stripped, decoding", () => {
  assert.deepEqual(JSON.parse(queryToJson("https://x.dev/p?q=hello%20world&tag=a+b#frag")), {
    q: "hello world",
    tag: "a b",
  });
});

test("queryToJson: leading ? accepted", () => {
  assert.deepEqual(JSON.parse(queryToJson("?a=1")), { a: "1" });
});

test("queryToJson: __proto__ key handled as data", () => {
  assert.match(queryToJson("__proto__=x&a=1"), /"__proto__": "x"/);
});

test("queryToJson: nothing found throws", () => {
  assert.throws(() => queryToJson("https://x.dev/path"), InputError);
  assert.throws(() => queryToJson(""), InputError);
});

test("queryToJson: opaque URI (no //) with no query throws instead of a junk key", () => {
  assert.throws(() => queryToJson("mailto:someone@example.com"), InputError);
  assert.throws(() => queryToJson("tel:+15551234567"), InputError);
});

test("toRows: array of objects unions keys in first-seen order", () => {
  const source = toRows('[{"a":1,"b":2},{"a":3,"c":4}]');
  if (source.kind !== "objects") throw new Error("expected objects");
  assert.deepEqual(source.keys, ["a", "b", "c"]);
  assert.deepEqual(source.rows, [
    [1, 2, undefined],
    [3, undefined, 4],
  ]);
});

test("toRows: array of arrays is positional and left ragged", () => {
  const source = toRows("[[1,2,3],[4,5]]");
  if (source.kind !== "arrays") throw new Error("expected arrays");
  assert.deepEqual(source.rows, [
    [1, 2, 3],
    [4, 5],
  ]);
});

test("toRows: [{},{}] is objects with zero keys, not positional", () => {
  // The `kind` discriminator exists for exactly this case — an empty key list
  // alone would be indistinguishable from positional data.
  const source = toRows("[{},{}]");
  assert.equal(source.kind, "objects");
});

test("toRows: rejects the bad shapes with to-csv's messages", () => {
  assert.throws(() => toRows('{"a":1}'), /non-empty JSON array/);
  assert.throws(() => toRows("[]"), /non-empty JSON array/);
  assert.throws(() => toRows("[1,2,3]"), /array of objects or an array of arrays/);
  assert.throws(() => toRows('[{"a":1},[1]]'), /array of objects or an array of arrays/);
  assert.throws(() => toRows("{bad"), /Invalid JSON/);
});
