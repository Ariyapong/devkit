import { test } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import { formatYamlError, lintAnalysis, lintYaml } from "./yamltools.js";
import { renderErrorDetail } from "../discord/render-error-detail.js";

test("lintAnalysis: clean map input — no findings, key-count summary", () => {
  const { findings, summary } = lintAnalysis("a: 1\nb: 2\n");
  assert.equal(findings.length, 0);
  assert.equal(summary, "object, 2 key(s)");
});

test("lintAnalysis: summary shapes", () => {
  assert.equal(lintAnalysis("- 1\n- 2\n- 3\n").summary, "array, 3 item(s)");
  assert.equal(lintAnalysis("just a string\n").summary, "scalar");
  assert.equal(lintAnalysis("---\n").summary, "empty document");
  assert.equal(lintAnalysis("a: 1\n---\nb: 2\n").summary, "2 documents");
  assert.equal(lintAnalysis("# comment only\n").summary, null);
  assert.equal(lintAnalysis("").summary, null);
});

test("lintAnalysis: duplicate key is an error naming the key", () => {
  const { findings } = lintAnalysis("port: 8080\nname: x\nport: 9090\n");
  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.ok(finding);
  assert.equal(finding.severity, "error");
  assert.equal(finding.line, 3);
  assert.equal(finding.col, 1);
  assert.equal(finding.message, 'duplicate key "port" — YAML silently keeps the last value');
  assert.equal(finding.frame, undefined);
});

test("lintAnalysis: duplicate keys caught in flow and nested maps", () => {
  const flow = lintAnalysis("f: {a: 1, a: 2}\n").findings[0];
  assert.ok(flow);
  assert.equal(flow.message, 'duplicate key "a" — YAML silently keeps the last value');
  assert.deepEqual([flow.line, flow.col], [1, 11]);
  const nested = lintAnalysis("outer:\n  k: 1\n  k: 2\n").findings[0];
  assert.ok(nested);
  assert.equal(nested.message, 'duplicate key "k" — YAML silently keeps the last value');
  assert.deepEqual([nested.line, nested.col], [3, 3]);
});

test("lintAnalysis: duplicate key names are unquoted and unescaped", () => {
  const double = lintAnalysis('"port": 1\n"port": 2\n').findings[0];
  assert.ok(double);
  assert.equal(double.message, 'duplicate key "port" — YAML silently keeps the last value');
  const single = lintAnalysis("'port': 1\n'port': 2\n").findings[0];
  assert.ok(single);
  assert.equal(single.message, 'duplicate key "port" — YAML silently keeps the last value');
  // A space used to truncate the name at the regex's first whitespace.
  const spaced = lintAnalysis('"my key": 1\n"my key": 2\n').findings[0];
  assert.ok(spaced);
  assert.equal(spaced.message, 'duplicate key "my key" — YAML silently keeps the last value');
  const escaped = lintAnalysis('"a\\"b": 1\n"a\\"b": 2\n').findings[0];
  assert.ok(escaped);
  assert.equal(escaped.message, 'duplicate key "a"b" — YAML silently keeps the last value');
  const apostrophe = lintAnalysis("'it''s': 1\n'it''s': 2\n").findings[0];
  assert.ok(apostrophe);
  assert.equal(apostrophe.message, 'duplicate key "it\'s" — YAML silently keeps the last value');
});

test("lintAnalysis: tab indentation is a friendly one-liner error", () => {
  const { findings } = lintAnalysis("a:\n\tb: 1\n");
  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.ok(finding);
  assert.equal(finding.severity, "error");
  assert.deepEqual([finding.line, finding.col], [2, 1]);
  assert.equal(finding.message, "tab used as indentation — YAML forbids tabs; use spaces");
  assert.equal(finding.frame, undefined);
});

test("lintAnalysis: syntax error keeps caret frame, strips location suffix", () => {
  const { findings } = lintAnalysis("key: value: other\n");
  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.ok(finding);
  assert.equal(finding.severity, "error");
  assert.deepEqual([finding.line, finding.col], [1, 6]);
  assert.equal(finding.message, "Nested mappings are not allowed in compact mappings");
  assert.equal(finding.frame, "key: value: other\n     ^");
});

test("lintAnalysis: multi-doc line numbers are stream-global", () => {
  const { findings, summary } = lintAnalysis("a: 1\n---\nb: 2\nb: 3\n");
  assert.equal(summary, "2 documents");
  const finding = findings[0];
  assert.ok(finding);
  assert.deepEqual([finding.line, finding.col], [4, 1]);
  assert.equal(finding.message, 'duplicate key "b" — YAML silently keeps the last value');
});

test("norway booleans: 1.1 spellings fire with the right value", () => {
  const on = lintAnalysis("push: on\n").findings[0];
  assert.ok(on);
  assert.equal(on.severity, "warn");
  assert.deepEqual([on.line, on.col], [1, 7]);
  assert.equal(on.message, 'on → boolean true in YAML 1.1 — quote it: "on"');
  const yes = lintAnalysis("a: YES\n").findings[0];
  assert.ok(yes);
  assert.equal(yes.message, 'YES → boolean true in YAML 1.1 — quote it: "YES"');
  const off = lintAnalysis("a: Off\n").findings[0];
  assert.ok(off);
  assert.equal(off.message, 'Off → boolean false in YAML 1.1 — quote it: "Off"');
});

test("norway booleans: fire in key position (the GitHub Actions on: key)", () => {
  const finding = lintAnalysis("on:\n  push: 1\n").findings[0];
  assert.ok(finding);
  assert.deepEqual([finding.line, finding.col], [1, 1]);
  assert.equal(finding.message, 'on → boolean true in YAML 1.1 — quote it: "on"');
});

test("scan rules skip quoted, block, comment, and non-1.1 spellings", () => {
  assert.equal(lintAnalysis('a: "on"\n').findings.length, 0);
  assert.equal(lintAnalysis("a: |\n  on\n").findings.length, 0);
  assert.equal(lintAnalysis("a: 1 # turn on the thing\n").findings.length, 0);
  assert.equal(lintAnalysis("a: yEs\n").findings.length, 0);
  assert.equal(lintAnalysis("a: true\n").findings.length, 0);
});

test("leading zero: octal vs zero-loss messages", () => {
  const octal = lintAnalysis("mode: 0755\n").findings[0];
  assert.ok(octal);
  assert.equal(octal.message, '0755 → octal 493 in YAML 1.1 (755 in 1.2) — quote it: "0755"');
  const loss = lintAnalysis("id: 0888\n").findings[0];
  assert.ok(loss);
  assert.equal(loss.message, '0888 → number 888 (leading zero lost) — quote it: "0888"');
  assert.equal(lintAnalysis("a: 0\n").findings.length, 0);
});

test("underscored leading zero: number in 1.1, plain string in 1.2", () => {
  const octal = lintAnalysis("mode: 0_755\n").findings[0];
  assert.ok(octal);
  assert.equal(octal.severity, "warn");
  assert.deepEqual([octal.line, octal.col], [1, 7]);
  assert.equal(octal.message, '0_755 → octal 493 in YAML 1.1 (string in 1.2) — quote it: "0_755"');
  const decimal = lintAnalysis("id: 0_888\n").findings[0];
  assert.ok(decimal);
  assert.equal(decimal.message, '0_888 → number 888 in YAML 1.1 (string in 1.2) — quote it: "0_888"');
  const negative = lintAnalysis("m: -0_755\n").findings[0];
  assert.ok(negative);
  assert.equal(
    negative.message,
    '-0_755 → octal -493 in YAML 1.1 (string in 1.2) — quote it: "-0_755"',
  );
  // 1.1 accepts underscores anywhere after the leading zero, including trailing.
  const trailing = lintAnalysis("m: 0755_\n").findings[0];
  assert.ok(trailing);
  assert.equal(trailing.message, '0755_ → octal 493 in YAML 1.1 (string in 1.2) — quote it: "0755_"');
  assert.equal(lintAnalysis("m: 0_\n").findings.length, 0); // null in 1.1 — no digit
  assert.equal(lintAnalysis("m: _0755\n").findings.length, 0); // string in both
});

test("0o prefix: the reverse trap — number in 1.2, string in 1.1", () => {
  const mode = lintAnalysis("mode: 0o755\n").findings[0];
  assert.ok(mode);
  assert.equal(mode.severity, "warn");
  assert.deepEqual([mode.line, mode.col], [1, 7]);
  assert.equal(mode.message, '0o755 → octal 493 in YAML 1.2 (string in 1.1) — quote it: "0o755"');
  // String in both versions ⇒ nothing coerces, nothing to warn about.
  assert.equal(lintAnalysis("m: -0o755\n").findings.length, 0);
  assert.equal(lintAnalysis("m: 0o8\n").findings.length, 0);
  assert.equal(lintAnalysis("m: 0o7_55\n").findings.length, 0);
});

test("trailing zero: version-string traps", () => {
  const python = lintAnalysis("python-version: 3.10\n").findings[0];
  assert.ok(python);
  assert.equal(python.message, '3.10 → number 3.1 (trailing zero lost) — quote it: "3.10"');
  const one = lintAnalysis("v: 1.0\n").findings[0];
  assert.ok(one);
  assert.equal(one.message, '1.0 → number 1 (trailing zero lost) — quote it: "1.0"');
  assert.equal(lintAnalysis("v: 3.10.1\n").findings.length, 0);
});

test("sexagesimal: 1.1 grammar exactly — later segments 0–59", () => {
  const time = lintAnalysis("time: 08:30\n").findings[0];
  assert.ok(time);
  assert.equal(time.message, '08:30 → integer 510 in YAML 1.1 — quote it: "08:30"');
  const ports = lintAnalysis("p: 8080:59\n").findings[0];
  assert.ok(ports);
  assert.equal(ports.message, '8080:59 → integer 484859 in YAML 1.1 — quote it: "8080:59"');
  const negative = lintAnalysis("t: -8:30\n").findings[0];
  assert.ok(negative);
  assert.equal(negative.message, '-8:30 → integer -510 in YAML 1.1 — quote it: "-8:30"');
  const underscore = lintAnalysis("t: 1_0:30\n").findings[0];
  assert.ok(underscore);
  assert.equal(underscore.message, '1_0:30 → integer 630 in YAML 1.1 — quote it: "1_0:30"');
  assert.equal(lintAnalysis("p: 8080:80\n").findings.length, 0);
});

test("lintYaml: warns-only report — ⚠ header, aligned columns", () => {
  assert.equal(
    lintYaml("push: on\nversion: 1.20\ntime: 08:30\n"),
    [
      "⚠ YAML parses, but 3 issue(s) found:",
      "",
      'L1:7   warn   on → boolean true in YAML 1.1 — quote it: "on"',
      'L2:10  warn   1.20 → number 1.2 (trailing zero lost) — quote it: "1.20"',
      'L3:7   warn   08:30 → integer 510 in YAML 1.1 — quote it: "08:30"',
    ].join("\n"),
  );
});

test("lintYaml: error headers count severities", () => {
  assert.equal(
    lintYaml("port: 8080\nname: x\nport: 9090\n"),
    [
      "❌ 1 error(s) found:",
      "",
      'L3:1  error  duplicate key "port" — YAML silently keeps the last value',
    ].join("\n"),
  );
  assert.ok(
    lintYaml("port: 8080\nport: 9090\nmode: 0755\n").startsWith(
      "❌ 1 error(s), 1 warning(s) found:",
    ),
  );
});

test("lintYaml: syntax-error frame is indented under its finding", () => {
  assert.equal(
    lintYaml("key: value: other\n"),
    [
      "❌ 1 error(s) found:",
      "",
      "L1:6  error  Nested mappings are not allowed in compact mappings",
      "  key: value: other",
      "       ^",
    ].join("\n"),
  );
});

test("lintYaml: clean and no-content messages", () => {
  assert.equal(lintYaml("a: 1\nb: 2\n"), "✅ YAML valid — no lint issues (object, 2 key(s))");
  assert.equal(
    lintYaml("# comment only\n"),
    "⚠ No YAML content found — input is empty or comments only.",
  );
});

test("lintYaml: caps at 15 findings and counts the rest", () => {
  const input = Array.from({ length: 16 }, (_, i) => `k${i}: on`).join("\n");
  const report = lintYaml(input);
  assert.ok(report.startsWith("⚠ YAML parses, but 16 issue(s) found:"));
  assert.equal(report.split("\n").filter((line) => line.includes("warn")).length, 15);
  assert.ok(report.endsWith("…and 1 more issue(s)"));
});

test("formatYamlError: fenced frame for YAMLParseError, null otherwise", () => {
  let thrown: unknown = null;
  try {
    YAML.parse("key: value: other\n");
  } catch (error) {
    thrown = error;
  }
  const located = formatYamlError(thrown);
  assert.ok(located);
  assert.equal(
    located.message + (located.detail ? renderErrorDetail(located.detail) : ""),
    "Invalid YAML (line 1, col 6): Nested mappings are not allowed in compact mappings\n```\nkey: value: other\n     ^\n```",
  );
  assert.equal(formatYamlError(new Error("nope")), null);
});

test("formatYamlError: multi-line frame keeps message and detail split (spec §5.5)", () => {
  let thrown: unknown = null;
  try {
    YAML.parse("a: 1\nb: [1, 2\nc: 3");
  } catch (error) {
    thrown = error;
  }
  const located = formatYamlError(thrown);
  assert.ok(located);
  assert.match(located.message, /^Invalid YAML \(line 3, col 1\):/);
  assert.ok(located.detail);
  assert.deepEqual(located.detail.lines, ["b: [1, 2", "c: 3", "^"]);
  assert.equal(located.detail.caretLine, 2);
  assert.equal(located.detail.positionLine, undefined);
});
