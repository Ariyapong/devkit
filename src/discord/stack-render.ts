import { stripAnsi } from "../debug/ansitools.js";
import { scanErrTokens } from "../debug/errcodes.js";
import { parseStackTrace } from "../debug/stack-parse.js";
import type { Frame, StackLanguage } from "../debug/stack-parse.js";

export interface StackTidy {
  language: StackLanguage;
  headline: string;
  topAppFrame: string | null;
  body: string;
  frameCount: number;
  collapsedCount: number;
}

const MAX_APP_FRAMES = 15;

function renderFrames(frames: Frame[]): { fence: string; collapsed: number } {
  const lines: string[] = [];
  let appShown = 0;
  let appOverflow = 0;
  let pendingFramework = 0;
  let collapsed = 0;
  const flush = (): void => {
    if (pendingFramework > 0) {
      lines.push(`  … ${pendingFramework} framework frame${pendingFramework === 1 ? "" : "s"}`);
      collapsed += pendingFramework;
      pendingFramework = 0;
    }
  };
  for (const frame of frames) {
    if (!frame.app) {
      pendingFramework += 1;
      continue;
    }
    flush();
    if (appShown < MAX_APP_FRAMES) {
      lines.push(frame.raw.trim());
      appShown += 1;
    } else {
      appOverflow += 1;
    }
  }
  flush();
  if (appOverflow > 0) lines.push(`  … ${appOverflow} more app frames`);
  return { fence: "```\n" + lines.join("\n") + "\n```", collapsed };
}

/** Today's tidyStackTrace, byte-identical: the parse plus the Discord body. */
export function tidyStackTrace(text: string): StackTidy | null {
  const p = parseStackTrace(text);
  if (p === null) return null;
  const rendered = renderFrames(p.frames);
  const head = [
    `**${p.headline}**`,
    ...p.headlines.slice(1).map((line) => `↳ ${line}`),
    ...(p.headTopAppFrame === null ? [] : [`Top app frame: \`${p.headTopAppFrame}\``]),
  ].join("\n");
  return {
    language: p.language,
    headline: p.headline,
    topAppFrame: p.topAppFrame,
    body: `${head}\n${rendered.fence}`,
    frameCount: p.frameCount,
    collapsedCount: rendered.collapsed,
  };
}

/**
 * Shared composition for the Decode detector and /debug stack — one code
 * path so the two surfaces cannot drift. Notes come from the strict
 * error-code scanner over the ANSI-cleaned text.
 */
export function renderStackReply(
  text: string,
): { body: string; notes: string[] } | null {
  const tidy = tidyStackTrace(text);
  if (tidy === null) return null;
  const notes = scanErrTokens(stripAnsi(text)).map(
    (info) => `🔎 \`${info.code}\` — ${info.meaning}`,
  );
  return { body: tidy.body, notes };
}
