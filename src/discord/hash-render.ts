import type { HashAlgorithm, HashCheck } from "../codec/index.js";

/**
 * Verdict body for /codec hash with an `expected` value.
 *
 * Both values are inlined in backticks without escaping, which is safe here by
 * construction rather than by care: checkHash rejects anything outside
 * [0-9a-f], so neither string can contain a backtick and break out of the
 * span. That closes the fence-escape class recorded against the query/JWT
 * renderers, where the input alphabet is unrestricted.
 */
export function renderHashCheck(
  check: HashCheck,
  algorithm: HashAlgorithm,
  keyed = false,
): string {
  // The label must say which operation ran — an hmac-sha256 and a sha256 of
  // the same text are both 64 hex chars, so the digest alone cannot tell them
  // apart and a mismatch would be unreadable without this.
  const label = keyed ? `hmac-${algorithm}` : algorithm;
  if (check.match) {
    return `✅ **Match** — \`${label}\`\n\`${check.digest}\``;
  }
  const lines = [
    `❌ **No match** — \`${label}\``,
    `computed \`${check.digest}\``,
    `expected \`${check.expected}\``,
  ];
  // Only when the length points elsewhere — a same-length mismatch is a real
  // mismatch and saying anything more would be noise.
  if (check.lengthHint) {
    lines.push(
      // No article before the algorithm name: "a md5" and "an sha256" are both
      // wrong, and which one applies varies by algorithm.
      `-# That expected value is ${check.expected.length} hex chars — the length of \`${check.lengthHint}\`, not \`${label}\`.`,
    );
  }
  return lines.join("\n");
}
