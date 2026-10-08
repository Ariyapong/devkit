import type { FixtureTable } from "../scan/output-scan.js";
import { utf8ToBase64Url } from "../shared/bytes.js";

const b64url = (obj: unknown) => utf8ToBase64Url(JSON.stringify(obj));
const SAMPLE_JWT = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "1" })}.c2ln`;

export const fixtures: FixtureTable = {
  // Calls utf8ToBase64 only; contains no throw statement, and utf8ToBase64
  // (TextEncoder + btoa) never throws on any string input.
  base64Encode: { returns: [["hello"]], throws: "never" },
  base64Decode: { returns: [["aGVsbG8="]], throws: [["!!!!"]] },
  // encodeURIComponent throws a URIError on a lone (unpaired) surrogate —
  // the one input it rejects — so that case is wrapped and rethrown as
  // InputError, mirroring urlDecode's existing try/catch.
  urlEncode: { returns: [["a b&c"]], throws: [["\uD800"]] },
  urlDecode: { returns: [["a%20b"]], throws: [["%"]] },
  decodeJwt: { returns: [[SAMPLE_JWT]], throws: [["a.b"]] },
  // Array.from({length}, () => globalThis.crypto.randomUUID()) — no throw
  // statement, and ToLength clamps any count (negative, NaN) to >= 0, so
  // there is no bad-input shape that reaches a throw.
  makeUuids: { returns: [[3]], throws: "never" },
  // A bad max (non-integer, <= 0, or > 2^32) throws a RangeError from
  // cryptoRandomInt, not an InputError — that is a programmer error, not bad
  // user input, so no throws case is listed (controller ruling).
  randomIndex: { returns: [[3]], throws: "never" },
  // JWT_RE.exec(text) on a string input never throws, regardless of content.
  findJwt: { returns: [["nothing to see here"], [`here: ${SAMPLE_JWT} thanks`], ["nothing", { allowUnsecured: true }]], throws: "never" },
  // Async: the scan awaits these (Task 1). Unknown algorithm is the throw path.
  hashText: { returns: [["abc", "sha256"], ["", "md5"]], throws: [["abc", "sha3"]] },
  hashBytes: { returns: [[new Uint8Array([1, 2, 3]), "sha512"]], throws: [[new Uint8Array(), "nope"]] },
  hmacText: { returns: [["abc", "k", "sha256"], ["abc", "k", "md5"]], throws: [["abc", "  ", "sha256"], ["abc", "k", "sha3"]] },
  checkHash: { returns: [["abc", "md5", "900150983cd24fb0d6963f7d28e17f72"], ["abc", "sha256", "00", "k"]], throws: [["abc", "md5", "zz"]] },
  // Pure replace() calls; no throw statement in either.
  htmlEncode: { returns: [["<a href=\"x\">&'</a>"]], throws: "never" },
  htmlDecode: { returns: [["&lt;b&gt; &amp; &#39; &#x1F600; &nosuch;"]], throws: "never" },
  // JSON.stringify never throws on a string.
  escapeJsonString: { returns: [["a\"b\\c\n"]], throws: "never" },
  unescapeJsonString: { returns: [['a\\"b'], ["plain"]], throws: [["\\q"]] },
  // A single replace(); no throw statement.
  escapeRegex: { returns: [["a.b*c"]], throws: "never" },
  // String filtering only; no throw statement.
  alphabetFor: { returns: [["hex", false], ["alphanumeric", true]], throws: "never" },
  generateTokens: { returns: [[{ type: "hex", length: 16, count: 2, unambiguous: false }]], throws: [[{ type: "hex", length: 2, count: 1, unambiguous: false }]] },
};
