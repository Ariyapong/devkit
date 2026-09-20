import type { FixtureTable } from "../scan/output-scan.js";
import { MAX_NODES, MAX_DEPTH, type ShapeDiff } from "./shapetools.js";
import type { CurlRequest } from "./curltools.js";
import type { RequestSpec } from "./curl-build.js";

/** One field over MAX_NODES: trips shapeOf's/schemaOf's node-count guard. */
function wideObject(): Record<string, number> {
  const obj: Record<string, number> = {};
  for (let i = 0; i <= MAX_NODES; i++) obj[`k${i}`] = i;
  return obj;
}

/** One level over MAX_DEPTH: trips shapeOf's/schemaOf's depth guard. */
function deepObject(): unknown {
  let deep: unknown = 1;
  for (let i = 0; i <= MAX_DEPTH; i++) deep = { x: deep };
  return deep;
}

const SAMPLE_DIFF: ShapeDiff = {
  added: [{ path: "a", type: "string" }],
  removed: [{ path: "b", type: "number" }],
  changed: [{ path: "c", before: "string", after: "null" }],
  breaking: 1,
};

const SAMPLE_REQUEST: CurlRequest = {
  url: "https://a.co",
  method: "GET",
  headers: [],
  body: null,
  notTranslated: [],
};

const SAMPLE_SPEC: RequestSpec = {
  url: "https://a.co",
  method: "GET",
  emitMethodFlag: false,
  auth: null,
  headers: [],
  contentTypeAdded: false,
  body: null,
  warnings: [],
};

export const fixtures: FixtureTable = {
  // ---- shapetools ----
  shapeOf: { returns: [[{ id: 1, name: "a" }]], throws: [[wideObject()], [deepObject()]] },
  diffShapes: { returns: [[{ a: 1 }, { a: 2 }]], throws: [[wideObject(), {}]] },
  isBreakingChange: {
    returns: [[{ path: "x", before: "string", after: "number" }]],
    throws: "never",
  },
  renderShapeDiff: { returns: [[SAMPLE_DIFF]], throws: "never" },
  schemaOf: { returns: [[{ id: 7 }]], throws: [[wideObject()], [deepObject()]] },

  // ---- curltools ---- (minifyJson is module-internal — not in the index, not here)
  tokenize: { returns: [["curl -X POST https://a.co"]], throws: [["curl 'unterminated"]] },
  jsonRoundTrips: { returns: [['{"a":1}', { a: 1 }]], throws: "never" },
  hasProtoKey: { returns: [[{ a: 1 }]], throws: "never" },
  parseCurl: { returns: [["curl https://a.co"]], throws: [["curl 'unterminated"]] },
  toFetch: { returns: [[SAMPLE_REQUEST]], throws: "never" },

  // ---- curl-build ----
  parseRequestForm: {
    returns: [[{ url: "https://a.co", method: "", auth: "", headers: "", body: "" }]],
    throws: [[{ url: "", method: "GET", headers: "", auth: "", body: "" }]],
  },
  quoteArg: { returns: [["", "https://a.co/x"]], throws: "never" },
  // toCurl's own body has no throw path at all — a HEAD+body RequestSpec is
  // unreachable through parseRequestForm (ERR_HEAD_BODY), and toCurl itself
  // contains no throw statement, so it cannot throw even on a hand-built
  // invalid spec. Confirmed by reading src/api/curl-build.ts.
  toCurl: { returns: [[SAMPLE_SPEC]], throws: "never" },
  methodForLog: { returns: [["GET"], ["PROPFIND"]], throws: "never" },
};
