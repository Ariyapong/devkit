import { queryToJson } from "../json/datatools.js";
import type { UrlParts } from "../text/urltools.js";

export function renderUrl(parts: UrlParts, raw: string): string {
  const lines: string[] = [`Scheme: \`${parts.scheme}\``];
  if (parts.host !== "") {
    lines.push(
      `Host: \`${parts.host}\`` +
        (parts.hostUnicode !== undefined ? ` → \`${parts.hostUnicode}\`` : ""),
    );
  }
  if (parts.port !== undefined) lines.push(`Port: \`${parts.port}\``);
  lines.push(
    `Path: \`${parts.path}\`` +
      (parts.pathDecoded !== undefined ? ` → \`${parts.pathDecoded}\`` : ""),
  );
  if (parts.fragment !== undefined) {
    lines.push(
      `Fragment: \`${parts.fragment}\`` +
        (parts.fragmentDecoded !== undefined ? ` → \`${parts.fragmentDecoded}\`` : ""),
    );
  }
  if (parts.user !== undefined) {
    lines.push(
      `User: \`${parts.user}\`` + (parts.hasPassword ? " (password hidden)" : ""),
    );
  }
  const sections = [lines.join("\n")];
  if (parts.hasQuery) {
    try {
      sections.push("Query parameters:\n```json\n" + queryToJson(raw) + "\n```");
    } catch {
      // A "?" that yields no parseable params — omit the section, never fail the reply.
    }
  }
  sections.push("Reconstructed:\n```\n" + parts.href + "\n```");
  return sections.join("\n\n");
}
