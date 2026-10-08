import type { ColorInfo } from "./colortools.js";
import { hslToRgb } from "./colortools.js";

type Rgb = { r: number; g: number; b: number };

/** WCAG relative luminance (sRGB linearization), 0 (black) to 1 (white). */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number): number => {
    const cs = c / 255;
    return cs <= 0.04045 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1..21. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a.r, a.g, a.b);
  const lb = relativeLuminance(b.r, b.g, b.b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface WcagVerdicts {
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
}

export function wcagVerdicts(ratio: number): WcagVerdicts {
  return {
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,
    aaaLarge: ratio >= 4.5,
  };
}

/**
 * Smallest lightness nudge of fg (hue/sat kept) that reaches AA normal
 * (4.5:1) against bg. Ties (±same delta both pass) prefer the higher ratio.
 * Always succeeds: black or white passes 4.5:1 against any background.
 *
 * Precondition: fg/bg are valid parsed colors, so fg.l ∈ [0, 100] and bg has
 * real r/g/b. That range is what lets l reach 0 (black) or 100 (white) within
 * the delta ≤ 100 loop, which is why the final throw is unreachable.
 */
export function nearestAaPass(fg: ColorInfo, bg: ColorInfo): { hex: string; ratio: number } {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  for (let delta = 1; delta <= 100; delta++) {
    let best: { hex: string; ratio: number } | null = null;
    for (const l of [fg.l - delta, fg.l + delta]) {
      if (l < 0 || l > 100) continue;
      const rgb = hslToRgb(fg.h, fg.s, l);
      const ratio = contrastRatio(rgb, bg);
      if (ratio >= 4.5 && (best === null || ratio > best.ratio)) {
        best = { hex: `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`, ratio };
      }
    }
    if (best) return best;
  }
  throw new Error("unreachable: black or white always passes AA");
}
