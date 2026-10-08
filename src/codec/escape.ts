import { InputError } from "../errors.js";

/** Raw text → the body of a JSON string literal (no surrounding quotes). */
export function escapeJsonString(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

const C0_ESCAPE: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };

/**
 * JSON-escaped body → raw text. One left-to-right scan builds a parseable
 * body: a backslash and the character after it are copied verbatim (so an
 * existing `\"` is never re-escaped), a raw `"` becomes `\"`, a raw C0
 * control becomes its JSON escape, everything else is copied. The only way
 * the parse can then fail is a bad backslash sequence.
 */
export function unescapeJsonString(text: string): string {
  let body = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\") {
      body += ch + (text[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') {
      body += '\\"';
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      body += C0_ESCAPE[ch] ?? `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    body += ch;
  }
  try {
    return JSON.parse(`"${body}"`) as string;
  } catch {
    throw new InputError("Invalid escape sequence.");
  }
}

/** Escapes every character that is special inside a RegExp pattern. */
export function escapeRegex(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}
