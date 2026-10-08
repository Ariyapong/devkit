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

/**
 * JSON.stringify with a bigint replacer. Assertion messages below are
 * built eagerly — JS evaluates every call argument before dispatch, so a
 * bigint-typed export's args would throw "Do not know how to serialize a
 * BigInt" even on the passing path, before assert ever inspects the message.
 */
function stringifyArgs(args: unknown[]): string {
  return JSON.stringify(args, (_key, value) => (typeof value === "bigint" ? `${value}n` : value));
}

export function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
  else if (value instanceof Map) for (const v of value.values()) collectStrings(v, out, depth + 1);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
  return out;
}

/** Awaits a thenable result, passes anything else through. */
async function settle(value: unknown): Promise<unknown> {
  return value instanceof Promise || (typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function")
    ? await (value as Promise<unknown>)
    : value;
}

/**
 * Spec rule 4.2 for ONE export: every `returns` case must return (or
 * resolve), every string leaf of its value is scanned; every `throws` case
 * must throw (or reject) an InputError whose message is scanned. Returns the
 * violations as messages so the harness can assert on them and the
 * self-test can prove each failing path fails.
 */
export async function checkEntry(
  name: string,
  fn: (...args: unknown[]) => unknown,
  entry: FixtureEntry,
): Promise<string[]> {
  const out: string[] = [];
  for (const args of entry.returns) {
    let value: unknown;
    try {
      value = await settle(fn(...args));
    } catch (error) {
      out.push(`${name}${stringifyArgs(args)} was tagged "returns" but threw: ${String(error)}`);
      continue;
    }
    for (const s of collectStrings(value)) {
      const bad = findForbidden(s);
      if (bad !== null) out.push(`${name}${stringifyArgs(args)} emitted ${bad} in a domain subpath`);
    }
  }
  if (entry.throws !== "never") {
    for (const args of entry.throws) {
      let thrown: unknown = null;
      try {
        await settle(fn(...args));
      } catch (error) {
        thrown = error;
      }
      if (thrown === null) {
        out.push(`${name}${stringifyArgs(args)} was tagged "throws" but returned`);
        continue;
      }
      if (!(thrown instanceof InputError)) {
        out.push(`${name}${stringifyArgs(args)} threw a non-InputError: ${String(thrown)}`);
        continue;
      }
      const bad = findForbidden(thrown.message);
      if (bad !== null) out.push(`${name}${stringifyArgs(args)} threw a message containing ${bad}`);
    }
  }
  return out;
}

/**
 * Spec rule 4.2, made mechanical: EVERY function export of a domain must
 * have a fixture entry (missing ⇒ fail), and checkEntry must report nothing
 * for it. Async exports are awaited; a rejection counts as a throw.
 */
export function registerOutputScan(domain: string, mod: Record<string, unknown>, fixtures: FixtureTable): void {
  const fnExports = Object.entries(mod).filter(([, v]) => typeof v === "function");
  for (const [name, fn] of fnExports) {
    test(`[${domain}] output scan: ${name}`, async () => {
      const entry = fixtures[name];
      assert.ok(entry, `no scan fixture for export "${name}" — add it to ${domain}/scan-fixtures.ts`);
      assert.ok(entry.returns.length > 0, `${name}: at least one returns case`);
      if (entry.throws !== "never") assert.ok(entry.throws.length > 0, `${name}: throws must be non-empty or "never"`);
      const violations = await checkEntry(name, fn as (...args: unknown[]) => unknown, entry);
      assert.deepEqual(violations, []);
    });
  }
  test(`[${domain}] output scan: no fixture names a non-existent export`, () => {
    const names = new Set(fnExports.map(([n]) => n));
    for (const key of Object.keys(fixtures)) assert.ok(names.has(key), `fixture "${key}" has no matching function export`);
  });
}
