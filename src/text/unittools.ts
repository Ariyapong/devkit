import { InputError } from "../errors.js";

export interface Unit {
  key: string;
  name: string;
  symbol: string;
  toBase: number;
}
export interface Category {
  key: string;
  label: string;
  base: string;
  isOffset: boolean;
  units: Unit[];
  alsoShow: string[];
}

export const CATEGORIES: Category[] = [
  {
    key: "length", label: "Length", base: "m", isOffset: false,
    units: [
      { key: "nm", name: "nanometre", symbol: "nm", toBase: 1e-9 },
      { key: "um", name: "micrometre", symbol: "µm", toBase: 0.000001 },
      { key: "mm", name: "millimetre", symbol: "mm", toBase: 0.001 },
      { key: "cm", name: "centimetre", symbol: "cm", toBase: 0.01 },
      { key: "m", name: "metre", symbol: "m", toBase: 1 },
      { key: "km", name: "kilometre", symbol: "km", toBase: 1000 },
      { key: "in", name: "inch", symbol: "in", toBase: 0.0254 },
      { key: "ft", name: "foot", symbol: "ft", toBase: 0.3048 },
      { key: "yd", name: "yard", symbol: "yd", toBase: 0.9144 },
      { key: "mi", name: "mile", symbol: "mi", toBase: 1609.344 },
      { key: "nmi", name: "nautical mile", symbol: "nmi", toBase: 1852 },
    ],
    alsoShow: ["m", "km", "mi", "ft", "in"],
  },
  {
    key: "mass", label: "Mass", base: "kg", isOffset: false,
    units: [
      { key: "mg", name: "milligram", symbol: "mg", toBase: 0.000001 },
      { key: "g", name: "gram", symbol: "g", toBase: 0.001 },
      { key: "kg", name: "kilogram", symbol: "kg", toBase: 1 },
      { key: "t", name: "tonne", symbol: "t", toBase: 1000 },
      { key: "oz", name: "ounce (avoirdupois)", symbol: "oz", toBase: 0.028349523125 },
      { key: "lb", name: "pound (avoirdupois)", symbol: "lb", toBase: 0.45359237 },
      { key: "st", name: "stone", symbol: "st", toBase: 6.35029318 },
    ],
    alsoShow: ["g", "kg", "lb", "oz"],
  },
  {
    key: "temperature", label: "Temperature", base: "K", isOffset: true,
    units: [
      { key: "C", name: "Celsius", symbol: "°C", toBase: 1 },
      { key: "F", name: "Fahrenheit", symbol: "°F", toBase: 1 },
      { key: "K", name: "Kelvin", symbol: "K", toBase: 1 },
      { key: "R", name: "Rankine", symbol: "°R", toBase: 1 },
    ],
    alsoShow: ["C", "F", "K"],
  },
  {
    key: "volume", label: "Volume", base: "l", isOffset: false,
    units: [
      { key: "ml", name: "Milliliter", symbol: "mL", toBase: 0.001 },
      { key: "l", name: "Liter", symbol: "L", toBase: 1 },
      { key: "cm3", name: "Cubic centimeter", symbol: "cm³", toBase: 0.001 },
      { key: "m3", name: "Cubic meter", symbol: "m³", toBase: 1000 },
      { key: "tsp_us", name: "Teaspoon (US)", symbol: "tsp", toBase: 0.00492892159375 },
      { key: "tbsp_us", name: "Tablespoon (US)", symbol: "tbsp", toBase: 0.01478676478125 },
      { key: "floz_us", name: "Fluid ounce (US)", symbol: "fl oz", toBase: 0.0295735295625 },
      { key: "cup_us", name: "Cup (US customary)", symbol: "cup", toBase: 0.2365882365 },
      { key: "pt_us", name: "Pint (US liquid)", symbol: "pt", toBase: 0.473176473 },
      { key: "qt_us", name: "Quart (US liquid)", symbol: "qt", toBase: 0.946352946 },
      { key: "gal_us", name: "Gallon (US liquid)", symbol: "gal", toBase: 3.785411784 },
    ],
    alsoShow: ["ml", "l", "gal_us", "floz_us"],
  },
  {
    key: "time", label: "Time", base: "s", isOffset: false,
    units: [
      { key: "ms", name: "Millisecond", symbol: "ms", toBase: 0.001 },
      { key: "s", name: "Second", symbol: "s", toBase: 1 },
      { key: "min", name: "Minute", symbol: "min", toBase: 60 },
      { key: "h", name: "Hour", symbol: "h", toBase: 3600 },
      { key: "day", name: "Day", symbol: "d", toBase: 86400 },
      { key: "week", name: "Week", symbol: "wk", toBase: 604800 },
      { key: "year", name: "Year (Julian)", symbol: "yr", toBase: 31557600 },
    ],
    alsoShow: ["s", "min", "h", "day"],
  },
  {
    key: "angle", label: "Angle", base: "deg", isOffset: false,
    units: [
      { key: "deg", name: "Degree", symbol: "°", toBase: 1 },
      { key: "rad", name: "Radian", symbol: "rad", toBase: 57.29577951308232 },
      { key: "grad", name: "Gradian (gon)", symbol: "grad", toBase: 0.9 },
      { key: "arcmin", name: "Arcminute", symbol: "′", toBase: 0.016666666666666666 },
      { key: "arcsec", name: "Arcsecond", symbol: "″", toBase: 0.0002777777777777778 },
      { key: "turn", name: "Turn (revolution)", symbol: "turn", toBase: 360 },
    ],
    alsoShow: ["deg", "rad", "turn"],
  },
  {
    key: "data", label: "Data storage", base: "B", isOffset: false,
    units: [
      { key: "bit", name: "bit", symbol: "bit", toBase: 0.125 },
      { key: "B", name: "byte", symbol: "B", toBase: 1 },
      { key: "kB", name: "kilobyte", symbol: "kB", toBase: 1000 },
      { key: "MB", name: "megabyte", symbol: "MB", toBase: 1000000 },
      { key: "GB", name: "gigabyte", symbol: "GB", toBase: 1000000000 },
      { key: "TB", name: "terabyte", symbol: "TB", toBase: 1000000000000 },
      { key: "PB", name: "petabyte", symbol: "PB", toBase: 1000000000000000 },
      { key: "KiB", name: "kibibyte", symbol: "KiB", toBase: 1024 },
      { key: "MiB", name: "mebibyte", symbol: "MiB", toBase: 1048576 },
      { key: "GiB", name: "gibibyte", symbol: "GiB", toBase: 1073741824 },
      { key: "TiB", name: "tebibyte", symbol: "TiB", toBase: 1099511627776 },
      { key: "PiB", name: "pebibyte", symbol: "PiB", toBase: 1125899906842624 },
    ],
    alsoShow: ["B", "KiB", "MiB", "GiB"],
  },
  {
    key: "speed", label: "Speed", base: "m_s", isOffset: false,
    units: [
      { key: "m_s", name: "meter per second", symbol: "m/s", toBase: 1 },
      { key: "km_h", name: "kilometer per hour", symbol: "km/h", toBase: 0.2777777777777778 },
      { key: "mph", name: "mile per hour", symbol: "mph", toBase: 0.44704 },
      { key: "ft_s", name: "foot per second", symbol: "ft/s", toBase: 0.3048 },
      { key: "kn", name: "knot", symbol: "kn", toBase: 0.5144444444444445 },
    ],
    alsoShow: ["m_s", "km_h", "mph", "kn"],
  },
  {
    key: "area", label: "Area", base: "m2", isOffset: false,
    units: [
      { key: "mm2", name: "square millimeter", symbol: "mm²", toBase: 0.000001 },
      { key: "cm2", name: "square centimeter", symbol: "cm²", toBase: 0.0001 },
      { key: "m2", name: "square meter", symbol: "m²", toBase: 1 },
      { key: "km2", name: "square kilometer", symbol: "km²", toBase: 1000000 },
      { key: "ha", name: "hectare", symbol: "ha", toBase: 10000 },
      { key: "in2", name: "square inch", symbol: "in²", toBase: 0.00064516 },
      { key: "ft2", name: "square foot", symbol: "ft²", toBase: 0.09290304 },
      { key: "yd2", name: "square yard", symbol: "yd²", toBase: 0.83612736 },
      { key: "ac", name: "acre", symbol: "ac", toBase: 4046.8564224 },
      { key: "mi2", name: "square mile", symbol: "mi²", toBase: 2589988.110336 },
    ],
    alsoShow: ["m2", "km2", "ft2", "ac"],
  },
  {
    key: "pressure", label: "Pressure", base: "Pa", isOffset: false,
    units: [
      { key: "Pa", name: "pascal", symbol: "Pa", toBase: 1 },
      { key: "kPa", name: "kilopascal", symbol: "kPa", toBase: 1000 },
      { key: "bar", name: "bar", symbol: "bar", toBase: 100000 },
      { key: "atm", name: "standard atmosphere", symbol: "atm", toBase: 101325 },
      { key: "psi", name: "pound-force per square inch", symbol: "psi", toBase: 6894.757293168361 },
      { key: "mmHg", name: "millimetre of mercury (conventional)", symbol: "mmHg", toBase: 133.322387415 },
    ],
    alsoShow: ["Pa", "bar", "psi", "atm"],
  },
  {
    key: "energy", label: "Energy", base: "J", isOffset: false,
    units: [
      { key: "J", name: "joule", symbol: "J", toBase: 1 },
      { key: "kJ", name: "kilojoule", symbol: "kJ", toBase: 1000 },
      { key: "cal", name: "calorie (thermochemical)", symbol: "cal", toBase: 4.184 },
      { key: "kcal", name: "kilocalorie (thermochemical)", symbol: "kcal", toBase: 4184 },
      { key: "Wh", name: "watt-hour", symbol: "Wh", toBase: 3600 },
      { key: "kWh", name: "kilowatt-hour", symbol: "kWh", toBase: 3600000 },
      { key: "BTU", name: "British thermal unit (International Table)", symbol: "BTU", toBase: 1055.05585262 },
    ],
    alsoShow: ["J", "kJ", "kcal", "kWh"],
  },
  {
    key: "datarate", label: "Data rate", base: "bit/s", isOffset: false,
    units: [
      { key: "bps", name: "bit per second", symbol: "bit/s", toBase: 1 },
      { key: "kbps", name: "kilobit per second", symbol: "kbit/s", toBase: 1000 },
      { key: "Mbps", name: "megabit per second", symbol: "Mbit/s", toBase: 1000000 },
      { key: "Gbps", name: "gigabit per second", symbol: "Gbit/s", toBase: 1000000000 },
      { key: "Bps", name: "byte per second", symbol: "B/s", toBase: 8 },
      { key: "kBps", name: "kilobyte per second", symbol: "kB/s", toBase: 8000 },
      { key: "MBps", name: "megabyte per second", symbol: "MB/s", toBase: 8000000 },
      { key: "GBps", name: "gigabyte per second", symbol: "GB/s", toBase: 8000000000 },
    ],
    alsoShow: ["Mbps", "MBps"],
  },
];

// Temperature is affine, not multiplicative — route through Kelvin.
const toKelvin = (key: string, v: number): number =>
  key === "C" ? v + 273.15 : key === "F" ? (v - 32) / 1.8 + 273.15 : key === "K" ? v : v / 1.8; // R
const fromKelvin = (key: string, v: number): number =>
  key === "C" ? v - 273.15 : key === "F" ? (v - 273.15) * 1.8 + 32 : key === "K" ? v : v * 1.8; // R

export function convert(categoryKey: string, fromKey: string, toKey: string, value: number): number {
  if (!Number.isFinite(value)) throw new InputError("Value must be a finite number.");
  const cat = CATEGORIES.find((c) => c.key === categoryKey);
  if (!cat) throw new InputError(`Unknown category: ${categoryKey}.`);
  const from = cat.units.find((u) => u.key === fromKey);
  const to = cat.units.find((u) => u.key === toKey);
  if (!from) throw new InputError(`Unknown ${cat.label} unit: ${fromKey}.`);
  if (!to) throw new InputError(`Unknown ${cat.label} unit: ${toKey}.`);
  if (cat.isOffset) {
    const k = toKelvin(fromKey, value);
    if (k < -1e-9) throw new InputError("Below absolute zero — that temperature can't exist.");
    return fromKelvin(toKey, k);
  }
  return (value * from.toBase) / to.toBase;
}

/** Smart formatting: exact integers in full, 6 sig figs otherwise, exponential for extremes. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new InputError("Result is too large to display.");
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (Number.isInteger(n) && abs <= Number.MAX_SAFE_INTEGER) return String(n);
  if (abs >= 1e12 || abs < 1e-4) {
    return n.toExponential(5).replace(/(\.\d*?)0+e/, "$1e").replace(/\.e/, "e").replace("e+", "e");
  }
  return String(Number(n.toPrecision(6)));
}

export function renderConversion(categoryKey: string, fromKey: string, toKey: string, value: number): string {
  const result = convert(categoryKey, fromKey, toKey, value); // validates + guards first
  const cat = CATEGORIES.find((c) => c.key === categoryKey)!;
  const from = cat.units.find((u) => u.key === fromKey)!;
  const to = cat.units.find((u) => u.key === toKey)!;
  const base = cat.isOffset ? toKelvin(fromKey, value) : value * from.toBase;
  const also = cat.alsoShow
    .filter((k) => k !== fromKey && k !== toKey)
    .map((k) => {
      const u = cat.units.find((x) => x.key === k)!;
      const v = cat.isOffset ? fromKelvin(k, base) : base / u.toBase;
      return `${formatNumber(v)} ${u.symbol}`;
    });
  const head = `${formatNumber(value)} ${from.symbol} = **${formatNumber(result)} ${to.symbol}**`;
  return also.length ? `${head}\n\nAlso: ${also.join(" · ")}` : head;
}
