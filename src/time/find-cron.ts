import { explainCron } from "./timetools.js";

const MAX_SCAN_CHARS = 2000;
const MAX_ATTEMPTS = 40; // each attempt runs a cronstrue + cron-parser parse

/**
 * Find the first substring that parses as a cron expression. Per line
 * (fence markers stripped), slide 6-token windows before 5-token ones —
 * a 6-field cron's first five tokens can wrongly parse as a 5-field cron.
 */
export function findCron(text: string): string | null {
  const lines = text
    .slice(0, MAX_SCAN_CHARS)
    .split("\n")
    .map((line) => line.replace(/^```[a-z]*/i, "").replace(/```$/, "").trim())
    .filter((line) => line.length > 0);
  let attempts = 0;
  for (const line of lines) {
    const tokens = line.split(/\s+/);
    for (const size of [6, 5] as const) {
      for (let start = 0; start + size <= tokens.length; start++) {
        if (attempts >= MAX_ATTEMPTS) return null;
        attempts++;
        const candidate = tokens.slice(start, start + size).join(" ");
        try {
          explainCron(candidate);
          return candidate;
        } catch {
          /* not a cron — keep sliding */
        }
      }
    }
  }
  return null;
}
