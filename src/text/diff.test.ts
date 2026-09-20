import { test } from "node:test";
import assert from "node:assert/strict";
import { diffTexts } from "./diff.js";

test("diffTexts produces unified diff", () => {
  const patch = diffTexts("line1\nline2", "line1\nline2 changed");
  assert.ok(patch.includes("-line2"));
  assert.ok(patch.includes("+line2 changed"));
  assert.equal(diffTexts("same", "same"), "(no differences)");
});
