import { test } from "node:test";
import assert from "node:assert/strict";
import * as root from "./index.js";
import * as json from "./json/index.js";
import * as api from "./api/index.js";
import * as time from "./time/index.js";
import * as codec from "./codec/index.js";
import * as text from "./text/index.js";
import * as debug from "./debug/index.js";

test("root re-exports every runtime export of every domain, and nothing from ./discord", () => {
  const rootNames = new Set(Object.keys(root));
  for (const [domain, mod] of Object.entries({ json, api, time, codec, text, debug })) {
    for (const name of Object.keys(mod)) assert.ok(rootNames.has(name), `${domain}.${name} missing from root`);
  }
  for (const name of ["renderErrorDetail", "renderJwt", "tidyStackTrace", "renderCompact", "renderUrl", "renderCheck"]) {
    assert.equal(rootNames.has(name), false, `${name} must not be reachable from the root`);
  }
  assert.ok(rootNames.has("InputError") && rootNames.has("sanitizeError"));
});
