import { InputError } from "../errors.js";

export type CaseKey =
  | "camel"
  | "pascal"
  | "snake"
  | "kebab"
  | "constant"
  | "dot"
  | "title"
  | "space";

export const CASE_ORDER: { key: CaseKey; label: string }[] = [
  { key: "camel", label: "camelCase" },
  { key: "pascal", label: "PascalCase" },
  { key: "snake", label: "snake_case" },
  { key: "kebab", label: "kebab-case" },
  { key: "constant", label: "CONSTANT_CASE" },
  { key: "dot", label: "dot.case" },
  { key: "title", label: "Title Case" },
  { key: "space", label: "lower space" },
];

type Cls = "U" | "L" | "O" | "D" | "S";

function classify(ch: string): Cls {
  if (/\p{Lu}|\p{Lt}/u.test(ch)) return "U"; // uppercase / titlecase letter
  if (/\p{Ll}/u.test(ch)) return "L"; // lowercase letter
  if (/\p{N}/u.test(ch)) return "D"; // digit / number
  if (/\p{L}|\p{M}/u.test(ch)) return "O"; // caseless letter or combining mark
  return "S"; // separator / everything else
}

/**
 * Split an identifier/phrase into words. Boundaries: separators break;
 * lower/other/digit → UPPER breaks (fooBar, 名前Value, user2Id); an acronym
 * run followed by lowercase breaks before its last capital (XMLHttp → XML|Http).
 * Letter↔digit otherwise stays glued (sha256, utf8, i18n survive).
 */
export function tokenizeWords(input: string): string[] {
  const chars = [...input]; // codepoint-aware
  const classes = chars.map(classify);
  const words: string[] = [];
  let cur = "";
  for (let i = 0; i < chars.length; i++) {
    const cls = classes[i]!;
    if (cls === "S") {
      if (cur) {
        words.push(cur);
        cur = "";
      }
      continue;
    }
    if (cur) {
      const prev = classes[i - 1]!; // guaranteed non-S: separators reset `cur`
      const next = i + 1 < classes.length ? classes[i + 1] : undefined;
      let boundary = false;
      if (cls === "U" && (prev === "L" || prev === "O" || prev === "D")) boundary = true;
      else if (cls === "U" && prev === "U" && next === "L") boundary = true;
      if (boundary) {
        words.push(cur);
        cur = "";
      }
    }
    cur += chars[i];
  }
  if (cur) words.push(cur);
  if (words.length === 0) {
    throw new InputError("Nothing to convert — enter an identifier or phrase.");
  }
  return words;
}

/** Titlecase one word: first codepoint upper, remainder lower (down-cases acronyms). */
function title(word: string): string {
  const cps = [...word];
  if (cps.length === 0) return word;
  return cps[0]!.toUpperCase() + cps.slice(1).join("").toLowerCase();
}

function render(words: string[], key: CaseKey): string {
  switch (key) {
    case "camel":
      return words.map((w, i) => (i === 0 ? w.toLowerCase() : title(w))).join("");
    case "pascal":
      return words.map(title).join("");
    case "snake":
      return words.map((w) => w.toLowerCase()).join("_");
    case "kebab":
      return words.map((w) => w.toLowerCase()).join("-");
    case "constant":
      return words.map((w) => w.toUpperCase()).join("_");
    case "dot":
      return words.map((w) => w.toLowerCase()).join(".");
    case "title":
      return words.map(title).join(" ");
    case "space":
      return words.map((w) => w.toLowerCase()).join(" ");
  }
}

/** Convert to a single target case. */
export function convertCase(input: string, target: CaseKey): string {
  return render(tokenizeWords(input.normalize("NFC")), target);
}

/** Convert to every supported case, in display order. */
export function allCases(input: string): { key: CaseKey; label: string; value: string }[] {
  const words = tokenizeWords(input.normalize("NFC"));
  return CASE_ORDER.map(({ key, label }) => ({ key, label, value: render(words, key) }));
}
