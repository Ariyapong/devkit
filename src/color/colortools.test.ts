import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColor, relatedColors, searchColors, CSS_COLORS } from "./index.js";
import { InputError } from "../errors.js";

test("parseColor hex and rgb", () => {
  const red = parseColor("#ff0000");
  assert.deepEqual(
    { r: red.r, g: red.g, b: red.b, h: red.h, s: red.s, l: red.l },
    { r: 255, g: 0, b: 0, h: 0, s: 100, l: 50 },
  );
  assert.equal(parseColor("rgb(0, 128, 255)").hex, "#0080ff");
  assert.equal(parseColor("#abc").hex, "#aabbcc");
  assert.throws(() => parseColor("bluish"), InputError);
});

test("parseColor: hsl primaries", () => {
  assert.equal(parseColor("hsl(0, 100%, 50%)").hex, "#ff0000");
  assert.equal(parseColor("hsl(240, 100%, 50%)").hex, "#0000ff");
  assert.equal(parseColor("hsl(0, 0%, 50%)").hex, "#808080");
});

test("parseColor: hsl percent signs optional, hue wraps", () => {
  assert.equal(parseColor("hsl(0,100,50)").hex, "#ff0000");
  assert.equal(
    parseColor("hsl(376, 100%, 50%)").hex,
    parseColor("hsl(16, 100%, 50%)").hex,
  );
});

test("parseColor: hsl out-of-range s/l throws", () => {
  assert.throws(() => parseColor("hsl(0, 150%, 50%)"), InputError);
});

test("parseColor: hsl with negative s/l is rejected via the generic format error", () => {
  // Negative s/l don't match the hsl regex at all, so they fall through to the
  // generic format guidance — unlike s/l > 100, which hits the "0-100" message.
  assert.throws(() => parseColor("hsl(0, -5%, 50%)"), /rrggbb/);
  assert.throws(() => parseColor("hsl(0, 50%, -5%)"), /rrggbb/);
});

test("parseColor: named color, case-insensitive", () => {
  const c = parseColor("Coral");
  assert.equal(c.hex, "#ff7f50");
  assert.equal(c.name, "coral");
});

test("parseColor: reverse name lookup from hex and rgb", () => {
  assert.equal(parseColor("#ff7f50").name, "coral");
  assert.equal(parseColor("rgb(255, 0, 0)").name, "red");
  assert.equal(parseColor("#123456").name, undefined);
});

test("parseColor: alias hexes resolve to first name (aqua before cyan)", () => {
  assert.equal(parseColor("cyan").hex, "#00ffff");
  assert.equal(parseColor("cyan").name, "aqua");
});

test("parseColor: unknown name still throws", () => {
  assert.throws(() => parseColor("notacolor"), InputError);
});

test("parseColor: prototype-chain keys are not color names", () => {
  assert.throws(() => parseColor("__proto__"), InputError);
  assert.throws(() => parseColor("constructor"), InputError);
  assert.throws(() => parseColor("toString"), InputError);
});

test("relatedColors: red", () => {
  const related = relatedColors(parseColor("#ff0000"));
  assert.deepEqual(related.shades, ["#990000", "#330000"]);
  assert.deepEqual(related.tints, ["#ff6666", "#ffcccc"]);
  assert.equal(related.complement, "#00ffff");
});

test("relatedColors: white clamps tint lightness at 100", () => {
  const related = relatedColors(parseColor("#ffffff"));
  assert.deepEqual(related.tints, ["#ffffff", "#ffffff"]);
  assert.deepEqual(related.shades, ["#cccccc", "#999999"]);
});

test("searchColors: prefix matches rank before substring", () => {
  const results = searchColors("cor");
  assert.deepEqual(
    results.map((r) => r.name),
    ["coral", "cornflowerblue", "cornsilk", "lightcoral"],
  );
  assert.equal(results[0]!.hex, "#ff7f50");
});

test("searchColors: capped at 25", () => {
  assert.equal(searchColors("a").length, 25);
});

test("searchColors: honors a custom limit", () => {
  assert.equal(searchColors("a", 5).length, 5); // "a" matches far more than 5
  assert.ok(searchColors("a").length > 5); // default (25) confirms the 5 really capped it
});

test("searchColors: value-shaped input gets no suggestions", () => {
  assert.deepEqual(searchColors("#ff"), []);
  assert.deepEqual(searchColors("rgb(1,2,3)"), []);
  assert.deepEqual(searchColors("hsl(0,0,0)"), []);
  assert.deepEqual(searchColors("face"), []); // plausible partial hex
  assert.deepEqual(searchColors(""), []);
});

test("searchColors: hex-looking name prefixes still suggest", () => {
  assert.deepEqual(
    searchColors("cad").map((r) => r.name),
    ["cadetblue"],
  );
  assert.deepEqual(
    searchColors("dee").map((r) => r.name),
    ["deeppink", "deepskyblue"],
  );
});

test("parseColor: trims and lowercases web-form input", () => {
  assert.equal(parseColor("  #FF0000 ").hex, "#ff0000");
  assert.equal(parseColor("RED").hex, "#ff0000");
  assert.equal(parseColor(" Rgb(0, 128, 255) ").hex, "#0080ff");
});

test("CSS_COLORS: every entry round-trips through parseColor and has a name", () => {
  for (const [name, hex] of Object.entries(CSS_COLORS)) {
    const info = parseColor(hex);
    assert.equal(info.hex, hex, name);
    assert.ok(info.name !== undefined, `${name} resolves to some name`);
  }
  // Alias ordering: first name in the table wins (moved from the bot).
  assert.equal(parseColor("cyan").name, "aqua");
});
