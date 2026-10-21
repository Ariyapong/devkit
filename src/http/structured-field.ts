// A small subset of RFC 8941 structured fields: lists of strings with string parameters,
// and boolean or string items. Anything outside that subset is skipped, never thrown on.

export interface SfMember {
  value: string;
  params: Record<string, string>;
}

// Reads a quoted string starting at text[start] (a double quote). Returns the decoded string and
// the index after the closing quote, or null when the string is unterminated or badly escaped.
function readQuoted(text: string, start: number): { value: string; end: number } | null {
  let out = "";
  let i = start + 1;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === "\\") {
      const next = text.charAt(i + 1);
      if (next !== '"' && next !== "\\") return null;
      out += next;
      i += 2;
    } else if (ch === '"') {
      return { value: out, end: i + 1 };
    } else {
      out += ch;
      i += 1;
    }
  }
  return null;
}

// Splits on commas that sit outside quoted strings.
function splitMembers(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === '"') {
      const q = readQuoted(text, i);
      if (q === null) break;
      i = q.end;
    } else {
      if (ch === ",") {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
      i += 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

const KEY = /^[a-z*][a-z0-9_.*-]*$/;

function parseMember(raw: string): SfMember | null {
  const text = raw.trim();
  if (!text.startsWith('"')) return null;
  const item = readQuoted(text, 0);
  if (item === null) return null;
  const params: Record<string, string> = {};
  let i = item.end;
  while (i < text.length) {
    while (text.charAt(i) === " " || text.charAt(i) === "\t") i += 1;
    if (i >= text.length) break;
    if (text.charAt(i) !== ";") return null;
    i += 1;
    while (text.charAt(i) === " " || text.charAt(i) === "\t") i += 1;
    let j = i;
    while (j < text.length && text.charAt(j) !== "=" && text.charAt(j) !== ";") j += 1;
    const key = text.slice(i, j);
    if (!KEY.test(key)) return null;
    if (text.charAt(j) !== "=") {
      i = j; // a bare key is boolean true in RFC 8941, which this subset does not keep
      continue;
    }
    j += 1;
    if (text.charAt(j) === '"') {
      const q = readQuoted(text, j);
      if (q === null) return null;
      params[key] = q.value;
      i = q.end;
    } else {
      let k = j;
      while (k < text.length && text.charAt(k) !== ";") k += 1;
      i = k; // a non-string parameter value is outside the subset and is dropped
    }
  }
  return { value: item.value, params };
}

export function parseSfList(text: string): { value: string; params: Record<string, string> }[] {
  const members: SfMember[] = [];
  for (const part of splitMembers(text)) {
    const member = parseMember(part);
    if (member !== null) members.push(member);
  }
  return members;
}

export function parseSfItem(text: string): string | boolean | null {
  const t = text.trim();
  if (t === "?1") return true;
  if (t === "?0") return false;
  if (t.startsWith('"')) {
    const q = readQuoted(t, 0);
    if (q !== null && q.end === t.length) return q.value;
  }
  return null;
}
