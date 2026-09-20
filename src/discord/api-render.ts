import { renderShapeDiff, type ShapeDiff, type SchemaNode } from "../api/shapetools.js";
import { toCurl, type RequestSpec } from "../api/curl-build.js";

/**
 * Discord modals vanish on submit, so a `/api diff` reply built from
 * `renderShapeDiff` alone leaves nothing to compare the drift against. This
 * wraps it with both parsed payloads echoed above the drift block, pretty-
 * printed at 2-space indent — the PARSED values, not the raw pasted text, so
 * formatting is normalised and the echo shows exactly what was parsed.
 * Delegates to `renderShapeDiff(diff)` verbatim for the tail so the two can
 * never drift apart.
 */
export function renderDiffReply(
  before: unknown,
  after: unknown,
  diff: ShapeDiff,
): string {
  return (
    `── before ──\n${JSON.stringify(before, null, 2)}\n` +
    `── after ──\n${JSON.stringify(after, null, 2)}\n\n` +
    renderShapeDiff(diff)
  );
}

/**
 * Reply body for /api schema: the PARSED payload echoed above the schema
 * (modal vanishes on submit — the echo is what the inference is read
 * against), both at 2-space indent. Echo-and-public is pack doctrine, twice
 * owner-elected; don't "fix" it without asking. Values appear only in the
 * echo, never in the schema.
 */
export function renderSchemaReply(payload: unknown, schema: SchemaNode): string {
  return (
    `── payload ──\n${JSON.stringify(payload, null, 2)}\n` +
    `── JSON Schema ──\n${JSON.stringify(schema, null, 2)}`
  );
}

/** Warnings first (read before running), then the command. Fenced by sendResult. */
export function renderRequestReply(spec: RequestSpec): string {
  return [...spec.warnings.map((w) => "# ⚠ " + w), toCurl(spec)].join("\n");
}
