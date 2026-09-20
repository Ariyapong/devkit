import semver from "semver";
import { InputError } from "../errors.js";

export interface RangeCheck {
  satisfied: boolean;
  version: string;
  range: string;
  /** The range's expanded comparator bounds, e.g. ">=4.2.0 <5.0.0-0". */
  expanded: string;
}

export interface VersionCompare {
  a: string;
  b: string;
  order: -1 | 0 | 1;
  /** semver.diff result, null when equal. */
  diff: string | null;
}

function cleanVersion(raw: string, label: string): string {
  const cleaned = semver.valid(semver.clean(raw.trim(), { loose: true }) ?? "");
  if (!cleaned) throw new InputError(`"${raw}" is not a valid semver version (${label}).`);
  return cleaned;
}

export function checkRange(rangeRaw: string, versionRaw: string): RangeCheck {
  const expanded = semver.validRange(rangeRaw.trim(), { loose: true });
  if (expanded === null) throw new InputError(`"${rangeRaw}" is not a valid semver range.`);
  const version = cleanVersion(versionRaw, "version");
  return {
    satisfied: semver.satisfies(version, rangeRaw.trim(), { loose: true }),
    version,
    range: rangeRaw.trim(),
    expanded,
  };
}

export function compareVersions(aRaw: string, bRaw: string): VersionCompare {
  const a = cleanVersion(aRaw, "first version");
  const b = cleanVersion(bRaw, "second version");
  const order = semver.compare(a, b);
  return { a, b, order, diff: order === 0 ? null : semver.diff(a, b) };
}

export function renderCompare(c: VersionCompare): string {
  if (c.order === 0) return `\`${c.a}\` and \`${c.b}\` are equal.`;
  const [newer, older] = c.order === 1 ? [c.a, c.b] : [c.b, c.a];
  return `\`${newer}\` is newer than \`${older}\` (${c.diff ?? "unknown"} bump).`;
}
