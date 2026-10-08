import { InputError } from "../errors.js";
import { CSS_COLORS, NAME_BY_HEX } from "./colornames.js";

// ColorInfo, rgbToHsl (NOT exported), hslToRgb (exported), HSL_RE, parseColor,
// relatedColors, searchColors — moved verbatim from the bot's texttools.ts.

export interface ColorInfo {
  hex: string;
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
  int: number;
  /** Exact CSS color name for this hex, when one exists. */
  name?: string;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = s / 100;
  const ln = l / 100;
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const channel = (t: number): number => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return {
    r: Math.round(channel(hn + 1 / 3) * 255),
    g: Math.round(channel(hn) * 255),
    b: Math.round(channel(hn - 1 / 3) * 255),
  };
}

const HSL_RE = /^hsl\(\s*(-?\d{1,4})\s*,\s*(\d{1,3})\s*%?\s*,\s*(\d{1,3})\s*%?\s*\)$/;

export function parseColor(value: string): ColorInfo {
  const input = value.trim().toLowerCase();
  const named = Object.hasOwn(CSS_COLORS, input) ? CSS_COLORS[input] : undefined;
  if (named) return parseColor(named); // one-level recursion into the hex6 path

  let r: number, g: number, b: number;

  const hex6 = /^#?([0-9a-f]{6})$/.exec(input);
  const hex3 = /^#?([0-9a-f]{3})$/.exec(input);
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(input);
  const hsl = HSL_RE.exec(input);

  if (hex6) {
    const v = hex6[1]!;
    r = parseInt(v.slice(0, 2), 16);
    g = parseInt(v.slice(2, 4), 16);
    b = parseInt(v.slice(4, 6), 16);
  } else if (hex3) {
    const v = hex3[1]!;
    r = parseInt(v[0]! + v[0]!, 16);
    g = parseInt(v[1]! + v[1]!, 16);
    b = parseInt(v[2]! + v[2]!, 16);
  } else if (rgb) {
    r = Number(rgb[1]);
    g = Number(rgb[2]);
    b = Number(rgb[3]);
    if (r > 255 || g > 255 || b > 255) {
      throw new InputError("RGB components must be 0-255.");
    }
  } else if (hsl) {
    const s = Number(hsl[2]);
    const l = Number(hsl[3]);
    if (s > 100 || l > 100) {
      throw new InputError("HSL saturation and lightness must be 0-100.");
    }
    ({ r, g, b } = hslToRgb(Number(hsl[1]), s, l));
  } else {
    throw new InputError(
      'Use "#rrggbb", "#rgb", "rgb(r, g, b)", "hsl(h, s%, l%)", or a CSS color name like "coral".',
    );
  }

  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  const name = NAME_BY_HEX.get(hex);
  return {
    hex,
    r,
    g,
    b,
    ...rgbToHsl(r, g, b),
    int: (r << 16) + (g << 8) + b,
    ...(name ? { name } : {}),
  };
}

/** Shades (darker), tints (lighter), and the complementary color, as hex. */
export function relatedColors(info: ColorInfo): {
  shades: string[];
  tints: string[];
  complement: string;
} {
  const hexAt = (h: number, s: number, l: number): string => {
    const { r, g, b } = hslToRgb(h, s, l);
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };
  const clamp = (l: number) => Math.min(100, Math.max(0, l));
  return {
    shades: [
      hexAt(info.h, info.s, clamp(info.l - 20)),
      hexAt(info.h, info.s, clamp(info.l - 40)),
    ],
    tints: [
      hexAt(info.h, info.s, clamp(info.l + 20)),
      hexAt(info.h, info.s, clamp(info.l + 40)),
    ],
    complement: hexAt((info.h + 180) % 360, info.s, info.l),
  };
}

/** Color-name suggestions for autocomplete; silent for hex/rgb/hsl-shaped input. */
export function searchColors(
  query: string,
  limit = 25,
): { name: string; hex: string }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const looksLikeValue =
    q.startsWith("#") ||
    q.startsWith("rgb") ||
    q.startsWith("hsl");
  if (looksLikeValue) return [];
  const names = Object.keys(CSS_COLORS);
  const prefix = names.filter((name) => name.startsWith(q));
  const substring = names.filter((name) => !name.startsWith(q) && name.includes(q));
  return [...prefix, ...substring]
    .slice(0, limit)
    .map((name) => ({ name, hex: CSS_COLORS[name]! }));
}
