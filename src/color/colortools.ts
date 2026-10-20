import { InputError } from "../errors.js";
import { CSS_COLORS, NAME_BY_HEX } from "./colornames.js";

// ColorInfo, rgbToHsl (NOT exported), hslToRgb (exported), parseColor,
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
  /** Alpha 0-1; present only when the input carried one (`rgba()`, `/ a`, `#rrggbbaa`, ...). */
  alpha?: number;
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

const FORMAT_ERROR =
  'Use "#rrggbb", "#rgb", "rgb(r, g, b)", "hsl(h, s%, l%)", or a CSS color name like "coral".';
const HEX_RE = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const FUNCTION_RE = /^(rgba?|hsla?)\((.*)\)$/;
const NUMBER_RE = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(%|deg)?$/;

interface Token {
  value: number;
  unit: "" | "%" | "deg";
}

function toToken(text: string): Token | undefined {
  const m = NUMBER_RE.exec(text);
  if (!m) return undefined;
  return { value: Number(m[1]), unit: (m[2] ?? "") as Token["unit"] };
}

/**
 * Splits a function body into three components and an optional alpha:
 * `a, b, c[, alpha]` (legacy commas) or `a b c[ / alpha]` (space syntax).
 * Returns undefined when the shape or any token is malformed.
 */
function tokenize(inner: string): { parts: Token[]; alpha: Token | undefined } | undefined {
  const [body = "", slashAlpha, ...extra] = inner.split("/");
  if (extra.length > 0) return undefined;
  const commas = body.includes(",");
  if (commas && slashAlpha !== undefined) return undefined;
  const raw = commas ? body.split(",").map((p) => p.trim()) : body.trim().split(/\s+/);
  let alphaText = slashAlpha?.trim();
  if (commas && raw.length === 4) alphaText = raw.pop();
  if (raw.length !== 3) return undefined;
  const parts: Token[] = [];
  for (const text of raw) {
    const token = toToken(text);
    if (!token) return undefined;
    parts.push(token);
  }
  if (alphaText === undefined) return { parts, alpha: undefined };
  const alpha = toToken(alphaText);
  if (!alpha || alpha.unit === "deg") return undefined;
  return { parts, alpha };
}

/** rgb()/rgba()/hsl()/hsla(); undefined when malformed, throws on out-of-range values. */
function parseFunction(
  kind: string,
  inner: string,
): { r: number; g: number; b: number; alpha: number | undefined } | undefined {
  const tokens = tokenize(inner);
  if (!tokens) return undefined;
  const [first, second, third] = tokens.parts as [Token, Token, Token];
  let r: number, g: number, b: number;
  if (kind.startsWith("rgb")) {
    if (tokens.parts.some((p) => p.unit === "deg" || p.value < 0)) return undefined;
    const channel = (p: Token) => (p.unit === "%" ? (p.value / 100) * 255 : p.value);
    const [rc, gc, bc] = [channel(first), channel(second), channel(third)];
    if (rc > 255 || gc > 255 || bc > 255) {
      throw new InputError("RGB components must be 0-255.");
    }
    [r, g, b] = [Math.round(rc), Math.round(gc), Math.round(bc)];
  } else {
    if (first.unit === "%") return undefined;
    if (second.unit === "deg" || third.unit === "deg") return undefined;
    if (second.value < 0 || third.value < 0) return undefined;
    if (second.value > 100 || third.value > 100) {
      throw new InputError("HSL saturation and lightness must be 0-100.");
    }
    ({ r, g, b } = hslToRgb(first.value, second.value, third.value));
  }
  const a = tokens.alpha;
  if (!a) return { r, g, b, alpha: undefined };
  const max = a.unit === "%" ? 100 : 1;
  if (a.value < 0 || a.value > max) throw new InputError("Alpha must be 0-1 or 0%-100%.");
  return { r, g, b, alpha: a.value / max };
}

export function parseColor(value: string): ColorInfo {
  const input = value.trim().toLowerCase();
  const named = Object.hasOwn(CSS_COLORS, input) ? CSS_COLORS[input] : undefined;
  if (named) return parseColor(named); // one-level recursion into the hex6 path

  let r: number, g: number, b: number;
  let alpha: number | undefined;

  const hexMatch = HEX_RE.exec(input);
  const fn = FUNCTION_RE.exec(input);
  const parsed = fn ? parseFunction(fn[1]!, fn[2]!) : undefined;

  if (input === "transparent") {
    [r, g, b, alpha] = [0, 0, 0, 0];
  } else if (hexMatch) {
    let v = hexMatch[1]!;
    if (v.length <= 4) v = [...v].map((c) => c + c).join("");
    r = parseInt(v.slice(0, 2), 16);
    g = parseInt(v.slice(2, 4), 16);
    b = parseInt(v.slice(4, 6), 16);
    if (v.length === 8) alpha = parseInt(v.slice(6, 8), 16) / 255;
  } else if (parsed) {
    ({ r, g, b, alpha } = parsed);
  } else {
    throw new InputError(FORMAT_ERROR);
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
    ...(alpha === undefined ? {} : { alpha }),
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
