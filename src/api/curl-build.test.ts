import assert from "node:assert/strict";
import { test } from "node:test";
import { ERR_AUTH_BLANK, ERR_AUTH_TWICE, ERR_HEAD_BODY, ERR_METHOD, ERR_URL, WARN_NO_SCHEME, WARN_RAW_BODY, parseRequestForm, quoteArg, type RequestForm, toCurl, methodForLog } from "./curl-build.js";
import { InputError } from "../errors.js";
import { parseCurl } from "./curltools.js";
import { utf8ToBase64 } from "../shared/bytes.js";

test("quoteArg single-quotes a plain value", () => {
  assert.equal(quoteArg("", "https://a.co/x?y=1&z=2"), "'https://a.co/x?y=1&z=2'");
});

test("quoteArg prepends the literal part inside the same quotes", () => {
  assert.equal(quoteArg("Authorization: Bearer ", "eyJ.abc"), "'Authorization: Bearer eyJ.abc'");
});

test("quoteArg escapes an embedded single quote the POSIX way", () => {
  assert.equal(quoteArg("", "it's"), "'it'\\''s'");
});

test("quoteArg keeps double quotes, backslashes and backticks literal inside single quotes", () => {
  assert.equal(quoteArg("", 'a"b\\c`d'), "'a\"b\\c`d'");
});

test("quoteArg double-quotes an exact $VAR or ${VAR} placeholder", () => {
  assert.equal(quoteArg("Authorization: Bearer ", "$TOKEN"), '"Authorization: Bearer $TOKEN"');
  assert.equal(quoteArg("", "${TOKEN}"), '"${TOKEN}"');
  assert.equal(quoteArg("", "$_x1"), '"$_x1"');
});

test("quoteArg treats anything but an exact placeholder as literal (a password may contain $)", () => {
  for (const v of ["x$TOKEN", "$TOKEN.", "p$ss", "$1", "$", "$TOKEN $B", "${}", "$ TOKEN"]) {
    assert.equal(quoteArg("", v), "'" + v + "'", v);
  }
});

test("quoteArg escapes \", \\, ` and $ in the literal part of the double-quoted form", () => {
  assert.equal(quoteArg('X"Y\\Z`$: ', "$V"), '"X\\"Y\\\\Z\\`\\$: $V"');
});

const blank: RequestForm = { url: "https://a.co/x", method: "", auth: "", headers: "", body: "" };
const form = (o: Partial<RequestForm>): RequestForm => ({ ...blank, ...o });

// ---- URL (decision 7) ----

test("url: kept as typed, trimmed, no warning", () => {
  const spec = parseRequestForm(form({ url: "  https://a.co/x?y=1  " }));
  assert.equal(spec.url, "https://a.co/x?y=1");
  assert.deepEqual(spec.warnings, []);
});

test("url: http is kept, not upgraded", () => {
  assert.equal(parseRequestForm(form({ url: "http://a.co" })).url, "http://a.co");
});

test("url: bare host gets https:// and a warning", () => {
  const spec = parseRequestForm(form({ url: "a.co/x" }));
  assert.equal(spec.url, "https://a.co/x");
  assert.deepEqual(spec.warnings, [WARN_NO_SCHEME]);
});

test("url: host:port is not a scheme — still prefixed", () => {
  assert.equal(parseRequestForm(form({ url: "localhost:3000/x" })).url, "https://localhost:3000/x");
  assert.equal(parseRequestForm(form({ url: "api.x.com:8443/x" })).url, "https://api.x.com:8443/x");
});

test("url: a scheme-like typo is rejected rather than mangled into a prefixed host (final review 2026-09-03)", () => {
  assert.throws(() => parseRequestForm(form({ url: "http:/x" })), { message: ERR_URL });
  assert.throws(() => parseRequestForm(form({ url: "//host/x" })), { message: ERR_URL });
  assert.equal(parseRequestForm(form({ url: "localhost:3000/x" })).url, "https://localhost:3000/x");
  assert.equal(parseRequestForm(form({ url: "api.x.com:8443/x" })).url, "https://api.x.com:8443/x");
});

test("url: emitted without the trailing slash WHATWG would add", () => {
  assert.equal(parseRequestForm(form({ url: "https://host" })).url, "https://host");
});

test("url: a placeholder skips scheme handling and validation", () => {
  const spec = parseRequestForm(form({ url: "$URL" }));
  assert.equal(spec.url, "$URL");
  assert.deepEqual(spec.warnings, []);
});

test("url: invalid or blank or containing whitespace is an InputError with the fixed message", () => {
  for (const url of ["https://", "not a url", "https://a.com/a b", "", "   ", "https://a.com/\tx"]) {
    assert.throws(() => parseRequestForm(form({ url })), { message: ERR_URL }, url);
    assert.throws(() => parseRequestForm(form({ url })), InputError);
  }
});

// ---- Body (decision 4) ----

test("body: whitespace-only is no body", () => {
  assert.equal(parseRequestForm(form({ body: "  \n " })).body, null);
});

test("body: JSON of any type is kind json, text verbatim (trimmed)", () => {
  for (const text of ['{"a":1}', "[1,2]", '"s"', "1", "null"]) {
    assert.deepEqual(parseRequestForm(form({ body: ` ${text} ` })).body, { kind: "json", text });
  }
});

test("body: pretty-printed JSON stays multi-line", () => {
  const text = '{\n  "a": 1,\n  "b": [1, 2]\n}';
  assert.deepEqual(parseRequestForm(form({ body: text })).body, { kind: "json", text });
});

test("body: CRLF is normalised to LF", () => {
  assert.deepEqual(parseRequestForm(form({ body: "{\r\n\"a\": 1\r\n}" })).body, {
    kind: "json",
    text: '{\n"a": 1\n}',
  });
});

test("body: non-JSON is kind raw", () => {
  assert.deepEqual(parseRequestForm(form({ body: "a=1&b=2" })).body, { kind: "raw", text: "a=1&b=2" });
  assert.deepEqual(parseRequestForm(form({ body: "@file.json" })).body, { kind: "raw", text: "@file.json" });
});

test("body: a placeholder is raw", () => {
  assert.deepEqual(parseRequestForm(form({ body: "$BODY" })).body, { kind: "raw", text: "$BODY" });
});

test("content-type: json body ⇒ added; raw body ⇒ warning instead", () => {
  const json = parseRequestForm(form({ body: '{"a":1}' }));
  assert.equal(json.contentTypeAdded, true);
  assert.deepEqual(json.warnings, []);
  const raw = parseRequestForm(form({ body: "a=1" }));
  assert.equal(raw.contentTypeAdded, false);
  assert.deepEqual(raw.warnings, [WARN_RAW_BODY]);
  const none = parseRequestForm(form({}));
  assert.equal(none.contentTypeAdded, false);
});

test("warnings: scheme warning precedes the body warning", () => {
  assert.deepEqual(parseRequestForm(form({ url: "a.co", body: "x" })).warnings, [WARN_NO_SCHEME, WARN_RAW_BODY]);
});

// ---- Method (decision 6) ----

test("method: blank resolves to what curl infers, and -X is elided", () => {
  const get = parseRequestForm(form({}));
  assert.equal(get.method, "GET");
  assert.equal(get.emitMethodFlag, false);
  const post = parseRequestForm(form({ body: "a=1" }));
  assert.equal(post.method, "POST");
  assert.equal(post.emitMethodFlag, false);
});

test("method: typed value matching the inference still elides -X", () => {
  assert.equal(parseRequestForm(form({ method: "get" })).emitMethodFlag, false);
  assert.equal(parseRequestForm(form({ method: "POST", body: "a=1" })).emitMethodFlag, false);
});

test("method: typed value differing from the inference emits -X, uppercased", () => {
  const patch = parseRequestForm(form({ method: " patch " }));
  assert.equal(patch.method, "PATCH");
  assert.equal(patch.emitMethodFlag, true);
  assert.equal(parseRequestForm(form({ method: "GET", body: "a=1" })).emitMethodFlag, true);
  assert.equal(parseRequestForm(form({ method: "POST" })).emitMethodFlag, true);
});

test("method: HEAD resolves as HEAD (emitted as -I in Task 4)", () => {
  const head = parseRequestForm(form({ method: "head" }));
  assert.equal(head.method, "HEAD");
  assert.equal(head.emitMethodFlag, true);
});

test("method: HEAD cannot carry a body (final review 2026-09-03)", () => {
  assert.throws(() => parseRequestForm(form({ method: "head", body: "x" })), { message: ERR_HEAD_BODY });
  assert.throws(() => parseRequestForm(form({ method: "head", body: "x" })), InputError);
  assert.equal(parseRequestForm(form({ method: "HEAD" })).method, "HEAD");
});

test("method: anything but letters is an InputError", () => {
  for (const method of ["P0ST", "GET POST", "-X", "$M"]) {
    assert.throws(() => parseRequestForm(form({ method })), { message: ERR_METHOD }, method);
    assert.throws(() => parseRequestForm(form({ method })), InputError, method);
  }
});

test("method: a non-ASCII letter is rejected before uppercasing, not laundered into ASCII (final review 2026-09-03)", () => {
  assert.throws(() => parseRequestForm(form({ method: "ß" })), { message: ERR_METHOD });
  assert.throws(() => parseRequestForm(form({ method: "ß" })), InputError);
  assert.equal(parseRequestForm(form({ method: " patch " })).method, "PATCH");
});

// ---- Headers (decision 8) ----

test("headers: one per line, in order, duplicates kept, blanks and CRLF skipped", () => {
  const spec = parseRequestForm(form({ headers: "A: 1\r\n\r\nB: two words\nA: 2\n" }));
  assert.deepEqual(spec.headers, [["A", "1"], ["B", "two words"], ["A", "2"]]);
});

test("headers: value may contain a colon; empty value allowed; spaces around trimmed", () => {
  const spec = parseRequestForm(form({ headers: "  X-A:b:c  \nX-B:\nX-C:    v" }));
  assert.deepEqual(spec.headers, [["X-A", "b:c"], ["X-B", ""], ["X-C", "v"]]);
});

test("headers: a bad line reports its 1-based line number, counting blank lines", () => {
  assert.throws(() => parseRequestForm(form({ headers: "A: 1\n\nnot a header" })), {
    message: "Header line 3 is not in Name: value form.",
  });
  assert.throws(() => parseRequestForm(form({ headers: "A: 1\n\nnot a header" })), InputError);
  assert.throws(() => parseRequestForm(form({ headers: "X A: 1" })), {
    message: "Header line 1 is not in Name: value form.",
  });
  assert.throws(() => parseRequestForm(form({ headers: "X-A : 1" })), {
    message: "Header line 1 is not in Name: value form.",
  });
});

test("content-type: a user header of any case suppresses both the auto header and the warning", () => {
  const json = parseRequestForm(form({ body: '{"a":1}', headers: "content-type: text/plain" }));
  assert.equal(json.contentTypeAdded, false);
  assert.deepEqual(json.warnings, []);
  const raw = parseRequestForm(form({ body: "a,b", headers: "Content-Type: text/csv" }));
  assert.equal(raw.contentTypeAdded, false);
  assert.deepEqual(raw.warnings, []);
});

// ---- Auth (decision 2) ----

test("auth: blank is none", () => {
  assert.equal(parseRequestForm(form({ auth: "  " })).auth, null);
});

test("auth: a token becomes bearer; a pasted Bearer prefix is stripped once", () => {
  assert.deepEqual(parseRequestForm(form({ auth: "eyJ.x" })).auth, { kind: "bearer", token: "eyJ.x" });
  assert.deepEqual(parseRequestForm(form({ auth: "Bearer eyJ.x" })).auth, { kind: "bearer", token: "eyJ.x" });
  assert.deepEqual(parseRequestForm(form({ auth: "bearer   eyJ.x" })).auth, { kind: "bearer", token: "eyJ.x" });
  assert.deepEqual(parseRequestForm(form({ auth: "Bearer Bearer x" })).auth, { kind: "bearer", token: "Bearer x" });
  assert.deepEqual(parseRequestForm(form({ auth: "bearerish" })).auth, { kind: "bearer", token: "bearerish" });
});

test("auth: an explicit Bearer prefix wins over the colon rule (final review 2026-09-03)", () => {
  assert.deepEqual(parseRequestForm(form({ auth: "Bearer abc:def" })).auth, { kind: "bearer", token: "abc:def" });
  assert.deepEqual(parseRequestForm(form({ auth: "abc:def" })).auth, { kind: "basic", credentials: "abc:def" });
});

test("auth: a placeholder, with or without the prefix, is a bearer placeholder", () => {
  assert.deepEqual(parseRequestForm(form({ auth: "$TOKEN" })).auth, { kind: "bearer", token: "$TOKEN" });
  assert.deepEqual(parseRequestForm(form({ auth: "Bearer $TOKEN" })).auth, { kind: "bearer", token: "$TOKEN" });
});

test("auth: only the prefix is an InputError", () => {
  for (const auth of ["Bearer", "bearer ", "BEARER   "]) {
    assert.throws(() => parseRequestForm(form({ auth })), { message: ERR_AUTH_BLANK }, auth);
    assert.throws(() => parseRequestForm(form({ auth })), InputError, auth);
  }
});

test("auth: a colon means basic, whole value kept", () => {
  assert.deepEqual(parseRequestForm(form({ auth: "user:pass" })).auth, { kind: "basic", credentials: "user:pass" });
  assert.deepEqual(parseRequestForm(form({ auth: "a:b:c" })).auth, { kind: "basic", credentials: "a:b:c" });
  assert.deepEqual(parseRequestForm(form({ auth: ":PAT" })).auth, { kind: "basic", credentials: ":PAT" });
});

test("auth: given twice (field + Authorization header of any case) is an InputError", () => {
  for (const headers of ["Authorization: x", "authorization: x", "AUTHORIZATION: Basic y"]) {
    assert.throws(() => parseRequestForm(form({ auth: "t", headers })), { message: ERR_AUTH_TWICE }, headers);
    assert.throws(() => parseRequestForm(form({ auth: "t", headers })), InputError, headers);
  }
});

test("auth: an Authorization header alone is fine and kept", () => {
  const spec = parseRequestForm(form({ headers: "Authorization: Basic abc" }));
  assert.equal(spec.auth, null);
  assert.deepEqual(spec.headers, [["Authorization", "Basic abc"]]);
});

// ---- Layout (decision 9) ----

const build = (o: Partial<RequestForm>) => toCurl(parseRequestForm(form(o)));

test("layout: a bare GET is one line, no backslash", () => {
  assert.equal(build({}), "curl 'https://a.co/x'");
});

test("layout: the owner's case — url + token — is two lines", () => {
  assert.equal(
    build({ url: "https://a.co/things", auth: "eyJhbGci" }),
    "curl 'https://a.co/things' \\\n  -H 'Authorization: Bearer eyJhbGci'",
  );
});

test("layout: the spec's five-field example, pinned verbatim", () => {
  assert.equal(
    build({ url: "https://api.x.com/v1/items", method: "PATCH", auth: "$TOKEN", headers: "X-Trace: 1", body: '{"qty":2}' }),
    [
      "curl -X PATCH 'https://api.x.com/v1/items' \\",
      '  -H "Authorization: Bearer $TOKEN" \\',
      "  -H 'X-Trace: 1' \\",
      "  -H 'Content-Type: application/json' \\",
      "  -d '{\"qty\":2}'",
    ].join("\n"),
  );
});

test("layout: flag order is auth, user headers, auto content-type, body", () => {
  const out = build({ auth: "u:p", headers: "B: 2\nA: 1", body: '{"a":1}' });
  const lines = out.split("\n");
  assert.equal(lines[0], "curl 'https://a.co/x' \\");
  assert.equal(lines[1], "  -u 'u:p' \\");
  assert.equal(lines[2], "  -H 'B: 2' \\");
  assert.equal(lines[3], "  -H 'A: 1' \\");
  assert.equal(lines[4], "  -H 'Content-Type: application/json' \\");
  assert.equal(lines[5], "  -d '{\"a\":1}'");
});

test("layout: HEAD is -I, never -X HEAD", () => {
  assert.equal(build({ method: "HEAD" }), "curl -I 'https://a.co/x'");
});

test("layout: -X only when the method differs from curl's inference", () => {
  assert.equal(build({ method: "POST", body: "a=1" }).startsWith("curl 'https://a.co/x' \\"), true);
  assert.equal(build({ method: "GET", body: "a=1" }).startsWith("curl -X GET 'https://a.co/x' \\"), true);
  assert.equal(build({ method: "DELETE" }), "curl -X DELETE 'https://a.co/x'");
});

test("layout: a body beginning with @ uses --data-raw", () => {
  assert.equal(build({ body: "@file" }).split("\n")[1], "  --data-raw '@file'");
});

test("layout: an empty header value is emitted as Name: with no trailing space", () => {
  assert.equal(build({ headers: "X-A:" }).split("\n")[1], "  -H 'X-A:'");
});

test("layout: a placeholder header value is double-quoted; a placeholder url and body too", () => {
  assert.equal(build({ headers: "X-Key: $KEY" }).split("\n")[1], '  -H "X-Key: $KEY"');
  assert.equal(build({ url: "$URL" }), 'curl "$URL"');
  assert.equal(build({ body: "$BODY" }).split("\n")[1], '  -d "$BODY"');
});

test("layout: an embedded single quote in a value survives", () => {
  assert.equal(build({ headers: "X-A: it's" }).split("\n")[1], "  -H 'X-A: it'\\''s'");
});

test("layout: a multi-line JSON body is emitted verbatim inside one pair of quotes", () => {
  const body = '{\n  "a": 1\n}';
  assert.equal(build({ body }).split("\n").slice(2).join("\n"), "  -d '" + body + "'");
});

test("fence breakout: a body of three backticks is pinned as accepted output, not fixed", () => {
  assert.equal(build({ body: "```" }).split("\n")[1], "  -d '```'");
});

test("determinism: the same form twice is byte-identical", () => {
  const o = { url: "a.co", method: "put", auth: "u:p", headers: "A: 1", body: "x" };
  assert.equal(build(o), build(o));
});

// ---- methodForLog ----

test("methodForLog: the seven standard verbs pass through, anything else is custom", () => {
  for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) assert.equal(methodForLog(m), m);
  assert.equal(methodForLog("PROPFIND"), "custom");
  assert.equal(methodForLog("SECRETWORD"), "custom");
});

// ---- Round-trip pins: the shipped parser verifies the builder ----

const roundTrip = (o: Partial<RequestForm>) => {
  const spec = parseRequestForm(form(o));
  return { spec, req: parseCurl(toCurl(spec)) };
};

test("round-trip: bearer GET", () => {
  const { spec, req } = roundTrip({ url: "https://a.co/things?x=1", auth: "eyJ.abc" });
  assert.equal(req.url, spec.url);
  assert.equal(req.method, "GET");
  assert.deepEqual(req.headers, [["Authorization", "Bearer eyJ.abc"]]);
  assert.equal(req.body, null);
  assert.deepEqual(req.notTranslated, []);
});

test("round-trip: the five-field example — placeholder stays literal in the tokenizer", () => {
  const { req } = roundTrip({ url: "https://api.x.com/v1/items", method: "PATCH", auth: "$TOKEN", headers: "X-Trace: 1", body: '{"qty":2}' });
  assert.equal(req.method, "PATCH");
  assert.deepEqual(req.headers, [
    ["Authorization", "Bearer $TOKEN"],
    ["X-Trace", "1"],
    ["Content-Type", "application/json"],
  ]);
  assert.deepEqual(req.body, { kind: "json", value: { qty: 2 } });
});

test("round-trip: HEAD via -I", () => {
  const { req } = roundTrip({ method: "head" });
  assert.equal(req.method, "HEAD");
  assert.equal(req.body, null);
});

test("round-trip: basic auth becomes the base64 header curl would send", () => {
  const { req } = roundTrip({ auth: "user:p'ss" });
  assert.deepEqual(req.headers, [["Authorization", "Basic " + utf8ToBase64("user:p'ss")]]);
});

test("round-trip: raw body with no content-type is the form-urlencoded request the warning describes", () => {
  const { req } = roundTrip({ body: "a=1&b=2" });
  assert.equal(req.method, "POST");
  assert.deepEqual(req.headers, [["Content-Type", "application/x-www-form-urlencoded"]]);
  assert.deepEqual(req.body, { kind: "raw", text: "a=1&b=2" });
});

test("round-trip: a pretty-printed JSON body parses back to the same value", () => {
  const { req } = roundTrip({ body: '{\n  "a": 1,\n  "s": "it\'s"\n}' });
  assert.equal(req.method, "POST");
  assert.deepEqual(req.body, { kind: "json", value: { a: 1, s: "it's" } });
});

test("round-trip: an embedded single quote in a header value", () => {
  const { req } = roundTrip({ headers: "X-A: it's" });
  assert.deepEqual(req.headers, [["X-A", "it's"]]);
});

test("round-trip: --data-raw keeps a leading @ literal", () => {
  const { req } = roundTrip({ body: "@x" });
  assert.deepEqual(req.body, { kind: "raw", text: "@x" });
});

test("round-trip: an explicit GET with a body keeps -X GET, not the -d inference", () => {
  const { req } = roundTrip({ method: "GET", body: "a=1" });
  assert.equal(req.method, "GET");
  assert.deepEqual(req.body, { kind: "raw", text: "a=1" });
});

test("round-trip: a header with an empty value round-trips as an empty string", () => {
  const { req } = roundTrip({ headers: "X-A:" });
  assert.deepEqual(req.headers, [["X-A", ""]]);
});

test("round-trip: a body beginning with - is read back as data, not a flag", () => {
  const { req } = roundTrip({ body: "-x" });
  assert.equal(req.method, "POST");
  assert.deepEqual(req.body, { kind: "raw", text: "-x" });
});
