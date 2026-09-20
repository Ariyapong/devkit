/**
 * Strip ANSI escape sequences — both the raw ESC byte forms (attachments,
 * files with color forced) and the literal spellings that survive copy-paste
 * into Discord. Control characters are built via fromCharCode and literal
 * spellings via the BS constant: this file must never contain a raw control
 * byte or a single-backslash escape in a regex literal (escape-flattening has
 * corrupted such patterns twice in this repo, once git-binary).
 */
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const BS = "\\\\"; // one literal backslash, escaped for a regex pattern string

// Raw forms: CSI (params + intermediates + final byte) and OSC (BEL or ESC\ terminated).
// Intermediates (space through /) are only allowed if preceded by params; otherwise
// a bare "space + letter" in prose would incorrectly match as an escape sequence.
const RAW_CSI = `${ESC}\\[(?:[0-9;:?]+[ -/]*)?[@-~]`;
const RAW_OSC = `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}${BS})`;
// Literal spellings: backslash-x1b, backslash-033, backslash-u001b, or caret-bracket,
// each still requires a plausible CSI body ending in a final byte, so bare "^[[" never fires.
const LITERAL_PREFIX = `(?:${BS}x1[bB]|${BS}033|${BS}u001[bB]|\\^\\[)`;
const LITERAL_CSI = `${LITERAL_PREFIX}\\[(?:[0-9;:?]+[ -/]*)?[@-~]`;

const ANSI_RE = new RegExp(`${RAW_CSI}|${RAW_OSC}|${LITERAL_CSI}`, "g");

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}
