import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDiffReply, renderSchemaReply, renderRequestReply } from "./api-render.js";
import { diffShapes, renderShapeDiff, schemaOf, type ShapeDiff } from "../api/shapetools.js";
import { parseRequestForm, toCurl, WARN_NO_SCHEME, WARN_RAW_BODY, type RequestForm } from "../api/curl-build.js";

test("renderDiffReply pins the full reply: both echo blocks, the blank line, then the drift block", () => {
  const before = { a: 1, b: "old" };
  const after = { a: 2, b: "new", c: true };
  // Same diff literal as the "all categories" renderShapeDiff pin above, so
  // the tail here is independently known-correct.
  const diff: ShapeDiff = {
    added: [{ path: "a", type: "string" }],
    removed: [{ path: "verylongpath", type: "number" }],
    changed: [{ path: "b", before: "string", after: "null" }],
    breaking: 1,
  };

  const expected =
    "── before ──\n" +
    '{\n  "a": 1,\n  "b": "old"\n}\n' +
    "── after ──\n" +
    '{\n  "a": 2,\n  "b": "new",\n  "c": true\n}\n' +
    "\n" +
    "── contract drift ──\n" +
    "+ a             string\n" +
    "- verylongpath  number\n" +
    "~ b             string → null\n" +
    "\n" +
    "1 added · 1 removed · 1 type-changed\n" +
    "⚠ 1 breaking";

  assert.equal(renderDiffReply(before, after, diff), expected);
});

test("renderDiffReply pins the no-changes case: both echo blocks present, tail is exactly the identical marker", () => {
  const before = { a: 1 };
  const after = { a: 2 };
  const diff = diffShapes(before, after);

  const expected =
    "── before ──\n" +
    '{\n  "a": 1\n}\n' +
    "── after ──\n" +
    '{\n  "a": 2\n}\n' +
    "\n" +
    "✅ shapes identical";

  assert.equal(renderDiffReply(before, after, diff), expected);
});

test("renderDiffReply's tail is byte-identical to renderShapeDiff(diff) for the same diff", () => {
  const before = { x: 1 };
  const after = { x: "1", y: 2 };
  const diff = diffShapes(before, after);

  const tail = renderShapeDiff(diff);
  const reply = renderDiffReply(before, after, diff);

  assert.equal(reply.endsWith(tail), true);
  // The blank line lives strictly between the echo blocks and the tail, so
  // stripping exactly the tail's length must land right after it.
  assert.equal(reply.slice(0, reply.length - tail.length).endsWith("\n\n"), true);
});

test("renderDiffReply pretty-prints a nested object and an array at 2-space indent", () => {
  const before = { user: { name: "a", tags: ["x", "y"] } };
  const after = { user: { name: "b", tags: ["p"] } };
  const diff = diffShapes(before, after);

  const expected =
    "── before ──\n" +
    '{\n  "user": {\n    "name": "a",\n    "tags": [\n      "x",\n      "y"\n    ]\n  }\n}\n' +
    "── after ──\n" +
    '{\n  "user": {\n    "name": "b",\n    "tags": [\n      "p"\n    ]\n  }\n}\n' +
    "\n" +
    "✅ shapes identical";

  assert.equal(renderDiffReply(before, after, diff), expected);
});

test("renderSchemaReply: echo above, schema below, exact layout", () => {
  const payload = { id: 7 };
  const { schema } = schemaOf(payload);
  assert.equal(
    renderSchemaReply(payload, schema),
    [
      "── payload ──",
      "{",
      '  "id": 7',
      "}",
      "── JSON Schema ──",
      "{",
      '  "$schema": "https://json-schema.org/draft/2020-12/schema",',
      '  "type": "object",',
      '  "required": [',
      '    "id"',
      "  ],",
      '  "properties": {',
      '    "id": {',
      '      "type": "integer"',
      "    }",
      "  }",
      "}",
    ].join("\n"),
  );
});

const blank: RequestForm = { url: "https://a.co/x", method: "", auth: "", headers: "", body: "" };
const form = (o: Partial<RequestForm>): RequestForm => ({ ...blank, ...o });

test("render: warnings precede the command as # ⚠ lines; none ⇒ command only", () => {
  const spec = parseRequestForm(form({ url: "a.co", body: "x" }));
  assert.equal(
    renderRequestReply(spec),
    "# ⚠ " + WARN_NO_SCHEME + "\n# ⚠ " + WARN_RAW_BODY + "\n" + toCurl(spec),
  );
  const clean = parseRequestForm(form({}));
  assert.equal(renderRequestReply(clean), toCurl(clean));
});
