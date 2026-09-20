import assert from "node:assert/strict";
import { test } from "node:test";
import { InputError } from "../errors.js";
import {
  hasProtoKey,
  jsonRoundTrips,
  minifyJson,
  parseCurl,
  toFetch,
  tokenize,
} from "./curltools.js";

test("tokenize splits on unquoted whitespace", () => {
  assert.deepEqual(tokenize("curl -X POST https://a.co"), [
    "curl",
    "-X",
    "POST",
    "https://a.co",
  ]);
});

test("tokenize keeps single-quoted spaces in one token", () => {
  assert.deepEqual(tokenize("-H 'A: b c'"), ["-H", "A: b c"]);
});

test("tokenize treats backslashes inside single quotes literally", () => {
  assert.deepEqual(tokenize("-d '{\"a\":\"b\\\\c\"}'"), ["-d", '{"a":"b\\\\c"}']);
});

test("tokenize honours escapes inside double quotes", () => {
  assert.deepEqual(tokenize('-d "say \\"hi\\""'), ["-d", 'say "hi"']);
});

test("tokenize joins backslash-newline continuations", () => {
  assert.deepEqual(tokenize("curl -s \\\n  https://a.co"), [
    "curl",
    "-s",
    "https://a.co",
  ]);
});

test("tokenize splits on a bare newline", () => {
  assert.deepEqual(tokenize("curl\nhttps://a.co"), ["curl", "https://a.co"]);
});

test("tokenize keeps an empty quoted token", () => {
  assert.deepEqual(tokenize("-d ''"), ["-d", ""]);
});

test("tokenize rejects an unterminated single quote", () => {
  assert.throws(() => tokenize("-H 'A: b"), InputError);
});

test("tokenize rejects an unterminated double quote", () => {
  assert.throws(() => tokenize('-H "A: b'), InputError);
});

test("minifyJson strips whitespace outside strings", () => {
  assert.equal(minifyJson('{ "a" : 1 , "b" : [ 2 ] }'), '{"a":1,"b":[2]}');
});

test("minifyJson preserves whitespace inside strings", () => {
  assert.equal(minifyJson('{ "a" : "x  y" }'), '{"a":"x  y"}');
});

test("minifyJson does not end a string on an escaped quote", () => {
  assert.equal(minifyJson('{"a":"x\\"  y"}'), '{"a":"x\\"  y"}');
});

test("minifyJson ends a string after an escaped backslash", () => {
  assert.equal(minifyJson('{"a":"x\\\\" , "b":1}'), '{"a":"x\\\\","b":1}');
});

test("jsonRoundTrips accepts an ordinary payload", () => {
  const raw = '{"name":"widget","qty":2}';
  assert.equal(jsonRoundTrips(raw, JSON.parse(raw)), true);
});

test("jsonRoundTrips accepts a spaced payload", () => {
  const raw = '{ "a": 1 }';
  assert.equal(jsonRoundTrips(raw, JSON.parse(raw)), true);
});

test("jsonRoundTrips rejects precision loss above 2^53", () => {
  const raw = '{"id":12345678901234567890}';
  assert.equal(jsonRoundTrips(raw, JSON.parse(raw)), false);
});

test("jsonRoundTrips rejects an overflowing exponent", () => {
  const raw = '{"x":1e400}';
  assert.equal(jsonRoundTrips(raw, JSON.parse(raw)), false);
});

test("jsonRoundTrips rejects duplicate keys", () => {
  const raw = '{"a":1,"a":2}';
  assert.equal(jsonRoundTrips(raw, JSON.parse(raw)), false);
});

test("jsonRoundTrips rejects reordered integer-like keys", () => {
  const raw = '{"2":"b","1":"a"}';
  assert.equal(jsonRoundTrips(raw, JSON.parse(raw)), false);
});

test("jsonRoundTrips rejects negative zero", () => {
  const raw = '{"x":-0}';
  assert.equal(jsonRoundTrips(raw, JSON.parse(raw)), false);
});

test("jsonRoundTrips accepts a 16-digit snowflake string", () => {
  const raw = '{"id":"1234567890123456"}';
  assert.equal(jsonRoundTrips(raw, JSON.parse(raw)), true);
});

test("hasProtoKey finds a nested __proto__ key", () => {
  assert.equal(hasProtoKey(JSON.parse('{"a":{"__proto__":{"b":1}}}')), true);
});

test("hasProtoKey finds __proto__ inside an array element", () => {
  assert.equal(hasProtoKey(JSON.parse('[{"__proto__":1}]')), true);
});

test("hasProtoKey is false for ordinary payloads", () => {
  assert.equal(hasProtoKey(JSON.parse('{"a":[1,{"b":2}]}')), false);
});

test("parseCurl reads a bare url and defaults to GET", () => {
  const req = parseCurl("curl https://api.x.com/v1/items");
  assert.equal(req.url, "https://api.x.com/v1/items");
  assert.equal(req.method, "GET");
  assert.deepEqual(req.headers, []);
});

test("parseCurl works without the leading curl token", () => {
  assert.equal(parseCurl("https://a.co").url, "https://a.co");
});

test("parseCurl accepts --url", () => {
  assert.equal(parseCurl("curl --url https://a.co").url, "https://a.co");
});

test("parseCurl takes the url after flags", () => {
  assert.equal(parseCurl("curl -s -H 'A: b' https://a.co").url, "https://a.co");
});

test("parseCurl honours -X", () => {
  assert.equal(parseCurl("curl -X DELETE https://a.co").method, "DELETE");
});

test("parseCurl accepts an attached short value", () => {
  assert.equal(parseCurl("curl -XPUT https://a.co").method, "PUT");
});

test("parseCurl maps -I to HEAD", () => {
  assert.equal(parseCurl("curl -I https://a.co").method, "HEAD");
});

test("parseCurl collects headers in order, duplicates kept", () => {
  const req = parseCurl("curl -H 'A: 1' -H 'A: 2' -H 'B: 3' https://a.co");
  assert.deepEqual(req.headers, [
    ["A", "1"],
    ["A", "2"],
    ["B", "3"],
  ]);
});

test("parseCurl keeps a colon inside a header value", () => {
  assert.deepEqual(parseCurl("curl -H 'X: a:b' https://a.co").headers, [
    ["X", "a:b"],
  ]);
});

test("parseCurl keeps an empty header value", () => {
  assert.deepEqual(parseCurl("curl -H 'X:' https://a.co").headers, [["X", ""]]);
});

test("parseCurl keeps __proto__ as an ordinary header name", () => {
  assert.deepEqual(parseCurl("curl -H '__proto__: x' https://a.co").headers, [
    ["__proto__", "x"],
  ]);
});

test("parseCurl drops a header whose name is empty (flag with no value)", () => {
  // -H as the final token: no following token to serve as its value, so the
  // split produces an empty name — must not become headers: {"": ""}.
  assert.deepEqual(parseCurl("curl https://a.co -H").headers, []);
});

test("parseCurl maps -u to basic auth", () => {
  assert.deepEqual(parseCurl("curl -u user:pass https://a.co").headers, [
    ["Authorization", "Basic dXNlcjpwYXNz"],
  ]);
});

test("parseCurl maps -b, -A and -e to headers", () => {
  const req = parseCurl("curl -b 'a=1' -A 'bot/1' -e 'https://ref' https://a.co");
  assert.deepEqual(req.headers, [
    ["Cookie", "a=1"],
    ["User-Agent", "bot/1"],
    ["Referer", "https://ref"],
  ]);
});

test("parseCurl prepends http:// to a scheme-less url and says so", () => {
  const req = parseCurl("curl api.x.com/v1");
  assert.equal(req.url, "http://api.x.com/v1");
  assert.deepEqual(req.notTranslated, [
    "scheme-less url (curl defaults to http://)",
  ]);
});

test("parseCurl ignores a non-url bare token from an unknown flag", () => {
  const req = parseCurl("curl --frobnicate foo.txt https://a.co");
  assert.equal(req.url, "https://a.co");
});

test("parseCurl notes a second url", () => {
  const req = parseCurl("curl https://a.co https://b.co");
  assert.equal(req.url, "https://a.co");
  assert.ok(req.notTranslated.includes("multiple urls (only the first is converted)"));
});

test("parseCurl notes a second url even when the first came from --url", () => {
  // --url bypassed the multiple-url note: explicitUrl short-circuited the
  // `pool.length > 1` check, since a bare second candidate alone never grows
  // past length 1.
  const req = parseCurl("curl --url https://a.co https://b.co");
  assert.equal(req.url, "https://a.co");
  assert.ok(req.notTranslated.includes("multiple urls (only the first is converted)"));
});

test("--url plus an unknown flag's url-shaped value is not a second url", () => {
  // The multiple-url note must not fire on a value we only suspect is a url:
  // `candidates` collects url-shaped values of flags we cannot know, and with
  // --url present there is no bare url to outrank them.
  const req = parseCurl("curl --url https://a.co --frobnicate foo.txt");
  assert.equal(req.url, "https://a.co");
  assert.ok(
    !req.notTranslated.includes("multiple urls (only the first is converted)"),
  );
});

test("parseCurl rejects a blank command", () => {
  assert.throws(() => parseCurl("   "), InputError);
});

test("parseCurl rejects a command with no url", () => {
  assert.throws(() => parseCurl("curl -X POST"), InputError);
});

test("parseCurl implies POST when a body is present", () => {
  const req = parseCurl("curl -d 'a=1' https://a.co");
  assert.equal(req.method, "POST");
  assert.deepEqual(req.body, { kind: "raw", text: "a=1" });
});

test("parseCurl lets -X override the implied POST", () => {
  assert.equal(parseCurl("curl -X PATCH -d 'a=1' https://a.co").method, "PATCH");
});

test("parseCurl joins repeated -d with an ampersand", () => {
  const req = parseCurl("curl -d 'a=1' -d 'b=2' https://a.co");
  assert.deepEqual(req.body, { kind: "raw", text: "a=1&b=2" });
});

test("parseCurl parses a json body into the object form", () => {
  const req = parseCurl(`curl -d '{"name":"widget","qty":2}' https://a.co`);
  assert.deepEqual(req.body, {
    kind: "json",
    value: { name: "widget", qty: 2 },
  });
});

test("parseCurl keeps a lossy json body verbatim", () => {
  const raw = '{"id":12345678901234567890}';
  const req = parseCurl(`curl -d '${raw}' https://a.co`);
  assert.deepEqual(req.body, { kind: "raw", text: raw });
});

test("parseCurl keeps a __proto__ body verbatim", () => {
  const raw = '{"__proto__":{"a":1}}';
  const req = parseCurl(`curl -d '${raw}' https://a.co`);
  assert.deepEqual(req.body, { kind: "raw", text: raw });
});

test("parseCurl keeps a scalar json body raw", () => {
  const req = parseCurl("curl -d '2' https://a.co");
  assert.deepEqual(req.body, { kind: "raw", text: "2" });
});

test("parseCurl accepts a spaced json body as the object form", () => {
  const req = parseCurl(`curl -d '{ "a": 1 }' https://a.co`);
  assert.deepEqual(req.body, { kind: "json", value: { a: 1 } });
});

test("parseCurl warns on -d @file and sends no body", () => {
  const req = parseCurl("curl -d @payload.json https://a.co");
  assert.equal(req.body, null);
  assert.ok(req.notTranslated.includes("-d @file (file body unavailable)"));
});

test("parseCurl treats --data-raw @x as literal text", () => {
  const req = parseCurl("curl --data-raw @x https://a.co");
  assert.deepEqual(req.body, { kind: "raw", text: "@x" });
});

test("parseCurl handles --json", () => {
  const req = parseCurl(`curl --json '{"a":1}' https://a.co`);
  assert.equal(req.method, "POST");
  assert.deepEqual(req.body, { kind: "json", value: { a: 1 } });
  assert.deepEqual(req.headers, [
    ["Content-Type", "application/json"],
    ["Accept", "application/json"],
  ]);
});

test("--json does not duplicate a header the user already set", () => {
  const req = parseCurl(
    `curl -H 'Content-Type: application/vnd+json' --json '{"a":1}' https://a.co`,
  );
  assert.deepEqual(req.headers, [
    ["Content-Type", "application/vnd+json"],
    ["Accept", "application/json"],
  ]);
});

test("--json @file is file-aware: no literal-string body, just a note", () => {
  const req = parseCurl("curl --json @payload.json https://a.co");
  assert.equal(req.body, null);
  assert.ok(req.notTranslated.includes("--json @file (file body unavailable)"));
  // curl still sets these headers regardless of the file being unavailable.
  assert.deepEqual(req.headers, [
    ["Content-Type", "application/json"],
    ["Accept", "application/json"],
  ]);
});

test("parseCurl moves -G data into the query string", () => {
  const req = parseCurl("curl -G -d 'a=1' -d 'b=2' https://x.co/s");
  assert.equal(req.url, "https://x.co/s?a=1&b=2");
  assert.equal(req.method, "GET");
  assert.equal(req.body, null);
});

test("parseCurl appends -G data to an existing query", () => {
  const req = parseCurl("curl -G -d 'b=2' https://x.co/s?a=1");
  assert.equal(req.url, "https://x.co/s?a=1&b=2");
});

test("-G keeps an explicit -X method while still moving the data", () => {
  const req = parseCurl("curl -X POST -G -d 'a=1' https://x.co/s");
  assert.equal(req.method, "POST");
  assert.equal(req.url, "https://x.co/s?a=1");
  assert.equal(req.body, null);
});

test("-d implies application/x-www-form-urlencoded when no Content-Type is set", () => {
  const req = parseCurl("curl -d 'a=1&b=2' https://x/f");
  assert.deepEqual(req.headers, [
    ["Content-Type", "application/x-www-form-urlencoded"],
  ]);
});

test("an explicit -H Content-Type wins over the -d default", () => {
  const req = parseCurl(
    "curl -H 'Content-Type: text/plain' -d 'a=1' https://x/f",
  );
  assert.deepEqual(req.headers, [["Content-Type", "text/plain"]]);
});

test("--json's own Content-Type is not doubled by the -d default", () => {
  const req = parseCurl(`curl --json '{"a":1}' https://a.co`);
  assert.deepEqual(req.headers, [
    ["Content-Type", "application/json"],
    ["Accept", "application/json"],
  ]);
});

test("no body means no implicit Content-Type", () => {
  assert.deepEqual(parseCurl("curl https://a.co").headers, []);
});

test("-G moving data to the query leaves no body, so no implicit Content-Type", () => {
  const req = parseCurl("curl -G -d 'a=1' https://x.co/s");
  assert.equal(req.body, null);
  assert.deepEqual(req.headers, []);
});

test("a body on GET/HEAD is noted, not silently emitted", () => {
  // The Elasticsearch idiom: fetch throws TypeError for GET/HEAD with a body,
  // while curl sends it happily. The tool must name the gap, not hide it.
  const req = parseCurl(`curl -X GET -d '{"q":1}' https://es/_search`);
  assert.equal(req.method, "GET");
  assert.ok(req.body !== null);
  assert.ok(req.notTranslated.includes("a body on GET/HEAD (fetch forbids it)"));
});

test("a body on -I/HEAD is noted the same way", () => {
  const req = parseCurl("curl -I -d 'a=1' https://a.co");
  assert.equal(req.method, "HEAD");
  assert.ok(req.notTranslated.includes("a body on GET/HEAD (fetch forbids it)"));
});

test("the body is still emitted on GET despite the warning", () => {
  const out = toFetch(parseCurl(`curl -X GET -d '{"q":1}' https://es/_search`));
  assert.ok(out.includes("body: JSON.stringify("));
});

test("tier-2 flags produce no warnings", () => {
  const req = parseCurl(
    "curl -s -v -i -f -L --compressed -# --progress-bar -o out.txt https://a.co",
  );
  assert.deepEqual(req.notTranslated, []);
  assert.equal(req.url, "https://a.co");
});

test("-o consumes its value so the filename is not the url", () => {
  // Deliberately scheme-less: with a scheme present the preference rule would
  // mask a failure to consume the value, and this must test the consumption.
  assert.equal(parseCurl("curl -o report.json api.x.com").url, "http://api.x.com");
});

test("tier-3 flags are named", () => {
  const req = parseCurl("curl -F 'a=@x' -k https://a.co");
  assert.deepEqual(req.notTranslated, [
    "-F/--form (multipart body omitted)",
    "-k/--insecure (fetch cannot skip certificate checks)",
  ]);
});

test("tier-3 flags with values do not swallow the url", () => {
  assert.equal(
    parseCurl("curl --proxy http://p:8080 https://a.co").url,
    "https://a.co",
  );
});

test("an attached tier-2 value flag (-oout.txt) produces no warnings", () => {
  // Before the fix, the attached-value split only consulted VALUE_FLAGS, so
  // -o (an IGNORED_WITH_VALUE flag) survived whole and fell through to the
  // per-letter unknown-flag loop, fabricating warnings including a false
  // --proxy note from the 'x' in ".txt".
  const req = parseCurl("curl -oout.txt https://a.co");
  assert.deepEqual(req.notTranslated, []);
  assert.equal(req.url, "https://a.co");
});

test("an attached tier-2 timeout flag (-m30) produces no warnings", () => {
  const req = parseCurl("curl -m30 https://a.co");
  assert.deepEqual(req.notTranslated, []);
});

test("an attached tier-3 value flag (-xhttp://proxy:8080) is named once, correctly", () => {
  const req = parseCurl("curl -xhttp://proxy:8080 https://a.co");
  assert.deepEqual(req.notTranslated, ["--proxy (no fetch equivalent)"]);
  assert.equal(req.url, "https://a.co");
});

test("an unknown long flag is named by its own spelling", () => {
  const req = parseCurl("curl --frobnicate https://a.co");
  assert.deepEqual(req.notTranslated, ["--frobnicate (not translated)"]);
});

test("an unknown short cluster is reported per letter", () => {
  const req = parseCurl("curl -sZQ https://a.co");
  assert.deepEqual(req.notTranslated, [
    "-Q (not translated)",
    "-Z (not translated)",
  ]);
});

test("warnings are deduped and sorted", () => {
  const req = parseCurl("curl -k -F 'a=1' -k https://a.co");
  assert.deepEqual(req.notTranslated, [
    "-F/--form (multipart body omitted)",
    "-k/--insecure (fetch cannot skip certificate checks)",
  ]);
});

test("-L present and absent both leave no redirect trace", () => {
  // Pinned deviation: curl does not follow redirects without -L, fetch always
  // does. Reproducing it would mean redirect:"manual" on nearly every snippet.
  assert.deepEqual(parseCurl("curl -L https://a.co").notTranslated, []);
  assert.deepEqual(parseCurl("curl https://a.co").notTranslated, []);
});

test("a cluster does not swallow a value-taking letter's value", () => {
  const req = parseCurl("curl -sX POST https://a.co");
  assert.equal(req.method, "POST");
  assert.deepEqual(req.notTranslated, []);
});

test("a cluster does not let an ignored value flag steal the url", () => {
  assert.equal(parseCurl("curl -so out.txt api.x.com").url, "http://api.x.com");
});

test("a cluster keeps an attached value on the value-taking letter", () => {
  assert.equal(parseCurl("curl -sXPOST https://a.co").method, "POST");
});

test("toFetch emits a bare GET", () => {
  assert.equal(
    toFetch(parseCurl("curl https://a.co")),
    'await fetch("https://a.co", {\n  method: "GET",\n});',
  );
});

test("toFetch emits headers and a json body", () => {
  const req = parseCurl(
    `curl -X POST https://api.x.com/v1/items -H 'Authorization: Bearer sk' ` +
      `-H 'Content-Type: application/json' -d '{"name":"widget","qty":2}'`,
  );
  assert.equal(
    toFetch(req),
    [
      'await fetch("https://api.x.com/v1/items", {',
      '  method: "POST",',
      "  headers: {",
      '    "Authorization": "Bearer sk",',
      '    "Content-Type": "application/json",',
      "  },",
      "  body: JSON.stringify({",
      '    name: "widget",',
      "    qty: 2,",
      "  }),",
      "});",
    ].join("\n"),
  );
});

test("toFetch emits a raw body as a string literal", () => {
  const req = parseCurl("curl -d 'a=1&b=2' https://a.co");
  assert.ok(req && toFetch(req).includes('body: "a=1&b=2",'));
});

test("toFetch uses the pair-array form for duplicate header names", () => {
  const out = toFetch(parseCurl("curl -H 'A: 1' -H 'A: 2' https://a.co"));
  assert.ok(out.includes('headers: [["A", "1"], ["A", "2"]],'));
});

test("toFetch uses the pair-array form for a __proto__ header", () => {
  const out = toFetch(parseCurl("curl -H '__proto__: x' https://a.co"));
  assert.ok(out.includes('headers: [["__proto__", "x"]],'));
});

test("toFetch quotes a non-identifier key", () => {
  const out = toFetch(parseCurl(`curl -d '{"a-b":1}' https://a.co`));
  assert.ok(out.includes('"a-b": 1,'));
});

test("toFetch escapes quotes, backslashes and newlines", () => {
  const out = toFetch(parseCurl(`curl -H 'X: a"b\\c' https://a.co`));
  assert.ok(out.includes('"X": "a\\"b\\\\c",'));
});

test("toFetch puts warnings above the call as comments", () => {
  const out = toFetch(parseCurl("curl -k https://a.co"));
  assert.equal(
    out.split("\n")[0],
    "// ⚠ not translated: -k/--insecure (fetch cannot skip certificate checks)",
  );
  assert.ok(out.includes("await fetch("));
});

test("toFetch escapes a lone surrogate in a header value", () => {
  // A lone surrogate has no valid UTF-8/16 encoding on its own; left raw it
  // round-trips as U+FFFD, sending different bytes than the pasted snippet.
  const lone = "\uD800";
  const out = toFetch(parseCurl(`curl -H 'X: a${lone}b' https://a.co`));
  assert.ok(out.includes('"X": "a\\ud800b"'));
});

test("toFetch escapes a lone surrogate in a raw body", () => {
  const lone = "\uD800";
  const out = toFetch(parseCurl(`curl -d 'a${lone}b' https://a.co`));
  assert.ok(out.includes('body: "a\\ud800b"'));
});

test("toFetch passes a backtick through unescaped", () => {
  // Accepted ugly-never-unsafe: a backtick can break the reply's code fence.
  // Pinned so the 2026-08-09 widen-the-fence revert is not re-litigated here,
  // and so nobody "fixes" it with a U+200B that breaks the copy-paste.
  const out = toFetch(parseCurl("curl -H 'X: a`b' https://a.co"));
  assert.ok(out.includes('"X": "a`b",'));
});

test("toFetch is deterministic", () => {
  const input = `curl -X POST -H 'A: 1' -d '{"b":[1,2]}' https://a.co`;
  assert.equal(toFetch(parseCurl(input)), toFetch(parseCurl(input)));
});

test("toFetch renders nested arrays and objects", () => {
  const out = toFetch(parseCurl(`curl -d '{"a":[1,{"b":null}]}' https://a.co`));
  assert.ok(out.includes("a: ["));
  assert.ok(out.includes("b: null,"));
});

test("a body nested past the depth cap falls back to the verbatim literal", () => {
  const deep = "[".repeat(500) + "]".repeat(500);
  const req = parseCurl(`curl -d '${deep}' https://a.co`);
  assert.deepEqual(req.body, { kind: "raw", text: deep });
});

test("toFetch does not throw on a deeply nested body", () => {
  const deep = "[".repeat(1500) + "]".repeat(1500);
  const req = parseCurl(`curl -d '${deep}' https://a.co`);
  assert.doesNotThrow(() => toFetch(req));
});

test("the depth cap does not fire on ordinary nesting", () => {
  const req = parseCurl(`curl -d '{"a":{"b":{"c":[1,2]}}}' https://a.co`);
  assert.equal(req.body?.kind, "json");
});
