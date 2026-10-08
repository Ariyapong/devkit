import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contrastRatio,
  nearestAaPass,
  relativeLuminance,
  wcagVerdicts,
} from "./contrast.js";
import { parseColor } from "./colortools.js";

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

test("relativeLuminance: black is 0, white is 1", () => {
  assert.equal(relativeLuminance(0, 0, 0), 0);
  assert.equal(relativeLuminance(255, 255, 255), 1);
});

test("contrastRatio: known anchors", () => {
  assert.equal(contrastRatio(BLACK, WHITE).toFixed(2), "21.00");
  assert.equal(contrastRatio(WHITE, BLACK).toFixed(2), "21.00"); // symmetric
  assert.equal(contrastRatio(BLACK, BLACK).toFixed(2), "1.00");
  assert.equal(contrastRatio({ r: 119, g: 119, b: 119 }, WHITE).toFixed(2), "4.48");
});

test("wcagVerdicts: thresholds are inclusive", () => {
  assert.deepEqual(wcagVerdicts(4.5), { aaNormal: true, aaLarge: true, aaaNormal: false, aaaLarge: true });
  assert.deepEqual(wcagVerdicts(3), { aaNormal: false, aaLarge: true, aaaNormal: false, aaaLarge: false });
  assert.deepEqual(wcagVerdicts(7), { aaNormal: true, aaLarge: true, aaaNormal: true, aaaLarge: true });
  assert.deepEqual(wcagVerdicts(2.99), { aaNormal: false, aaLarge: false, aaaNormal: false, aaaLarge: false });
});

test("nearestAaPass: minimal darkening for #777777 on white", () => {
  const res = nearestAaPass(parseColor("#777777"), parseColor("#ffffff"));
  assert.equal(res.hex, "#757575"); // l 47 -> 46, the first passing step
  assert.ok(res.ratio >= 4.5);
});

test("nearestAaPass: goes lighter against dark backgrounds, keeps hue/sat", () => {
  const res = nearestAaPass(parseColor("#555555"), parseColor("#000000"));
  const parsed = parseColor(res.hex);
  assert.ok(parsed.l > 33); // #555555 has l 33 — must lighten
  assert.equal(parsed.s, 0); // gray stays gray
  assert.ok(res.ratio >= 4.5);
});

test("nearestAaPass: at a tie both directions pass, prefers the higher ratio", () => {
  // #808080 (l 50) on black: at delta 1 the darker step #7d7d7d also clears
  // 4.5 (ratio 5.10), but the lighter step #828282 has the higher ratio, so
  // it wins even though the darker candidate is evaluated first.
  assert.ok(contrastRatio(parseColor("#7d7d7d"), { r: 0, g: 0, b: 0 }) >= 4.5);
  const res = nearestAaPass(parseColor("#808080"), parseColor("#000000"));
  assert.equal(res.hex, "#828282");
  assert.equal(res.ratio.toFixed(3), "5.465");
});
