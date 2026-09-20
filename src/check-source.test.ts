import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// This file is test-only: it may use node:* itself. It is skipped in the
// browserish run because the TypeScript compiler API needs `process`.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)));
const FORBIDDEN_IDENTIFIERS = new Set(["Buffer", "process", "__dirname", "require"]);
const CLOCK_MARKER = "// clock: intentional";

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
  const target = resolve(dirname(fromFile), specifier);
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

test("source rules: no node builtins, no Node globals, clocks only in defaults, import graph", async (t) => {
  if (typeof (globalThis as { process?: unknown }).process === "undefined") {
    return t.skip("TypeScript compiler API needs process (browserish run)");
  }
  const ts = (await import("typescript")).default;
  const violations: string[] = [];

  for (const file of listSources(SRC)) {
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const zone = zoneOf(file);
    const where = (node: import("typescript").Node): string =>
      `${relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
    const lineText = (node: import("typescript").Node): string =>
      text.split("\n")[sf.getLineAndCharacterOfPosition(node.getStart(sf)).line] ?? "";

    const checkSpecifier = (node: import("typescript").Node, spec: string): void => {
      if (spec.startsWith("node:")) violations.push(`${where(node)} imports ${spec}`);
      if (spec === "punycode" || (spec.startsWith("punycode/") && spec !== "punycode/punycode.es6.js")) {
        violations.push(`${where(node)} imports ${spec} — only "punycode/punycode.es6.js" is allowed`);
      }
      const toZone = zoneOfImport(file, spec);
      if (toZone !== null && !importAllowed(zone, toZone)) {
        violations.push(`${where(node)} (${zone}) may not import ${spec} (${toZone})`);
      }
      if ((zone === "errors" || zone === "shared") && toZone === null && spec !== "") {
        violations.push(`${where(node)} (${zone}) may not import packages`);
      }
    };

    const visit = (node: import("typescript").Node): void => {
      // 4.6(a) + 4.10: imports and re-exports
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        checkSpecifier(node, node.moduleSpecifier.text);
      }
      // 4.6(a) + 4.10: dynamic import("…") obeys the same specifier rules
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg !== undefined && ts.isStringLiteral(arg)) checkSpecifier(node, arg.text);
      }
      // 4.6(a): free identifiers
      if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
        const p = node.parent;
        const isPropertyName =
          ((ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodSignature(p) || ts.isMethodDeclaration(p)) && p.name === node) ||
          (ts.isBindingElement(p) && p.propertyName === node);
        const isDeclarationName = (ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isBindingElement(p)) && p.name === node;
        if (!isPropertyName && !isDeclarationName) violations.push(`${where(node)} uses ${node.text}`);
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
  }
  assert.deepEqual(violations, []);
});
