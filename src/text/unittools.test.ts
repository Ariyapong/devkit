import { test } from "node:test";
import assert from "node:assert/strict";
import { convert, formatNumber, renderConversion, CATEGORIES } from "./unittools.js";
import { InputError } from "../errors.js";

const near = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol || Math.abs(a - b) / Math.abs(b) <= tol, `${a} !~ ${b}`);

test("reference conversions per category", () => {
  near(convert("length", "mi", "km", 1), 1.609344);
  near(convert("length", "nmi", "m", 1), 1852);
  near(convert("mass", "lb", "kg", 1), 0.45359237);
  near(convert("mass", "st", "kg", 1), 6.35029318);
  near(convert("data", "GiB", "B", 1), 1073741824);
  near(convert("data", "B", "bit", 1), 8);
  near(convert("data", "MiB", "KiB", 1), 1024);
  near(convert("speed", "kn", "km_h", 1), 1.852);
  near(convert("area", "mi2", "ac", 1), 640);
  near(convert("volume", "gal_us", "floz_us", 1), 128);
  near(convert("volume", "gal_us", "l", 1), 3.785411784);
  near(convert("time", "year", "day", 1), 365.25);
  near(convert("angle", "turn", "arcsec", 1), 1296000);
  near(convert("pressure", "atm", "Pa", 1), 101325);
  near(convert("pressure", "psi", "Pa", 1), 6894.757293168);
  near(convert("energy", "kWh", "J", 1), 3600000);
  near(convert("energy", "BTU", "J", 1), 1055.05585262);
  near(convert("datarate", "MBps", "Mbps", 1), 8);
});

test("temperature offsets", () => {
  near(convert("temperature", "C", "F", 100), 212);
  near(convert("temperature", "F", "C", -40), -40);
  near(convert("temperature", "C", "K", 0), 273.15);
  near(convert("temperature", "R", "K", 491.67), 273.15);
});

test("absolute zero rejected", () => {
  assert.throws(() => convert("temperature", "C", "K", -300), InputError);
  assert.throws(() => convert("temperature", "F", "C", -500), InputError);
});

test("round trips", () => {
  const pairs: [string, string, string][] = [
    ["length", "mi", "nmi"],
    ["mass", "oz", "st"],
    ["pressure", "psi", "bar"],
    ["energy", "BTU", "kcal"],
    ["temperature", "C", "F"],
  ];
  for (const [c, a, b] of pairs) near(convert(c, b, a, convert(c, a, b, 7)), 7);
});

test("unknown unit / category / non-finite throw", () => {
  assert.throws(() => convert("length", "nope", "m", 1), InputError);
  assert.throws(() => convert("length", "m", "km", NaN), InputError);
  assert.throws(() => convert("nope", "m", "km", 1), InputError);
});

test("formatNumber", () => {
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(1073741824), "1073741824");
  assert.equal(formatNumber(640), "640");
  assert.equal(formatNumber(1.6093439999999999), "1.60934");
  assert.equal(formatNumber(0.1 + 0.2), "0.3");
  assert.equal(formatNumber(1e-12), "1e-12");
  assert.equal(formatNumber(1234567800000.5), "1.23457e12");
  assert.equal(formatNumber(convert("data", "PiB", "B", 1)), "1125899906842624");
});

test("renderConversion: head + also-show excludes from/to", () => {
  const body = renderConversion("length", "km", "mi", 5);
  assert.ok(body.startsWith("5 km = **3.10686 mi**"), body);
  const also = body.split("Also:")[1] ?? "";
  assert.ok(also.includes("5000 m"));
  assert.ok(also.includes("16404.2 ft"));
  assert.ok(!also.includes("km"), "km (from) should be excluded");
  assert.ok(!/\bmi\b/.test(also), "mi (to) should be excluded");
});

test("CATEGORIES shape: 12 categories, alsoShow keys valid", () => {
  assert.equal(CATEGORIES.length, 12);
  for (const c of CATEGORIES) {
    const keys = new Set(c.units.map((u) => u.key));
    for (const k of c.alsoShow) assert.ok(keys.has(k), `${c.key}: alsoShow ${k} missing`);
  }
});
