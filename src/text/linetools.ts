import { InputError } from "../errors.js";

export interface LineOps {
  trim?: boolean;
  dropBlank?: boolean;
  dedupe?: boolean;
  sort?: "asc" | "desc" | "natural" | "length";
  /** Applies to dedupe and to sort. */
  caseInsensitive?: boolean;
  reverse?: boolean;
  number?: boolean;
}

export const MAX_LINES_CHARS = 1_000_000;

/**
 * One pipeline, fixed order: trim → dropBlank → dedupe → sort → reverse →
 * number. Line endings normalise to "\n"; one trailing newline is dropped
 * (validateJsonl's rule) so a textarea ending in a newline has no phantom
 * blank line. The "en" collator is pinned so no environment locale is read.
 */
export function processLines(input: string, ops: LineOps): string {
  if (input.length > MAX_LINES_CHARS) {
    throw new InputError(`Too long — process at most ${MAX_LINES_CHARS} UTF-16 units (got ${input.length}).`);
  }
  const src =
    input.endsWith("\r\n") ? input.slice(0, -2)
    : input.endsWith("\n") ? input.slice(0, -1)
    : input;
  if (src === "") return "";
  let lines = src.split(/\r?\n/);
  const fold = (s: string) => (ops.caseInsensitive ? s.toLowerCase() : s);

  if (ops.trim) lines = lines.map((l) => l.trim());
  if (ops.dropBlank) lines = lines.filter((l) => l !== "");
  if (ops.dedupe) {
    const seen = new Set<string>();
    lines = lines.filter((l) => {
      const k = fold(l);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (ops.sort) {
    const indexed = lines.map((text, i) => ({ text, i }));
    let cmp: (a: string, b: string) => number;
    if (ops.sort === "natural") {
      const collator = new Intl.Collator("en", { numeric: true, sensitivity: ops.caseInsensitive ? "base" : "variant" });
      cmp = (a, b) => collator.compare(a, b);
    } else if (ops.sort === "length") {
      cmp = (a, b) => a.length - b.length;
    } else {
      const sign = ops.sort === "desc" ? -1 : 1;
      cmp = (a, b) => {
        const fa = fold(a);
        const fb = fold(b);
        return fa < fb ? -sign : fa > fb ? sign : 0;
      };
    }
    indexed.sort((a, b) => cmp(a.text, b.text) || a.i - b.i);
    lines = indexed.map((x) => x.text);
  }
  if (ops.reverse) lines.reverse();
  if (ops.number) {
    const width = String(lines.length).length;
    lines = lines.map((l, i) => `${String(i + 1).padStart(width)}  ${l}`);
  }
  return lines.join("\n");
}
