import type { RangeCheck } from "../text/semvertools.js";

export function renderCheck(r: RangeCheck): string {
  const verdict = r.satisfied ? "✅ satisfies" : "❌ does not satisfy";
  return `\`${r.version}\` ${verdict} \`${r.range}\`\n-# range expands to \`${r.expanded}\``;
}
