/**
 * Structured companion to an InputError message. `lines` are the producer's
 * RENDERED excerpt rows exactly as a Discord fence would show them (gutter,
 * windowing ellipses and caret row included) — not raw source lines, because
 * the caret column after windowing and the gutter width are not
 * reconstructible from `position` alone. `position` indexes the ORIGINAL
 * input for consumers that highlight it. `positionLine` is the exact text a
 * producer wants on its own line before the excerpt (JSON: "  line 1,
 * column 8"); YAML keeps its position inside `message` and sets none.
 */
export interface ErrorDetail {
  kind: "excerpt";
  position?: { line: number; column: number };
  positionLine?: string;
  lines: string[];
  caretLine: number;
}

/**
 * Expected bad-input error. `message` is the reason text: Discord-free on
 * the package's side, but it MAY embed the user's payload verbatim (V8 echoes
 * offending JSON, newlines included) — consumers render it as text, never as
 * markup. `detail` carries position and excerpt when the producer has one.
 */
export class InputError extends Error {
  declare readonly detail?: ErrorDetail;

  constructor(message: string, detail?: ErrorDetail) {
    super(message);
    // The only assignment form exactOptionalPropertyTypes accepts: an absent
    // detail stays ABSENT, never `undefined`.
    if (detail !== undefined) this.detail = detail;
  }
}

/**
 * Log-safe rendering of an error. InputError messages embed user input
 * (JSON.parse snippets, regex patterns, YAML frames), so log only the class
 * name; for everything else keep the first line, capped, so log lines stay
 * one-line metadata-only.
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof InputError) return "InputError";
  const msg = error instanceof Error ? error.message : String(error);
  const firstLine = msg.split("\n", 1)[0] ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine;
}
