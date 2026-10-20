import type { FixtureTable } from "../scan/output-scan.js";

export const fixtures: FixtureTable = {
  // Returns null for anything it cannot read, by design; it has no throw statement.
  parseCookieDate: { returns: [["Wed, 21 Oct 2026 07:28:00 GMT"], ["nope"]], throws: "never" },
};
