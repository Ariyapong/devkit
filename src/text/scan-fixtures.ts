import type { FixtureTable } from "../scan/output-scan.js";
import { UNICODE_MAX_CODEPOINTS } from "./unicodetools.js";
import { MAX_COUNT_CHARS } from "./counttools.js";

export const fixtures: FixtureTable = {
  // ---- semvertools ----
  checkRange: { returns: [["^1.0.0", "1.2.3"]], throws: [["nope", "1.0.0"]] },
  compareVersions: { returns: [["1.0.0", "1.0.1"]], throws: [["x", "1.0.0"]] },
  // No throw statement in renderCompare — plain string formatting only.
  renderCompare: { returns: [[{ a: "1.0.0", b: "1.0.1", order: -1, diff: "patch" }]], throws: "never" },

  // ---- unittools ---- (convert throws on an unknown category/unit/non-finite
  // value; renderConversion calls convert first, so it inherits the same throws)
  convert: { returns: [["length", "m", "km", 1000]], throws: [["nope", "m", "km", 1]] },
  formatNumber: { returns: [[1234.5]], throws: [[Infinity]] },
  renderConversion: { returns: [["length", "m", "km", 1000]], throws: [["nope", "m", "km", 1]] },

  // ---- urltools ---- (returns null on bad input; never throws — confirmed
  // by reading parseUrl, which only ever returns UrlParts | null)
  parseUrl: { returns: [["https://a.example/x"]], throws: "never" },

  // ---- casetools ---- (tokenizeWords throws when no word-like run survives
  // separator-splitting, e.g. "" or "---"; convertCase/allCases call
  // tokenizeWords internally and inherit the same throw — confirmed by
  // reading casetools.ts and by the existing "nothing to convert" test)
  convertCase: { returns: [["fooBar", "snake"]], throws: [["", "snake"]] },
  allCases: { returns: [["fooBar"]], throws: [[""]] },
  tokenizeWords: { returns: [["fooBar"]], throws: [[""]] },

  // ---- counttools ----
  countText: { returns: [["hello world"]], throws: [["x".repeat(MAX_COUNT_CHARS + 1)]] },
  // No throw statement in renderCount — plain aligned-text formatting only.
  renderCount: {
    returns: [
      [
        {
          graphemes: 2,
          graphemesNoSpace: 2,
          words: 2,
          lines: 1,
          sentences: 1,
          codepoints: 2,
          utf16units: 2,
          utf8bytes: 2,
          readingSeconds: 1,
        },
      ],
    ],
    throws: "never",
  },

  // ---- unicodetools ----
  inspectUnicode: { returns: [["hi"]], throws: [["x".repeat(UNICODE_MAX_CODEPOINTS + 1)]] },
  // No throw statement in renderInspection — plain table formatting only.
  renderInspection: {
    returns: [
      [
        {
          summary: {
            graphemes: 1,
            codepoints: 1,
            utf16units: 1,
            utf8bytes: 1,
            isNFC: true,
            normalizedApplied: null,
          },
          rows: [
            {
              hex: "U+0041",
              glyph: "A",
              category: "Lu",
              jsEscape: "\\u0041",
              xEscape: "\\x41",
              htmlEntity: "&#x41;",
              utf8: "41",
              illFormed: false,
            },
          ],
        },
      ],
    ],
    throws: "never",
  },
  // No throw statement in generalCategory — always resolves to a category, "Cn" at worst.
  generalCategory: { returns: [[0x41]], throws: "never" },

  // ---- numbase ----
  parseToBigInt: { returns: [["ff", "hex"]], throws: [["zz", "hex"]] },
  // No throw statement in formatBases — bigint formatting only, never fails.
  formatBases: { returns: [[255n]], throws: "never" },

  // ---- diff ----
  // No throw statement in diffTexts — createTwoFilesPatch never throws on plain strings.
  diffTexts: { returns: [["line1\nline2", "line1\nline2 changed"]], throws: "never" },
};
