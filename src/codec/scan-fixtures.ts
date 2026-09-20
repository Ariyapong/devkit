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
  findJwt: { returns: [["nothing to see here"], [`here: ${SAMPLE_JWT} thanks`]], throws: "never" },
};
