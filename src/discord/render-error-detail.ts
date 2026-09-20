import type { ErrorDetail } from "../errors.js";

/**
 * The Discord half of a located error: optional position line, then the
 * excerpt in a fence. `message + renderErrorDetail(detail)` reproduces the
 * bot's pre-extraction reply byte-for-byte for both producers (JSON puts its
 * position on this line; YAML keeps it inside `message` and sets none).
 * Never widen the fence past three backticks — Discord treats a fourth as
 * content.
 */
export function renderErrorDetail(detail: ErrorDetail): string {
  const position = detail.positionLine === undefined ? "" : `\n${detail.positionLine}`;
  return `${position}\n\`\`\`\n${detail.lines.join("\n")}\n\`\`\``;
}
