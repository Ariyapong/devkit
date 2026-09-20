import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../errors.js";

export type Case = unknown[];
export interface FixtureEntry {
  /** Argument lists that must RETURN. Non-empty. */
  returns: Case[];
  /** Argument lists that must THROW an InputError, or the author's attestation that this export never throws. */
  throws: Case[] | "never";
}
export type FixtureTable = Record<string, FixtureEntry>;

const FORBIDDEN: [pattern: RegExp, label: string][] = [
  [/```/, "```"],
  [/^-# /m, "-# "],
  [/<t:/, "<t:"],
];

export function findForbidden(text: string): string | null {
  for (const [re, label] of FORBIDDEN) if (re.test(text)) return label;
  return null;
}

export function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
  else if (value instanceof Map) for (const v of value.values()) collectStrings(v, out, depth + 1);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
  return out;
}

/**
 * Spec rule 4.2, made mechanical: EVERY function export of a domain must
 * have a fixture entry (missing ⇒ fail), every case must take the path its
 * tag says, every string leaf of a return and every thrown message is
 * scanned for Discord layout syntax, and every throw must be an InputError.
 */
export function registerOutputScan(domain: string, mod: Record<string, unknown>, fixtures: FixtureTable): void {
  const fnExports = Object.entries(mod).filter(([, v]) => typeof v === "function");
  for (const [name, fn] of fnExports) {
    test(`[${domain}] output scan: ${name}`, () => {
      const entry = fixtures[name];
      assert.ok(entry, `no scan fixture for export "${name}" — add it to ${domain}/scan-fixtures.ts`);
      assert.ok(entry.returns.length > 0, `${name}: at least one returns case`);
      const call = fn as (...args: unknown[]) => unknown;
      for (const args of entry.returns) {
        let out: unknown;
        try {
          out = call(...args);
        } catch (error) {
          assert.fail(`${name}${JSON.stringify(args)} was tagged "returns" but threw: ${String(error)}`);
        }
        for (const s of collectStrings(out)) {
          const bad = findForbidden(s);
          assert.equal(bad, null, `${name}${JSON.stringify(args)} emitted ${bad} in a domain subpath`);
        }
      }
      if (entry.throws !== "never") {
        assert.ok(entry.throws.length > 0, `${name}: throws must be non-empty or "never"`);
        for (const args of entry.throws) {
          let thrown: unknown = null;
          try {
            call(...args);
          } catch (error) {
            thrown = error;
          }
          assert.ok(thrown !== null, `${name}${JSON.stringify(args)} was tagged "throws" but returned`);
          assert.ok(thrown instanceof InputError, `${name}${JSON.stringify(args)} threw a non-InputError: ${String(thrown)}`);
          const bad = findForbidden((thrown as InputError).message);
          assert.equal(bad, null, `${name}${JSON.stringify(args)} threw a message containing ${bad}`);
        }
      }
    });
  }
  test(`[${domain}] output scan: no fixture names a non-existent export`, () => {
    const names = new Set(fnExports.map(([n]) => n));
    for (const key of Object.keys(fixtures)) assert.ok(names.has(key), `fixture "${key}" has no matching function export`);
  });
}
