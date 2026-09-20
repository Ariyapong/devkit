import { relativeTime } from "../time/relative-time.js";
import type { JwtInfo } from "../codec/codec.js";

/** Markdown body for a decoded JWT — shared by /codec jwt and the message menu. */
export function renderJwt(info: JwtInfo): string {
  const expiryLine =
    info.expiresInMs === null
      ? "ℹ️ No `exp` claim."
      : info.expiresInMs < 0
        ? `⛔ Expired ${relativeTime(-info.expiresInMs)} ago`
        : `✅ Valid — expires in ${relativeTime(info.expiresInMs)}`;
  return [
    "**Header**",
    "```json",
    JSON.stringify(info.header, null, 2),
    "```",
    "**Payload**",
    "```json",
    JSON.stringify(info.payload, null, 2),
    "```",
    ...info.times.map(
      (t) => `🕒 \`${t.claim}\` — <t:${t.epochSeconds}:f> (<t:${t.epochSeconds}:R>)`,
    ),
    expiryLine,
    "⚠️ Signature NOT verified — decode only.",
  ].join("\n");
}
