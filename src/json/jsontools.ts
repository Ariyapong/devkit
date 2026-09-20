import YAML from "yaml";
import { InputError } from "../errors.js";
import { formatYamlError } from "./yamltools.js";
import { locateJsonError } from "./json-error.js";

function parseJsonOrThrow(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    const located = locateJsonError(input, error);
    throw new InputError(located.message, located.detail);
  }
}

export function formatJson(input: string): string {
  return JSON.stringify(parseJsonOrThrow(input), null, 2);
}

export function minifyJson(input: string): string {
  return JSON.stringify(parseJsonOrThrow(input));
}

export function validateJson(input: string): string {
  const value = parseJsonOrThrow(input);
  if (Array.isArray(value)) return `✅ Valid JSON — array, ${value.length} item(s)`;
  if (value !== null && typeof value === "object") {
    return `✅ Valid JSON — object, ${Object.keys(value).length} key(s)`;
  }
  return `✅ Valid JSON — ${value === null ? "null" : typeof value}`;
}

/** Raw text → escaped JSON string literal (for embedding JSON in a string field). */
export function jsonStringify(raw: string): string {
  return JSON.stringify(raw);
}

/** Escaped/double-encoded JSON string → readable pretty JSON. */
export function jsonParseString(input: string, minified = false): string {
  let outer: unknown;
  try {
    outer = JSON.parse(input.trim());
  } catch {
    throw new InputError(
      'Not valid JSON. An escaped string looks like: "{\\"a\\":1}" (quotes included).',
    );
  }
  if (typeof outer !== "string") {
    // Name the sibling that matches the shape asked for: sending a parse-min
    // caller to the pretty tool is the wrong signpost.
    throw new InputError(
      `Parsed value is not a string — it's already plain JSON. Use /json ${
        minified ? "minify" : "format"
      } instead.`,
    );
  }
  try {
    return JSON.stringify(JSON.parse(outer), null, minified ? 0 : 2);
  } catch {
    return outer; // inner value is a plain string, not JSON — show it as-is
  }
}

function pascalCase(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join("");
  return cleaned || "Item";
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

export function jsonToTs(input: string, rootName = "Root"): string {
  const value = parseJsonOrThrow(input);
  const interfaces: string[] = [];
  // Document-wide name -> body registry, so unrelated branches that happen to
  // produce the same local name (e.g. two "items" fields, or two array items
  // both named "...Item") don't declaration-merge into an over-constrained type.
  const bodyByName = new Map<string, string>();

  const typeOf = (v: unknown, name: string): string => {
    if (v === null) return "null";
    if (Array.isArray(v)) {
      if (v.length === 0) return "unknown[]";
      const types = [...new Set(v.map((el) => typeOf(el, `${name}Item`)))];
      return types.length === 1 ? `${types[0]}[]` : `(${types.join(" | ")})[]`;
    }
    if (typeof v === "object") {
      const base = pascalCase(name);
      const fields = Object.entries(v).map(
        ([key, val]) =>
          `  ${IDENT_RE.test(key) ? key : JSON.stringify(key)}: ${typeOf(val, key)};`,
      );
      const body = fields.length === 0 ? "{}" : `{\n${fields.join("\n")}\n}`;

      let ifaceName = base;
      for (let n = 2; bodyByName.has(ifaceName) && bodyByName.get(ifaceName) !== body; n++) {
        ifaceName = `${base}${n}`;
      }
      if (!bodyByName.has(ifaceName)) {
        bodyByName.set(ifaceName, body);
        interfaces.push(`interface ${ifaceName} ${body}`);
      }
      return ifaceName;
    }
    return typeof v; // string | number | boolean
  };

  const rootType = typeOf(value, rootName);
  const rootIsObject =
    value !== null && typeof value === "object" && !Array.isArray(value);
  const parts = rootIsObject ? [] : [`type ${pascalCase(rootName)} = ${rootType};`];
  return [...parts, ...interfaces.reverse()].join("\n\n");
}

export function jsonToYaml(input: string): string {
  return YAML.stringify(parseJsonOrThrow(input));
}

export function yamlToJson(input: string): string {
  let value: unknown;
  try {
    value = YAML.parse(input);
  } catch (error) {
    const located = formatYamlError(error);
    if (located !== null) throw new InputError(located.message, located.detail);
    throw new InputError(`Invalid YAML: ${(error as Error).message}`);
  }
  return JSON.stringify(value, null, 2);
}
