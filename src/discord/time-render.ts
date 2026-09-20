import { DateTime, Duration } from "luxon";
import { DEFAULT_TZ } from "../time/timetools.js";
import type { TimeHit } from "../time/time-detect.js";

/** Discord timestamp styles — moved verbatim from src/commands/time.ts so the
 * expanded view can render the copyable list; /time stamp imports it back. */
export const STAMP_STYLES = [
  ["t", "short time"],
  ["T", "long time"],
  ["d", "short date"],
  ["D", "long date"],
  ["f", "date-time"],
  ["F", "full date-time"],
  ["R", "relative"],
] as const;

/** Fixed spread (spec ruling) — label width 11 = "Los Angeles". */
const EXPAND_ZONES = [
  ["UTC", "UTC"],
  ["Bangkok", "Asia/Bangkok"],
  ["Tokyo", "Asia/Tokyo"],
  ["London", "Europe/London"],
  ["New York", "America/New_York"],
  ["Los Angeles", "America/Los_Angeles"],
] as const;

/** Coarse read-as from the customId kind. Kinds are lenient by design —
 * a stale button from a renamed kind falls back to the generic label. */
const KIND_LABELS: Record<string, string> = {
  iso: "an ISO 8601 timestamp",
  epoch: "an epoch value",
  rfc2822: "an RFC 2822 date",
  "basic-iso": "a basic ISO timestamp",
  "discord-tag": "a Discord timestamp tag",
  "date-only": "a date (midnight assumed)",
  "named-date": "a date (midnight assumed)",
  "slash-date": "a date (midnight assumed)",
  "time-only": "a time (date assumed)",
};

/**
 * The compact public block. Deliberately six lines: it has to sit in a chat
 * channel without dominating it, and the <t:> line leads the data rows (right
 * after the human head line) because it is the only value that renders in
 * each viewer's own timezone.
 */
export function renderCompact(hit: TimeHit, tz: string = DEFAULT_TZ): string {
  if (hit.kind === "duration") {
    const shifted = Duration.fromMillis(hit.totalMs).shiftTo("days", "hours", "minutes", "seconds");
    // Zero-valued units are dropped before toHuman — otherwise every duration
    // renders all four units regardless of magnitude ("0 days, 0 hr, 5 min,
    // 0 sec" for a 5-minute duration). A wholly-zero duration falls back to
    // "0 sec" rather than toHuman on an empty object.
    const nonZero = Object.fromEntries(
      Object.entries(shifted.toObject()).filter(([, value]) => value !== 0),
    );
    // locale: "en" is load-bearing, not decoration. toHuman goes through
    // Intl.NumberFormat's unit display and so follows the HOST locale, unlike
    // toFormat (used for every other line here), which self-defaults to
    // English. On a th-TH box the headline rendered "⏳ **5 นาที**" — the one
    // locale-dependent line on this branch, and render-smoke.mjs never
    // exercises Luxon, so it is the repo's documented silent-host-ICU class.
    const trimmed = Duration.fromObject(
      Object.keys(nonZero).length > 0 ? nonZero : { seconds: 0 },
      { locale: "en" },
    );
    const d = trimmed.toHuman({ unitDisplay: "short" });
    const prefix = hit.approximate ? "≈ " : "";
    return [
      `⏳ **${prefix}${d}**`,
      `\`Total\` ${hit.totalMs} ms`,
      hit.approximate
        ? "-# approximate — calendar years and months have no fixed length"
        : `-# read as ISO 8601 duration \`${hit.matched}\``,
    ].join("\n");
  }

  if (hit.kind === "cron") {
    return [
      `🕐 **${hit.text}** (${tz})`,
      "Next runs:",
      ...hit.nextRuns.map((run) => `• ${run}`),
      // The anchor is real now, not any message clock: explainCron reads the
      // wall clock by design ("when does this next run" is a from-now
      // question), and on the ⏰ surface every OTHER kind resolves against the
      // message's timestamp — this line is what keeps the two clocks from
      // mixing silently. Owner ruling 2026-08-17; do not thread a clock
      // through explainCron instead.
      "-# next runs from now",
    ].join("\n");
  }

  const dt = DateTime.fromMillis(hit.ms).setZone(tz);
  // A date-only value has no wall-clock time the user supplied, so the long-date
  // style is used and midnight is never presented as data.
  const style = hit.timeAssumed ? "D" : "F";
  const head = hit.timeAssumed
    ? `🕐 **${dt.toFormat("EEE d LLL yyyy")}** (${tz})`
    : `🕐 **${dt.toFormat("EEE d LLL yyyy · HH:mm")}** (${dt.toFormat("ZZ")} ${tz})`;

  const subtext = [`read as ${hit.readAs}`];
  if (hit.alternate !== null) {
    const alt = DateTime.fromSeconds(hit.alternate.seconds).setZone(tz);
    subtext.push(`ambiguous — as ${hit.alternate.reading} it would be ${alt.toFormat("d LLL yyyy")}`);
  }

  return [
    head,
    `<t:${hit.seconds}:${style}> · <t:${hit.seconds}:R>`,
    `\`UTC\`   ${dt.toUTC().toISO({ suppressMilliseconds: true })}`,
    `\`Epoch\` ${hit.seconds} s · ${hit.ms} ms`,
    `\`Week\`  ${dt.weekNumber} · day ${dt.ordinal} of ${dt.year}`,
    `-# ${subtext.join(" · ")}`,
  ].join("\n");
}

/**
 * The ephemeral expansion behind the Expand button. Built from (ms, kind)
 * alone — everything the customId carries — so a button minted before a
 * restart renders identically after it. Deliberately reads NO clock:
 * distance-from-now is <t:N:R>, which Discord anchors to real now per viewer,
 * so a static distance line would only go stale.
 */
export function renderExpanded(ms: number, kind: string, tz: string = DEFAULT_TZ): string {
  const seconds = Math.floor(ms / 1000);
  const anchor = DateTime.fromMillis(ms).setZone(tz);
  const zoneLines = EXPAND_ZONES.map(([label, zone]) => {
    const dt = DateTime.fromMillis(ms).setZone(zone);
    const dst = dt.isInDST ? " · DST" : "";
    return `\`${label.padEnd(11)}\` ${dt.toFormat("EEE d LLL yyyy · HH:mm")} (${dt.toFormat("ZZ")}${dst})`;
  });
  const stampLines = STAMP_STYLES.map(
    ([style, label]) => `\`<t:${seconds}:${style}>\` → <t:${seconds}:${style}> (${label})`,
  );
  return [
    `🕐 <t:${seconds}:F> · <t:${seconds}:R>`,
    ...zoneLines,
    `\`Epoch\` ${seconds} s · ${ms} ms · Q${anchor.quarter}`,
    ...stampLines,
    `-# read as ${KIND_LABELS[kind] ?? "a timestamp"}`,
  ].join("\n");
}
