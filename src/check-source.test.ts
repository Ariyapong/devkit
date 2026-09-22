import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// This file is test-only: it may use node:* itself. It is skipped in the
// browserish run because the TypeScript compiler API needs `process`.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)));
const FORBIDDEN_IDENTIFIERS = new Set(["Buffer", "process", "__dirname", "require", "console"]);
/** The seven runtime dependencies of package.json — a new one is a design decision, not a convenience (design §2). */
const ALLOWED_PACKAGES = new Set(["cron-parser", "cronstrue", "diff", "luxon", "semver", "yaml", "punycode/punycode.es6.js"]);
const CLOCK_MARKER = "// clock: intentional";

type TS = typeof import("typescript");
type Node = import("typescript").Node;

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "scan") continue;
      listSources(full, out);
    } else if (
      full.endsWith(".ts") &&
      !full.endsWith(".d.ts") &&
      !full.endsWith(".test.ts") &&
      !full.endsWith("scan-fixtures.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** "json" for src/json/x.ts; "discord"; "errors" for src/errors.ts; "shared"; "root" for src/index.ts. */
function zoneOf(file: string): string {
  const rel = relative(SRC, file).split(sep);
  if (rel.length === 1) return rel[0] === "index.ts" ? "root" : rel[0] === "errors.ts" ? "errors" : "other";
  return rel[0]!;
}

function zoneOfImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null; // bare package import
  // Relative specifiers name the emitted .js; zone them by their .ts source.
  const target = resolve(dirname(fromFile), specifier.replace(/\.js$/, ".ts"));
  return zoneOf(target);
}

const DOMAINS = new Set(["json", "api", "time", "codec", "text", "debug"]);

function importAllowed(fromZone: string, toZone: string): boolean {
  if (fromZone === "errors" || fromZone === "shared") return false;
  if (fromZone === "discord") return toZone !== "root";
  if (fromZone === "root") return toZone !== "discord" && toZone !== "root";
  if (DOMAINS.has(fromZone)) return toZone === fromZone || toZone === "errors" || toZone === "shared";
  return false;
}

/**
 * Every violation in one source file, as "path:line reason" strings. `file`
 * decides the zone; it need not exist — the fixture tests below feed
 * synthetic paths with inline text, which is how the guard proves it catches
 * what it claims to.
 */
function scanSource(ts: TS, file: string, text: string): string[] {
  const violations: string[] = [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const zone = zoneOf(file);
  const where = (node: Node): string =>
    `${relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const lineText = (node: Node): string =>
    text.split("\n")[sf.getLineAndCharacterOfPosition(node.getStart(sf)).line] ?? "";
  const isGlobalThis = (node: Node): boolean => ts.isIdentifier(node) && node.text === "globalThis";

  const checkSpecifier = (node: Node, spec: string): void => {
    if (spec.startsWith("node:")) violations.push(`${where(node)} imports ${spec}`);
    if (spec === "punycode" || (spec.startsWith("punycode/") && spec !== "punycode/punycode.es6.js")) {
      violations.push(`${where(node)} imports ${spec} — only "punycode/punycode.es6.js" is allowed`);
    }
    const toZone = zoneOfImport(file, spec);
    if (toZone !== null && !importAllowed(zone, toZone)) {
      violations.push(`${where(node)} (${zone}) may not import ${spec} (${toZone})`);
    }
    if (toZone === null && spec !== "" && !spec.startsWith("node:")) {
      if (zone === "errors" || zone === "shared") {
        violations.push(`${where(node)} (${zone}) may not import packages`);
      } else if (!ALLOWED_PACKAGES.has(spec)) {
        violations.push(`${where(node)} imports ${spec} — not a declared dependency`);
      }
    }
  };

  const visit = (node: Node): void => {
    // 4.6(a) + 4.10: imports and re-exports
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      checkSpecifier(node, node.moduleSpecifier.text);
    }
    // 4.6(a) + 4.10: dynamic import("…") obeys the same specifier rules
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteral(arg)) checkSpecifier(node, arg.text);
    }
    // 4.6(a): free identifiers — and the same names reached through globalThis
    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      const p = node.parent;
      const viaGlobalThis = ts.isPropertyAccessExpression(p) && p.name === node && isGlobalThis(p.expression);
      const isPropertyName =
        ((ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodSignature(p) || ts.isMethodDeclaration(p)) && p.name === node) ||
        (ts.isBindingElement(p) && p.propertyName === node);
      const isDeclarationName = (ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isBindingElement(p)) && p.name === node;
      if (viaGlobalThis || (!isPropertyName && !isDeclarationName)) violations.push(`${where(node)} uses ${node.text}`);
    }
    if (ts.isElementAccessExpression(node) && isGlobalThis(node.expression) && ts.isStringLiteral(node.argumentExpression) && FORBIDDEN_IDENTIFIERS.has(node.argumentExpression.text)) {
      violations.push(`${where(node)} uses ${node.argumentExpression.text}`);
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined && isGlobalThis(node.initializer) && ts.isObjectBindingPattern(node.name)) {
      violations.push(`${where(node)} destructures globalThis`);
    }
    // 4.4: clocks
    const isDateNow = ts.isCallExpression(node) && node.arguments.length === 0 && node.expression.getText(sf) === "Date.now";
    const isNewDate = ts.isNewExpression(node) && (node.arguments?.length ?? 0) === 0 && node.expression.getText(sf) === "Date";
    if (isDateNow || isNewDate) {
      const p = node.parent;
      const inDefault = (ts.isParameter(p) || ts.isBindingElement(p)) && p.initializer === node;
      const inFallback = ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && p.right === node;
      if (!inDefault && !inFallback && !lineText(node).includes(CLOCK_MARKER)) {
        violations.push(`${where(node)} reads the clock outside a default (${node.getText(sf)})`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

async function loadTs(t: import("node:test").TestContext): Promise<TS | null> {
  if (typeof (globalThis as { process?: unknown }).process === "undefined") {
    t.skip("TypeScript compiler API needs process (browserish run)");
    return null;
  }
  return (await import("typescript")).default;
}

test("source rules: no node builtins, no Node globals, clocks only in defaults, import graph", async (t) => {
  const ts = await loadTs(t);
  if (ts === null) return;
  const violations: string[] = [];
  for (const file of listSources(SRC)) violations.push(...scanSource(ts, file, readFileSync(file, "utf8")));
  assert.deepEqual(violations, []);
});

// Fixture self-test: the guard must catch each class it claims to, and pass
// the allowed forms. Synthetic paths only — nothing here touches the tree.
const IN_JSON = join(SRC, "json", "fixture.ts");

test("guard fixture: the allowed forms produce no violation", async (t) => {
  const ts = await loadTs(t);
  if (ts === null) return;
  const clean = [
    'import { parse } from "yaml";',
    'import { InputError } from "../errors.js";',
    'import { helper } from "./sibling.js";',
    "export function f(nowMs = Date.now()): number { return nowMs; }",
    "export function g(opts: { nowMs?: number }): number { return opts.nowMs ?? Date.now(); }",
    "export function h(): string { return globalThis.crypto.randomUUID(); }",
    "interface Shape { process: string; Buffer: number }",
    "export const shape: Shape = { process: 'name', Buffer: 1 };",
  ].join("\n");
  assert.deepEqual(scanSource(ts, IN_JSON, clean), []);
});

test("guard fixture: node builtins, undeclared packages, and the punycode bare specifier", async (t) => {
  const ts = await loadTs(t);
  if (ts === null) return;
  const v = scanSource(
    ts,
    IN_JSON,
    ['import { readFileSync } from "node:fs";', 'import _ from "lodash";', 'import p from "punycode";', 'const d = await import("node:crypto");'].join("\n"),
  );
  assert.deepEqual(v, [
    "json/fixture.ts:1 imports node:fs",
    "json/fixture.ts:2 imports lodash — not a declared dependency",
    'json/fixture.ts:3 imports punycode — only "punycode/punycode.es6.js" is allowed',
    "json/fixture.ts:3 imports punycode — not a declared dependency",
    "json/fixture.ts:4 imports node:crypto",
  ]);
});

test("guard fixture: Node globals as free identifiers AND through globalThis", async (t) => {
  const ts = await loadTs(t);
  if (ts === null) return;
  const v = scanSource(
    ts,
    IN_JSON,
    [
      "const a = process.env;",
      "const b = globalThis.process;",
      'const c = globalThis["Buffer"];',
      "const { Buffer: B } = globalThis;",
      'console.log("x");',
      "const r = require;",
    ].join("\n"),
  );
  assert.deepEqual(v, [
    "json/fixture.ts:1 uses process",
    "json/fixture.ts:2 uses process",
    "json/fixture.ts:3 uses Buffer",
    "json/fixture.ts:4 destructures globalThis",
    "json/fixture.ts:5 uses console",
    "json/fixture.ts:6 uses require",
  ]);
});

test("guard fixture: clocks outside a default, and the import graph", async (t) => {
  const ts = await loadTs(t);
  if (ts === null) return;
  const clocks = scanSource(ts, IN_JSON, ["export function f(): number { return Date.now(); }", "export const d = new Date();", "export const marked = Date.now(); // clock: intentional"].join("\n"));
  assert.deepEqual(clocks, ["json/fixture.ts:1 reads the clock outside a default (Date.now())", "json/fixture.ts:2 reads the clock outside a default (new Date())"]);

  const crossDomain = scanSource(ts, IN_JSON, 'import { shapeOf } from "../api/shapetools.js";');
  assert.deepEqual(crossDomain, ["json/fixture.ts:1 (json) may not import ../api/shapetools.js (api)"]);

  const fromErrors = scanSource(ts, join(SRC, "errors.ts"), 'import { parse } from "yaml";');
  assert.deepEqual(fromErrors, ["errors.ts:1 (errors) may not import packages"]);

  const rootToDiscord = scanSource(ts, join(SRC, "index.ts"), 'export { renderJwt } from "./discord/index.js";');
  assert.deepEqual(rootToDiscord, ["index.ts:1 (root) may not import ./discord/index.js (discord)"]);
});
