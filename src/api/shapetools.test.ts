import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DEPTH,
  MAX_NODES,
  ROOT_PATH,
  shapeOf,
  diffShapes,
  isBreakingChange,
  renderShapeDiff,
  schemaOf,
  type ChangedEntry,
  type ShapeDiff,
} from "./shapetools.js";
import { InputError } from "../errors.js";

test("scalar at the root emits only the root path", () => {
  assert.deepEqual([...shapeOf("hi")], [[ROOT_PATH, "string"]]);
});

test("null is its own type", () => {
  assert.deepEqual([...shapeOf(null)], [[ROOT_PATH, "null"]]);
});

test("containers emit their own entry as well as their children", () => {
  const shape = shapeOf({ user: { name: "a" } });
  assert.equal(shape.get(ROOT_PATH), "object");
  assert.equal(shape.get("user"), "object");
  assert.equal(shape.get("user.name"), "string");
  assert.equal(shape.size, 3);
});

test("array emits the container plus one merged child path", () => {
  const shape = shapeOf({ items: [{ price: 1 }, { price: 2 }] });
  assert.equal(shape.get("items"), "array");
  assert.equal(shape.get("items[]"), "object");
  assert.equal(shape.get("items[].price"), "number");
  assert.equal(shape.size, 4);
});

test("heterogeneous array elements union, sorted", () => {
  assert.equal(shapeOf({ xs: [1, "a"] }).get("xs[]"), "number | string");
});

test("fields missing from some elements still appear (documented v1 limit)", () => {
  const shape = shapeOf({ xs: [{ a: 1 }, { b: "z" }] });
  assert.equal(shape.get("xs[].a"), "number");
  assert.equal(shape.get("xs[].b"), "string");
});

test("empty array yields unknown, not a missing child", () => {
  const shape = shapeOf({ items: [] });
  assert.equal(shape.get("items"), "array");
  assert.equal(shape.get("items[]"), "unknown");
});

test("root-level array uses $ and $[]", () => {
  const shape = shapeOf([1]);
  assert.equal(shape.get(ROOT_PATH), "array");
  assert.equal(shape.get("$[]"), "number");
  assert.equal(shape.size, 2);
});

test("non-identifier keys are bracket-quoted", () => {
  const shape = shapeOf({ "odd key": 1 });
  assert.equal(shape.get('$["odd key"]'), "number");
});

test("nested non-identifier key hangs off its parent", () => {
  const shape = shapeOf({ data: { "a-b": true } });
  assert.equal(shape.get('data["a-b"]'), "boolean");
});

test("exceeding the node cap throws InputError", () => {
  const wide: Record<string, number> = {};
  for (let i = 0; i <= MAX_NODES; i++) wide[`k${i}`] = i;
  assert.throws(() => shapeOf(wide), InputError);
});

test("deeply nested objects beyond MAX_DEPTH throws InputError", () => {
  let deep: unknown = 1;
  for (let i = 0; i <= MAX_DEPTH; i++) {
    deep = { x: deep };
  }
  assert.throws(() => shapeOf(deep), InputError);
});

test("deeply nested arrays beyond MAX_DEPTH throws InputError", () => {
  let deep: unknown = 1;
  for (let i = 0; i <= MAX_DEPTH; i++) {
    deep = [deep];
  }
  assert.throws(() => shapeOf(deep), InputError);
});

test("a payload nested just within MAX_DEPTH succeeds and produces the expected leaf type", () => {
  let deep: unknown = "leaf";
  for (let i = 0; i < MAX_DEPTH; i++) {
    deep = { x: deep };
  }
  const shape = shapeOf(deep);
  assert.equal(shape.get(ROOT_PATH), "object");
  // Build the expected final path: x.x.x... (MAX_DEPTH times)
  // First level is just "x", then "x.x", "x.x.x", etc.
  let path = "x";
  for (let i = 1; i < MAX_DEPTH; i++) {
    path += ".x";
  }
  assert.equal(shape.get(path), "string");
});

test("identical payloads produce no changes", () => {
  const diff = diffShapes({ a: 1 }, { a: 2 });
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.changed, []);
  assert.equal(diff.breaking, 0);
});

test("values are ignored entirely", () => {
  const before = { id: 41, ts: "09:00", name: "a" };
  const after = { id: 42, ts: "09:05", name: "b" };
  assert.equal(diffShapes(before, after).changed.length, 0);
});

test("added field is reported and is not breaking", () => {
  const diff = diffShapes({ a: 1 }, { a: 1, b: "x" });
  assert.deepEqual(diff.added, [{ path: "b", type: "string" }]);
  assert.equal(diff.breaking, 0);
});

test("removed field is breaking", () => {
  const diff = diffShapes({ a: 1, b: "x" }, { a: 1 });
  assert.deepEqual(diff.removed, [{ path: "b", type: "string" }]);
  assert.equal(diff.breaking, 1);
});

test("type change is breaking and records both sides", () => {
  const diff = diffShapes({ price: 1 }, { price: "1" });
  assert.deepEqual(diff.changed, [
    { path: "price", before: "number", after: "string" },
  ]);
  assert.equal(diff.breaking, 1);
});

test("string to null is a type change, not a fourth category", () => {
  const diff = diffShapes({ name: "a" }, { name: null });
  assert.deepEqual(diff.changed, [
    { path: "name", before: "string", after: "null" },
  ]);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.breaking, 1);
});

test("root type change is reported at $", () => {
  const diff = diffShapes({ a: 1 }, [1]);
  const root = diff.changed.find((c) => c.path === "$");
  assert.deepEqual(root, { path: "$", before: "object", after: "array" });
});

test("container to scalar reports two true lines", () => {
  const diff = diffShapes({ items: [1] }, { items: "x" });
  assert.deepEqual(diff.changed, [
    { path: "items", before: "array", after: "string" },
  ]);
  assert.deepEqual(diff.removed, [{ path: "items[]", type: "number" }]);
});

test("empty array becoming populated is a change but NOT breaking", () => {
  const diff = diffShapes({ items: [] }, { items: [1] });
  assert.deepEqual(diff.changed, [
    { path: "items[]", before: "unknown", after: "number" },
  ]);
  assert.equal(diff.breaking, 0);
});

test("populated array becoming empty is also not breaking", () => {
  const diff = diffShapes({ items: [1] }, { items: [] });
  assert.equal(diff.breaking, 0);
});

test("isBreakingChange is exported and excludes unknown on either side", () => {
  const unknownAfter: ChangedEntry = {
    path: "x",
    before: "number",
    after: "unknown",
  };
  assert.equal(isBreakingChange(unknownAfter), false);
  assert.equal(
    isBreakingChange({ path: "x", before: "number", after: "string" }),
    true,
  );
});

test("unknown merged into a union is still exempt: 'string | unknown' -> 'string' is not breaking", () => {
  const before = { posts: [{ tags: [] }, { tags: ["a"] }] };
  const after = { posts: [{ tags: ["a"] }, { tags: ["b"] }] };
  const diff = diffShapes(before, after);
  const entry = diff.changed.find((c) => c.path === "posts[].tags[]");
  assert.deepEqual(entry, {
    path: "posts[].tags[]",
    before: "string | unknown",
    after: "string",
  });
  assert.equal(isBreakingChange(entry as ChangedEntry), false);
  assert.equal(diff.breaking, 0);
});

test("union narrowing is not breaking: 'null | string' -> 'string'", () => {
  assert.equal(
    isBreakingChange({ path: "x", before: "null | string", after: "string" }),
    false,
  );
});

test("union widening is breaking: 'string' -> 'number | string'", () => {
  assert.equal(
    isBreakingChange({
      path: "x",
      before: "string",
      after: "number | string",
    }),
    true,
  );
});

test("a plain type change is still breaking (guards against over-relaxing)", () => {
  assert.equal(
    isBreakingChange({ path: "x", before: "number", after: "string" }),
    true,
  );
});

test("removing a path whose type was unknown does not count toward breaking", () => {
  const diff = diffShapes({ items: [] }, {});
  const removedUnknown = diff.removed.find((e) => e.path === "items[]");
  assert.deepEqual(removedUnknown, { path: "items[]", type: "unknown" });
  // "items" itself (type "array") was also removed and DOES count.
  assert.equal(diff.breaking, 1);
});

test("removing a real path still counts toward breaking", () => {
  const diff = diffShapes({ a: 1, b: "x" }, { a: 1 });
  assert.deepEqual(diff.removed, [{ path: "b", type: "string" }]);
  assert.equal(diff.breaking, 1);
});

test("a root key named $ no longer collides with ROOT_PATH", () => {
  const diff = diffShapes({ x: 1 }, { $: { x: 1 } });
  assert.notEqual(
    diff.added.length + diff.removed.length + diff.changed.length,
    0,
  );

  const shape = shapeOf({ $: { x: 1 } });
  assert.equal(shape.get('$["$"]'), "object");
  assert.equal(shape.get('$["$"].x'), "number");
});

test("output is sorted by code point, deterministically", () => {
  const diff = diffShapes({}, { b: 1, a: 1, C: 1 });
  assert.deepEqual(
    diff.added.map((entry) => entry.path),
    ["C", "a", "b"],
  );
});

test("no changes renders the identical marker alone", () => {
  const rendered = renderShapeDiff(diffShapes({ a: 1 }, { a: 2 }));
  assert.equal(rendered, "✅ shapes identical");
});

test("renders each category with its marker and aligned types", () => {
  const rendered = renderShapeDiff(
    diffShapes(
      { user: { nickname: "n", name: "a" } },
      { user: { name: null, avatarUrl: "u" } },
    ),
  );
  assert.match(rendered, /^── contract drift ──$/m);
  assert.match(rendered, /^\+ user\.avatarUrl\s+string$/m);
  assert.match(rendered, /^- user\.nickname\s+string$/m);
  assert.match(rendered, /^~ user\.name\s+string → null$/m);
});

test("counts line reports all three categories", () => {
  const rendered = renderShapeDiff(
    diffShapes({ a: 1, b: 1 }, { a: "1", c: 1 }),
  );
  assert.match(rendered, /^1 added · 1 removed · 1 type-changed$/m);
});

test("breaking line appears only when something is breaking", () => {
  const breaking = renderShapeDiff(diffShapes({ a: 1 }, { a: "1" }));
  assert.match(breaking, /^⚠ 1 breaking$/m);

  const additive = renderShapeDiff(diffShapes({ a: 1 }, { a: 1, b: 2 }));
  assert.equal(additive.includes("breaking"), false);
});

test("rendering is deterministic for the same input", () => {
  const pair: [unknown, unknown] = [{ a: 1, b: 2 }, { b: "2", c: 3 }];
  assert.equal(
    renderShapeDiff(diffShapes(pair[0], pair[1])),
    renderShapeDiff(diffShapes(pair[0], pair[1])),
  );
});

test("pins exact output format with all categories and deliberate path-length variance", () => {
  // Deliberately different path lengths so padding is observable:
  // "a" (1 char), "verylongpath" (12 chars), "b" (1 char) → width is 12
  // Format: marker + space + path.padEnd(width) + two spaces + detail
  const diff: ShapeDiff = {
    added: [{ path: "a", type: "string" }],
    removed: [{ path: "verylongpath", type: "number" }],
    changed: [{ path: "b", before: "string", after: "null" }],
    breaking: 1,
  };

  const expected =
    "── contract drift ──\n" +
    "+ a             string\n" +
    "- verylongpath  number\n" +
    "~ b             string → null\n" +
    "\n" +
    "1 added · 1 removed · 1 type-changed\n" +
    "⚠ 1 breaking";

  assert.equal(renderShapeDiff(diff), expected);
});

test("pins exact output format for additive-only diff without breaking line", () => {
  const diff: ShapeDiff = {
    added: [
      { path: "email", type: "string" },
      { path: "name", type: "string" },
    ],
    removed: [],
    changed: [],
    breaking: 0,
  };

  const expected =
    "── contract drift ──\n" +
    "+ email  string\n" +
    "+ name   string\n" +
    "\n" +
    "2 added · 0 removed · 0 type-changed";

  assert.equal(renderShapeDiff(diff), expected);
});

test("schemaOf: root string carries $schema and type only", () => {
  assert.deepEqual(schemaOf("hi").schema, {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "string",
  });
});

test("schemaOf: boolean and null are their own types", () => {
  assert.deepEqual(schemaOf(true).schema.type, "boolean");
  assert.deepEqual(schemaOf(null).schema.type, "null");
});

test("schemaOf: whole number emits integer, fractional emits number", () => {
  assert.equal(schemaOf(7).schema.type, "integer");
  assert.equal(schemaOf(2.5).schema.type, "number");
});

test("schemaOf: a lone scalar counts one node", () => {
  assert.equal(schemaOf("hi").nodes, 1);
});

test("schemaOf: flat object — every seen field required, first-seen order", () => {
  const { schema } = schemaOf({ id: 1, name: "a" });
  assert.deepEqual(schema, {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["id", "name"],
    properties: { id: { type: "integer" }, name: { type: "string" } },
  });
  // deepEqual ignores key order; pin first-seen order explicitly.
  assert.deepEqual(Object.keys(schema.properties!), ["id", "name"]);
});

test("schemaOf: nested objects recurse", () => {
  const { schema } = schemaOf({ user: { name: "a" } });
  assert.deepEqual(schema.properties!.user, {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  });
});

test("schemaOf: empty object omits properties and required", () => {
  assert.deepEqual(schemaOf({}).schema, {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
  });
});

test("schemaOf: a literal $ key is an ordinary property — no path encoding here", () => {
  const { schema } = schemaOf({ $: 1 });
  assert.deepEqual(schema.required, ["$"]);
  assert.deepEqual(schema.properties!.$, { type: "integer" });
});

test("schemaOf: object nodes count container plus children", () => {
  assert.equal(schemaOf({ a: 1, b: "x" }).nodes, 3);
});

test("schemaOf: empty array omits items — nothing observed", () => {
  assert.deepEqual(schemaOf([]).schema, {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "array",
  });
});

test("schemaOf: uniform scalar elements merge to one items schema", () => {
  assert.deepEqual(schemaOf([1, 2]).schema.items, { type: "integer" });
});

test("schemaOf: integer and number collapse to number, never a union", () => {
  assert.deepEqual(schemaOf([1, 2.5]).schema.items, { type: "number" });
});

test("schemaOf: mixed scalar elements union sorted", () => {
  assert.deepEqual(schemaOf([1, "a"]).schema.items, {
    type: ["integer", "string"],
  });
  assert.deepEqual(schemaOf(["a", null]).schema.items, {
    type: ["null", "string"],
  });
});

test("schemaOf: integer/number collapse applies inside a wider union", () => {
  assert.deepEqual(schemaOf([1, 2.5, "a"]).schema.items, {
    type: ["number", "string"],
  });
});

test("schemaOf: seen-in-all — field missing in one element goes optional", () => {
  const { schema } = schemaOf([{ id: 1, title: "a" }, { id: 2 }]);
  assert.deepEqual(schema.items, {
    type: "object",
    required: ["id"],
    properties: { id: { type: "integer" }, title: { type: "string" } },
  });
});

test("schemaOf: an empty-object element empties required entirely", () => {
  assert.deepEqual(schemaOf([{}, { a: 1 }]).schema.items, {
    type: "object",
    properties: { a: { type: "integer" } },
  });
});

test("schemaOf: objects and scalars mixed stay a flat union", () => {
  assert.deepEqual(schemaOf([1, { a: 2 }]).schema.items, {
    type: ["integer", "object"],
    required: ["a"],
    properties: { a: { type: "integer" } },
  });
});

test("schemaOf: null among object elements joins the union, keeps required", () => {
  assert.deepEqual(schemaOf([{ a: 1 }, null]).schema.items, {
    type: ["null", "object"],
    required: ["a"],
    properties: { a: { type: "integer" } },
  });
});

test("schemaOf: empty array among non-empty keeps the observed items", () => {
  assert.deepEqual(schemaOf([[], [1]]).schema.items, {
    type: "array",
    items: { type: "integer" },
  });
});

test("schemaOf: shared property keys merge recursively, seen-in-all at each level", () => {
  const { schema } = schemaOf([{ meta: { a: 1 } }, { meta: { b: 2 } }]);
  assert.deepEqual(schema.items, {
    type: "object",
    required: ["meta"],
    properties: {
      meta: {
        type: "object",
        properties: { a: { type: "integer" }, b: { type: "integer" } },
      },
    },
  });
});

test("schemaOf: arrays of arrays of objects merge at depth", () => {
  const { schema } = schemaOf([[{ a: 1 }], [{ a: 2, b: "x" }]]);
  assert.deepEqual(schema.items, {
    type: "array",
    items: {
      type: "object",
      required: ["a"],
      properties: { a: { type: "integer" }, b: { type: "string" } },
    },
  });
});

test("schemaOf: depth guard throws the same message as shapeOf", () => {
  let deep: unknown = 1;
  for (let i = 0; i <= MAX_DEPTH; i++) deep = [deep];
  assert.throws(
    () => schemaOf(deep),
    new InputError(`Payload is too deeply nested (over ${MAX_DEPTH} levels).`),
  );
});

test("schemaOf: node guard throws the same message as shapeOf", () => {
  const wide = Array.from({ length: MAX_NODES }, () => 1);
  assert.throws(
    () => schemaOf(wide),
    new InputError(`Payload is too large to analyse (over ${MAX_NODES} fields).`),
  );
});

test("schemaOf: nodes counts every visited value", () => {
  // root + a + b + two elements = 5
  assert.equal(schemaOf({ a: 1, b: [1, 2] }).nodes, 5);
});

test("schemaOf: same input twice is byte-identical", () => {
  const input = { xs: [{ a: 1 }, { b: 2.5 }], t: "x" };
  assert.equal(
    JSON.stringify(schemaOf(input).schema),
    JSON.stringify(schemaOf(input).schema),
  );
});

test("schemaOf: $schema is the first serialized key at every root kind", () => {
  for (const root of [{ a: 1 }, [1], "s"]) {
    assert.equal(Object.keys(schemaOf(root).schema)[0], "$schema");
  }
});

test("schemaOf: an empty-object element late in the fold still empties required", () => {
  assert.deepEqual(schemaOf([{ a: 1 }, { a: 2 }, {}]).schema.items, {
    type: "object",
    properties: { a: { type: "integer" } },
  });
});

test("schemaOf: required survives a scalar in the middle of the fold", () => {
  assert.deepEqual(schemaOf([{ a: 1 }, 1, { a: 2 }]).schema.items, {
    type: ["integer", "object"],
    required: ["a"],
    properties: { a: { type: "integer" } },
  });
});

test("schemaOf: integer/number collapse applies inside a property merge", () => {
  assert.deepEqual(schemaOf([{ a: 1 }, { a: 2.5 }]).schema.items, {
    type: "object",
    required: ["a"],
    properties: { a: { type: "number" } },
  });
});

test("schemaOf: an own __proto__ key survives — build's properties map must not hit the Object.prototype setter", () => {
  const payload = JSON.parse('{"__proto__":{"x":1},"a":1}');
  // A plain object literal written as `{ __proto__: ..., a: ... }` in test
  // source hits the exact same trap this test is pinning: `__proto__:` in an
  // object initializer sets the new object's prototype instead of creating an
  // own property (Annex B.3.1). JSON.parse assigns via CreateDataProperty, not
  // [[Set]], so it produces a real own "__proto__" key — build the expected
  // value the same safe way.
  const expected = JSON.parse(`{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["__proto__", "a"],
    "properties": {
      "__proto__": {
        "type": "object",
        "required": ["x"],
        "properties": { "x": { "type": "integer" } }
      },
      "a": { "type": "integer" }
    }
  }`);
  assert.deepEqual(schemaOf(payload).schema, expected);
});

test("schemaOf: an Object.prototype-only key on the second element merges as a plain property, not an inherited method", () => {
  assert.deepEqual(schemaOf([{ a: 1 }, { toString: 2 }]).schema.items, {
    type: "object",
    properties: { a: { type: "integer" }, toString: { type: "integer" } },
  });
});
