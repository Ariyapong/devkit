import type { FixtureTable } from "../scan/output-scan.js";
import { parseColor } from "./colortools.js";

const RED = parseColor("#ff0000");
const WHITE = parseColor("#ffffff");

export const fixtures: FixtureTable = {
  parseColor: { returns: [["#ff0000"], ["coral"], ["rgb(1, 2, 3)"], ["hsl(10, 20%, 30%)"]], throws: [["bluish"], ["rgb(999, 0, 0)"]] },
  // Pure arithmetic over numbers; no throw statement.
  hslToRgb: { returns: [[0, 100, 50]], throws: "never" },
  relatedColors: { returns: [[RED]], throws: "never" },
  searchColors: { returns: [["cor"], ["#fff"], [""]], throws: "never" },
  relativeLuminance: { returns: [[255, 0, 0]], throws: "never" },
  contrastRatio: { returns: [[RED, WHITE]], throws: "never" },
  wcagVerdicts: { returns: [[4.5]], throws: "never" },
  // Ends in `throw new Error("unreachable: …")` behind a loop that always
  // returns: black or white passes 4.5:1 against any background, and
  // hslToRgb reaches both at l = 0 and l = 100. Programmer-error guard, not
  // bad input — same ruling as randomIndex's RangeError.
  nearestAaPass: { returns: [[RED, WHITE]], throws: "never" },
};
