import type { FixtureTable } from "../scan/output-scan.js";

const OBJ = '{"a": 1, "b": [1, 2]}';
const BAD = '{"a": 1';
const CSV = "a,b\n1,2\n";

export const fixtures: FixtureTable = {
  formatJson:      { returns: [[OBJ]], throws: [[BAD]] },
  minifyJson:      { returns: [[OBJ]], throws: [[BAD]] },
  validateJson:    { returns: [[OBJ], ["[]"], ["null"]], throws: [[BAD]] },
  jsonStringify:   { returns: [["any text ` with a backtick"]], throws: "never" },
  jsonParseString: { returns: [['"a\\nb"'], ['"x"', true]], throws: [["not a string literal"]] },
  jsonToTs:        { returns: [[OBJ], [OBJ, "Thing"]], throws: [[BAD]] },
  jsonToYaml:      { returns: [[OBJ]], throws: [[BAD]] },
  yamlToJson:      { returns: [["a: 1\nb: [1, 2]"]], throws: [["a: 1\nb: [1, 2\nc: 3"]] },
  locateJsonError: { returns: [[BAD, new SyntaxError("Unexpected end of JSON input")]], throws: "never" },
  lintAnalysis:    { returns: [["a: 1"], [""], ["a: [1"]], throws: "never" },
  renderLint:      { returns: [[{ findings: [], summary: "object, 1 key(s)" }], [{ findings: [], summary: null }]], throws: "never" },
  lintYaml:        { returns: [["a: 1"], ["a: [1"]], throws: "never" },
  formatYamlError: { returns: [[new Error("not a yaml error")]], throws: "never" },
  parseDsv:        { returns: [[CSV, ","]], throws: "never" },
  inferValue:      { returns: [[{ text: "12", quoted: false }]], throws: "never" },
  csvToJson:       { returns: [[CSV, ","]], throws: [["", ","]] },
  jsonToCsv:       { returns: [['[{"a":1}]', ","]], throws: [[BAD, ","], ["[]", ","]] },
  toRows:          { returns: [['[{"a":1}]']], throws: [[BAD], ["[]"]] },
  validateJsonl:   { returns: [['{"a":1}\n{"b":2}'], ['{"a":1}\nnope']], throws: "never" },
  queryToJson:     { returns: [["a=1&b=2"]], throws: "never" },
  jsonToTable:     { returns: [['[{"a":1,"b":"x"}]']], throws: [[BAD]] },
  cellDisplay:     { returns: [["x"], [null], [{ k: 1 }]], throws: "never" },
  graphemeLength:  { returns: [["สวัสดี"]], throws: "never" },
  truncateGraphemes: { returns: [["abcdef", 3]], throws: "never" },
};
