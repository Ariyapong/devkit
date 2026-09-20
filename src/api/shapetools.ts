import { InputError } from "../errors.js";

/** The root of a payload needs a name of its own so a root type change is an
 *  ordinary entry rather than a special case. */
export const ROOT_PATH = "$";

/** Guard, not a limit: two 4 KB payloads cannot reach it. Exists because an
 *  unbounded walk has already cost this repo 842 ms of blocked event loop. */
export const MAX_NODES = 10_000;

/** Guard against stack overflow from deeply nested structures. Far beyond any
 *  real API payload, far below V8's stack limit. Protects against recursive
 *  call stack exhaustion when MAX_NODES guards width but not depth. */
export const MAX_DEPTH = 200;

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Type of a value at its own level. Containers report the container. */
function leafType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value; // "string" | "number" | "boolean"
}

/** Union two type expressions, deduped and sorted so output is stable. */
function mergeTypes(a: string, b: string): string {
  if (a === b) return a;
  const parts = new Set([...a.split(" | "), ...b.split(" | ")]);
  return [...parts].sort().join(" | ");
}

function fieldPath(parent: string, key: string): string {
  // A root key literally named "$" would otherwise collide with ROOT_PATH
  // itself (both `key` and `key === ROOT_PATH` land on "$"), silently
  // aliasing the field onto the root's own entry and hiding real drift.
  // Route it through the bracket-quoted branch instead: $["$"].
  if (IDENT_RE.test(key) && !(parent === ROOT_PATH && key === ROOT_PATH)) {
    return parent === ROOT_PATH ? key : `${parent}.${key}`;
  }
  return `${parent}[${JSON.stringify(key)}]`;
}

/**
 * Walk a parsed JSON value into `path -> type`. Values are ignored entirely:
 * two responses differing only in ids and timestamps produce identical maps.
 */
export function shapeOf(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  let nodes = 0;

  const record = (path: string, type: string): void => {
    const prev = out.get(path);
    out.set(path, prev === undefined ? type : mergeTypes(prev, type));
  };

  const walk = (v: unknown, path: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      throw new InputError(
        `Payload is too deeply nested (over ${MAX_DEPTH} levels).`,
      );
    }
    nodes += 1;
    if (nodes > MAX_NODES) {
      throw new InputError(
        `Payload is too large to analyse (over ${MAX_NODES} fields).`,
      );
    }
    record(path, leafType(v));

    if (Array.isArray(v)) {
      const child = `${path}[]`;
      if (v.length === 0) {
        record(child, "unknown");
        return;
      }
      // Every element walks into the SAME child path; `record` unions them.
      for (const element of v) walk(element, child, depth + 1);
      return;
    }

    if (v !== null && typeof v === "object") {
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        walk(val, fieldPath(path, key), depth + 1);
      }
    }
  };

  walk(value, ROOT_PATH, 0);
  return out;
}

export interface AddedEntry {
  path: string;
  type: string;
}

export interface RemovedEntry {
  path: string;
  type: string;
}

export interface ChangedEntry {
  path: string;
  before: string;
  after: string;
}

export interface ShapeDiff {
  added: AddedEntry[];
  removed: RemovedEntry[];
  changed: ChangedEntry[];
  breaking: number;
}

/**
 * `unknown` means "an empty array — nothing observed", not a real type, so it
 * is stripped from both sides before comparing (a whole-string check against
 * `"unknown"` only catches it as a lone type — it stops applying the moment
 * `unknown` merges into a union, e.g. `"string | unknown"`).
 *
 * After stripping, a change is breaking only if the AFTER side introduces a
 * type the BEFORE side did not have. Narrowing a union (`"null | string"` ->
 * `"string"`) is not breaking: a consumer that already handled the wider set
 * still works on the narrower one. Widening (`"string"` -> `"number |
 * string"`) is breaking: a consumer written for the narrower set may not
 * handle the new member.
 */
export function isBreakingChange(change: ChangedEntry): boolean {
  const before = new Set(
    change.before.split(" | ").filter((t) => t !== "unknown"),
  );
  const after = change.after.split(" | ").filter((t) => t !== "unknown");
  if (before.size === 0 || after.length === 0) return false;
  return after.some((t) => !before.has(t));
}

/** Code point order, not `localeCompare`: output must not vary by environment. */
function byPath(a: { path: string }, b: { path: string }): number {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

export function diffShapes(before: unknown, after: unknown): ShapeDiff {
  const from = shapeOf(before);
  const to = shapeOf(after);

  const added: AddedEntry[] = [];
  const removed: RemovedEntry[] = [];
  const changed: ChangedEntry[] = [];

  for (const [path, type] of to) {
    if (!from.has(path)) added.push({ path, type });
  }
  for (const [path, type] of from) {
    const now = to.get(path);
    if (now === undefined) removed.push({ path, type });
    else if (now !== type) changed.push({ path, before: type, after: now });
  }

  added.sort(byPath);
  removed.sort(byPath);
  changed.sort(byPath);

  return {
    added,
    removed,
    changed,
    breaking:
      removed.filter((entry) => entry.type !== "unknown").length +
      changed.filter(isBreakingChange).length,
  };
}

/** Rendered body. Never includes payload values — only paths and types. */
export function renderShapeDiff(diff: ShapeDiff): string {
  const rows: { marker: string; path: string; detail: string }[] = [
    ...diff.added.map((e) => ({ marker: "+", path: e.path, detail: e.type })),
    ...diff.removed.map((e) => ({ marker: "-", path: e.path, detail: e.type })),
    ...diff.changed.map((e) => ({
      marker: "~",
      path: e.path,
      detail: `${e.before} → ${e.after}`,
    })),
  ];
  if (rows.length === 0) return "✅ shapes identical";

  // reduce, not Math.max(...spread): a huge payload would blow the arg limit.
  const width = rows.reduce((max, row) => Math.max(max, row.path.length), 0);
  const lines = rows.map(
    (row) => `${row.marker} ${row.path.padEnd(width)}  ${row.detail}`,
  );

  const counts =
    `${diff.added.length} added · ${diff.removed.length} removed · ` +
    `${diff.changed.length} type-changed`;

  const tail = diff.breaking > 0 ? [`⚠ ${diff.breaking} breaking`] : [];
  return ["── contract drift ──", ...lines, "", counts, ...tail].join("\n");
}

/** JSON Schema draft this generator emits. */
const SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";

/**
 * One JSON Schema node. `type` is a bare string until a merge unions it.
 * Key insertion order is the output order: type, required, properties, items.
 * Nodes are immutable once built; merges share subtrees.
 */
export type SchemaNode = {
  $schema?: string;
  type: string | string[];
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
};

export interface SchemaResult {
  schema: SchemaNode;
  nodes: number;
}

/**
 * Union two type expressions. `integer` and `number` collapse to `number`
 * first (integer is a subset — never `["integer","number"]`); the result is
 * code-point sorted, and a single survivor stays a bare string.
 */
function mergeTypeSets(
  a: string | string[],
  b: string | string[],
): string | string[] {
  const set = new Set([
    ...(Array.isArray(a) ? a : [a]),
    ...(Array.isArray(b) ? b : [b]),
  ]);
  if (set.has("integer") && set.has("number")) set.delete("integer");
  const sorted = [...set].sort();
  return sorted.length === 1 ? sorted[0]! : sorted;
}

function isObjectish(s: SchemaNode): boolean {
  return Array.isArray(s.type) ? s.type.includes("object") : s.type === "object";
}

/**
 * Merge two element schemas. Absent constraint keys merge by kind:
 * `properties`/`items` record observations, so an absent side contributes
 * nothing and the other side is kept; `required` asserts universality, so
 * only object sides participate and an empty-object side (absent `required`)
 * empties the intersection. Intersection keeps the first side's (first-seen)
 * order.
 */
function mergeSchemas(a: SchemaNode, b: SchemaNode): SchemaNode {
  const out: SchemaNode = { type: mergeTypeSets(a.type, b.type) };

  const aObj = isObjectish(a);
  const bObj = isObjectish(b);
  let required: string[] | undefined;
  if (aObj && bObj) {
    const bSet = new Set(b.required ?? []);
    required = (a.required ?? []).filter((key) => bSet.has(key));
  } else if (aObj) {
    required = a.required ?? [];
  } else if (bObj) {
    required = b.required ?? [];
  }
  if (required !== undefined && required.length > 0) out.required = required;

  if (a.properties !== undefined || b.properties !== undefined) {
    // Object.create(null): a payload key that shadows an Object.prototype
    // member (e.g. "toString") must read back as undefined here, not as the
    // inherited function — otherwise mergeTypeSets folds a non-schema value
    // into the union and emits an invalid type array.
    const properties: Record<string, SchemaNode> = Object.create(
      null,
    ) as Record<string, SchemaNode>;
    for (const [key, node] of Object.entries(a.properties ?? {})) {
      properties[key] = node;
    }
    for (const [key, node] of Object.entries(b.properties ?? {})) {
      const prev = properties[key];
      properties[key] = prev === undefined ? node : mergeSchemas(prev, node);
    }
    // Spread back to a plain object: CreateDataProperty (not [[Set]]), so an
    // own "__proto__" key copies across intact, and downstream consumers get
    // an ordinary Object.prototype map exactly as before this fix.
    out.properties = { ...properties };
  }

  if (a.items !== undefined && b.items !== undefined) {
    out.items = mergeSchemas(a.items, b.items);
  } else if (a.items !== undefined) {
    out.items = a.items;
  } else if (b.items !== undefined) {
    out.items = b.items;
  }

  return out;
}

/**
 * Infer a JSON Schema (draft 2020-12) from one parsed payload. Own walk, not
 * shapeOf's map: seen-in-all required is unrepresentable there. `nodes` is
 * exposed solely for the ApiSchema log line.
 */
export function schemaOf(value: unknown): SchemaResult {
  let nodes = 0;

  const build = (v: unknown, depth: number): SchemaNode => {
    if (depth > MAX_DEPTH) {
      throw new InputError(
        `Payload is too deeply nested (over ${MAX_DEPTH} levels).`,
      );
    }
    nodes += 1;
    if (nodes > MAX_NODES) {
      throw new InputError(
        `Payload is too large to analyse (over ${MAX_NODES} fields).`,
      );
    }

    if (v === null) return { type: "null" };
    if (Array.isArray(v)) {
      if (v.length === 0) return { type: "array" };
      let items: SchemaNode | undefined;
      for (const element of v) {
        const el = build(element, depth + 1);
        items = items === undefined ? el : mergeSchemas(items, el);
      }
      return { type: "array", items: items! };
    }
    if (typeof v === "object") {
      // Object.create(null): a payload with an own "__proto__" key (real JSON,
      // e.g. `{"__proto__":{"x":1}}`) would otherwise hit the inherited
      // Object.prototype setter on assignment and silently re-prototype this
      // map instead of adding the key.
      const properties: Record<string, SchemaNode> = Object.create(
        null,
      ) as Record<string, SchemaNode>;
      const required: string[] = [];
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        properties[key] = build(val, depth + 1);
        required.push(key);
      }
      if (required.length === 0) return { type: "object" };
      // Spread back to a plain object (CreateDataProperty, not [[Set]]) so the
      // returned SchemaNode's properties map is an ordinary Object.prototype
      // object, unchanged from before this fix.
      return { type: "object", required, properties: { ...properties } };
    }
    if (typeof v === "number") {
      return { type: Number.isInteger(v) ? "integer" : "number" };
    }
    return { type: typeof v }; // "string" | "boolean"
  };

  const root = build(value, 0);
  return { schema: { $schema: SCHEMA_DRAFT, ...root }, nodes };
}
