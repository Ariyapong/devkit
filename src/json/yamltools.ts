import { LineCounter, Scalar, YAMLParseError, isMap, isScalar, isSeq, parseAllDocuments, visit } from "yaml";
import type { Document, YAMLError } from "yaml";
import type { LocatedError } from "./json-error.js";

export type LintSeverity = "error" | "warn";

export interface LintFinding {
  line: number;
  col: number;
  severity: LintSeverity;
  message: string;
  /** Source-line + caret frame (syntax errors only); rendered indented under the finding. */
  frame?: string;
}

export interface LintAnalysis {
  /** Sorted by (line, col); line numbers are stream-global across documents. */
  findings: LintFinding[];
  /** null ⇔ the stream has no documents (empty or comments-only input). */
  summary: string | null;
}

/** Findings shown before the report truncates with "…and K more issue(s)". */
const MAX_FINDINGS = 15;

// YAML 1.1 booleans that are plain strings in 1.2 (the Norway problem).
// true/false spellings are booleans in both versions — never flagged.
const NORWAY = new Set([
  "y", "Y", "yes", "Yes", "YES", "n", "N", "no", "No", "NO",
  "on", "On", "ON", "off", "Off", "OFF",
]);
const NORWAY_TRUE = new Set(["y", "Y", "yes", "Yes", "YES", "on", "On", "ON"]);
// Leading zero: octal in YAML 1.1, decimal in 1.2.
const LEADING_ZERO = /^[-+]?0\d+$/;
// Underscored leading zero: a plain string in 1.2, but 1.1 drops the separators
// and reads a number — octal when every digit is 0–7 (0_755 → 493), decimal
// otherwise (0_888 → 888). Underscores may sit anywhere after the leading zero,
// trailing included (0755_ → 493), but a bare `0_` is null in 1.1, not a trap.
const UNDERSCORED_ZERO = /^[-+]?0(?=[\d_]*\d)[\d_]*_[\d_]*$/;
// The reverse trap: 0o755 is 493 in 1.2 but a plain string in 1.1. Signed and
// underscored forms (-0o755, 0o7_55) are strings in both versions — never fire.
const OCTAL_PREFIX = /^0o[0-7]+$/;
// Float losing its trailing zero on parse: 1.20 → 1.2, 3.10 → 3.1 (both versions).
const TRAILING_ZERO = /^[-+]?\d+\.\d*0$/;
// YAML 1.1 sexagesimal integers: 08:30 → 510. Later segments must be 0–59, so
// docker-style port maps like "8080:80" do NOT match (spike-verified).
const SEXAGESIMAL = /^[-+]?\d[\d_]*(?::[0-5]?\d)+$/;

const LOCATION_SUFFIX = / at line \d+, column \d+:?$/;

export function lintAnalysis(input: string): LintAnalysis {
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(input, { lineCounter });
  const findings: LintFinding[] = [];
  for (const doc of docs) {
    for (const err of doc.errors) findings.push(libFinding(err, doc, "error"));
    for (const warning of doc.warnings) findings.push(libFinding(warning, doc, "warn"));
    visit(doc, {
      Scalar(_key, node) {
        const finding = scanScalar(node, lineCounter);
        if (finding !== null) findings.push(finding);
      },
    });
  }
  findings.sort((a, b) => a.line - b.line || a.col - b.col);
  return { findings, summary: summarize(docs) };
}

function libFinding(err: YAMLError, doc: Document.Parsed, severity: LintSeverity): LintFinding {
  const [start] = err.linePos ?? [];
  const line = start?.line ?? 1;
  const col = start?.col ?? 1;
  if (err.code === "DUPLICATE_KEY") {
    const name = duplicateKeyName(doc, err.pos[0]);
    const key = name === undefined ? "duplicate key" : `duplicate key "${name}"`;
    return { line, col, severity, message: `${key} — YAML silently keeps the last value` };
  }
  if (err.code === "TAB_AS_INDENT") {
    return { line, col, severity, message: "tab used as indentation — YAML forbids tabs; use spaces" };
  }
  // Generic syntax error: strip the location suffix (the L{line}:{col} prefix
  // already says it) and keep the lib's source-line + caret frame.
  const [headline = err.message, ...frameParts] = err.message.split("\n\n");
  const message = headline.replace(LOCATION_SUFFIX, "").trim();
  const frame = frameParts.join("\n\n").trimEnd();
  if (severity === "error" && frame !== "") return { line, col, severity, message, frame };
  return { line, col, severity, message };
}

/**
 * Name of the duplicate key starting at `offset` (err.pos is 1 char wide, so the
 * error itself carries no name). Read off the AST rather than the source text so
 * the parser's own unquoting applies — `"my key"` and `'it''s'` report clean.
 * undefined for a collection key, which the parser never reports as duplicate.
 */
function duplicateKeyName(doc: Document.Parsed, offset: number): string | undefined {
  let name: string | undefined;
  visit(doc, {
    Pair(_key, pair) {
      const node = pair.key;
      if (isScalar(node) && node.range?.[0] === offset) name = String(node.value);
    },
  });
  return name;
}

function scanScalar(node: Scalar, lineCounter: LineCounter): LintFinding | null {
  if (node.type !== Scalar.PLAIN || node.source === undefined || node.range == null) {
    return null;
  }
  const message = trapMessage(node.source);
  if (message === null) return null;
  const { line, col } = lineCounter.linePos(node.range[0]);
  return { line, col, severity: "warn", message };
}

function trapMessage(src: string): string | null {
  if (NORWAY.has(src)) {
    return `${src} → boolean ${NORWAY_TRUE.has(src)} in YAML 1.1 — quote it: "${src}"`;
  }
  if (LEADING_ZERO.test(src)) return leadingZeroMessage(src);
  if (UNDERSCORED_ZERO.test(src)) return underscoredZeroMessage(src);
  if (OCTAL_PREFIX.test(src)) {
    const octal = parseInt(src.slice(2), 8);
    return `${src} → octal ${octal} in YAML 1.2 (string in 1.1) — quote it: "${src}"`;
  }
  if (TRAILING_ZERO.test(src)) {
    return `${src} → number ${Number(src)} (trailing zero lost) — quote it: "${src}"`;
  }
  if (SEXAGESIMAL.test(src)) {
    return `${src} → integer ${sexagesimalValue(src)} in YAML 1.1 — quote it: "${src}"`;
  }
  return null;
}

function leadingZeroMessage(src: string): string {
  const sign = src.startsWith("-") ? -1 : 1;
  const digits = src.replace(/^[-+]/, "");
  if (/^[0-7]+$/.test(digits)) {
    const octal = sign * parseInt(digits, 8);
    const decimal = sign * parseInt(digits, 10);
    return `${src} → octal ${octal} in YAML 1.1 (${decimal} in 1.2) — quote it: "${src}"`;
  }
  return `${src} → number ${sign * parseInt(digits, 10)} (leading zero lost) — quote it: "${src}"`;
}

function underscoredZeroMessage(src: string): string {
  const sign = src.startsWith("-") ? -1 : 1;
  const digits = src.replace(/^[-+]/, "").replaceAll("_", "");
  const octal = /^[0-7]+$/.test(digits);
  const value = sign * parseInt(digits, octal ? 8 : 10);
  const kind = octal ? "octal" : "number";
  return `${src} → ${kind} ${value} in YAML 1.1 (string in 1.2) — quote it: "${src}"`;
}

function sexagesimalValue(src: string): number {
  const sign = src.startsWith("-") ? -1 : 1;
  let value = 0;
  for (const part of src.replace(/^[-+]/, "").replaceAll("_", "").split(":")) {
    value = value * 60 + Number(part);
  }
  return sign * value;
}

function summarize(docs: readonly Document.Parsed[]): string | null {
  if (docs.length === 0) return null;
  if (docs.length > 1) return `${docs.length} documents`;
  const contents = docs[0]?.contents ?? null;
  if (contents === null) return "empty document";
  if (isMap(contents)) return `object, ${contents.items.length} key(s)`;
  if (isSeq(contents)) return `array, ${contents.items.length} item(s)`;
  // A bare "---" parses to a null Scalar with empty source, not null contents.
  if (isScalar(contents) && contents.value === null && !contents.source) {
    return "empty document";
  }
  return "scalar";
}

export function renderLint(analysis: LintAnalysis): string {
  const { findings, summary } = analysis;
  if (summary === null) {
    return "⚠ No YAML content found — input is empty or comments only.";
  }
  if (findings.length === 0) return `✅ YAML valid — no lint issues (${summary})`;

  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.length - errors;
  const counts = [
    errors > 0 ? `${errors} error(s)` : null,
    warns > 0 ? `${warns} warning(s)` : null,
  ].filter((part): part is string => part !== null);
  const header =
    errors > 0
      ? `❌ ${counts.join(", ")} found:`
      : `⚠ YAML parses, but ${warns} issue(s) found:`;

  const shown = findings.slice(0, MAX_FINDINGS);
  const locWidth = Math.max(...shown.map((f) => `L${f.line}:${f.col}`.length));
  const lines = [header, ""];
  for (const finding of shown) {
    const loc = `L${finding.line}:${finding.col}`.padEnd(locWidth);
    lines.push(`${loc}  ${finding.severity.padEnd(5)}  ${finding.message}`);
    if (finding.frame !== undefined) {
      for (const frameLine of finding.frame.split("\n")) lines.push(`  ${frameLine}`);
    }
  }
  if (findings.length > shown.length) {
    lines.push("", `…and ${findings.length - shown.length} more issue(s)`);
  }
  return lines.join("\n");
}

export function lintYaml(input: string): string {
  return renderLint(lintAnalysis(input));
}

/**
 * YAMLParseError → a located error: headline + optional caret frame as
 * structured `detail` (rendered into the fenced Discord shape by
 * `./discord`'s `renderErrorDetail`). Returns null for non-YAMLParseError
 * values.
 */
export function formatYamlError(error: unknown): LocatedError | null {
  if (!(error instanceof YAMLParseError)) return null;
  const [start] = error.linePos ?? [];
  const where = start === undefined ? "" : ` (line ${start.line}, col ${start.col})`;
  const [headline = error.message, ...frameParts] = error.message.split("\n\n");
  const reason = headline.replace(LOCATION_SUFFIX, "").trim();
  const frame = frameParts.join("\n\n").trimEnd();
  const message = `Invalid YAML${where}: ${reason}`;
  if (frame === "") return { message };
  const lines = frame.split("\n");
  const caretLine = lines.findLastIndex((line) => /^\s*\^+\s*$/.test(line));
  const detail: LocatedError["detail"] =
    start === undefined
      ? { kind: "excerpt", lines, caretLine }
      : { kind: "excerpt", position: { line: start.line, column: start.col }, lines, caretLine };
  return { message, detail };
}
