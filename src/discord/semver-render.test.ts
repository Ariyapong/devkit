import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRange } from "../text/semvertools.js";
import { renderCheck } from "./semver-render.js";

test("renderCheck: satisfied line carries ✅ and the expanded bounds", () => {
  const line = renderCheck(checkRange("^4.2.0", "4.5.1"));
  assert.match(line, /✅/);
  assert.match(line, />=4\.2\.0/);
});
