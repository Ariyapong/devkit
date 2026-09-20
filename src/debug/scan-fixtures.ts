import type { FixtureTable } from "../scan/output-scan.js";

const JS_TRACE = [
  "TypeError: Cannot read properties of undefined (reading 'name')",
  "    at getUser (/app/src/routes/user.ts:42:17)",
  "    at async run (/app/src/server.ts:12:3)",
].join("\n");

export const fixtures: FixtureTable = {
  // No throw statement in stack-parse.ts — a non-trace input (too few
  // frames, no recognizable language) returns null rather than throwing.
  parseStackTrace: { returns: [[JS_TRACE], ["plain prose"]], throws: "never" },
  // No throw statement in errcodes.ts — an unrecognized code/token set
  // returns null / an empty array rather than throwing.
  lookupErrCode: { returns: [["ECONNREFUSED"], ["nope"]], throws: "never" },
  scanErrTokens: { returns: [["connect ECONNREFUSED 127.0.0.1:5432"], ["nothing here"]], throws: "never" },
  allErrCodes: { returns: [[]], throws: "never" },
  // No throw statement in ansitools.ts — any string, ANSI or not, is
  // returned as-is (or with escapes stripped).
  stripAnsi: { returns: [["\u001b[31mred\u001b[0m"], ["plain text"]], throws: "never" },
  // No throw statement in http-status.ts — an unknown code returns null
  // rather than throwing.
  httpStatus: { returns: [[404], [999]], throws: "never" },
};
