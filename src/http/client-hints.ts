import { parseSfItem, parseSfList } from "./structured-field.js";

export interface ClientHints {
  brands: { brand: string; version: string }[]; // GREASE brands removed
  fullVersionList: { brand: string; version: string }[];
  mobile: boolean | null;
  platform: string | null;
  platformVersion: string | null;
  architecture: string | null;
  bitness: string | null;
  model: string | null;
  wow64: boolean | null;
  osGuess: string | null; // "Windows 11", "Windows 10", "macOS 14.4", "Android 14", …
  notes: string[];
}

type Brand = { brand: string; version: string };

const WINDOWS_11_NOTE = "Windows 11 reports platform version 13 or higher.";

function isAsciiAlnumOrSpace(cp: number): boolean {
  return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp === 32;
}

// GREASE brands contain "Not" and a character that is neither alphanumeric nor a space.
function isGrease(brand: string): boolean {
  if (!brand.includes("Not")) return false;
  for (const ch of brand) {
    if (!isAsciiAlnumOrSpace(ch.codePointAt(0) ?? 0)) return true;
  }
  return false;
}

function dropGrease(list: Brand[]): Brand[] {
  return list.filter((b) => !isGrease(b.brand));
}

// Leading digits of a version string as a number, or null when it does not start with one.
function majorOf(version: string): number | null {
  let end = 0;
  while (end < version.length) {
    const cp = version.charCodeAt(end);
    if (cp < 48 || cp > 57) break;
    end += 1;
  }
  return end === 0 ? null : Number(version.slice(0, end));
}

function guessOs(platform: string | null, platformVersion: string | null, notes: string[]): string | null {
  if (platform === null) return null;
  if (platform === "Windows") {
    const major = platformVersion === null ? null : majorOf(platformVersion);
    if (major === null) return "Windows";
    if (major >= 13) {
      notes.push(WINDOWS_11_NOTE);
      return "Windows 11";
    }
    return major >= 1 ? "Windows 10" : "Windows 7/8";
  }
  if (platform === "macOS" || platform === "Android" || platform === "Chrome OS" || platform === "Linux") {
    return platformVersion === null || platformVersion === "" ? platform : `${platform} ${platformVersion}`;
  }
  return null;
}

interface Raw {
  brands: Brand[] | null;
  fullVersionList: Brand[] | null;
  mobile: boolean | null;
  platform: string | null;
  platformVersion: string | null;
  architecture: string | null;
  bitness: string | null;
  model: string | null;
  wow64: boolean | null;
}

function emptyRaw(): Raw {
  return { brands: null, fullVersionList: null, mobile: null, platform: null, platformVersion: null, architecture: null, bitness: null, model: null, wow64: null };
}

function brandList(text: string): Brand[] {
  return parseSfList(text).map((m) => ({ brand: m.value, version: m.params["v"] ?? "" }));
}

function strItem(text: string): string | null {
  const v = parseSfItem(text);
  return typeof v === "string" ? v : null;
}

function boolItem(text: string): boolean | null {
  const v = parseSfItem(text);
  return typeof v === "boolean" ? v : null;
}

const HEADER_NAME = /(sec-ch-ua[-a-z0-9]*)\s*:/i;

function readHeaders(block: string): Raw {
  const raw = emptyRaw();
  for (const line of block.split(/\r\n|\r|\n/)) {
    // Tolerate log noise before the name, such as a timestamp or a quote.
    const m = HEADER_NAME.exec(line);
    if (m === null) continue;
    const name = (m[1] ?? "").toLowerCase();
    const value = line.slice(m.index + m[0].length).trim();
    switch (name) {
      case "sec-ch-ua": raw.brands = brandList(value); break;
      case "sec-ch-ua-full-version-list": raw.fullVersionList = brandList(value); break;
      case "sec-ch-ua-mobile": raw.mobile = boolItem(value); break;
      case "sec-ch-ua-platform": raw.platform = strItem(value); break;
      case "sec-ch-ua-platform-version": raw.platformVersion = strItem(value); break;
      case "sec-ch-ua-arch": raw.architecture = strItem(value); break;
      case "sec-ch-ua-bitness": raw.bitness = strItem(value); break;
      case "sec-ch-ua-model": raw.model = strItem(value); break;
      case "sec-ch-ua-wow64": raw.wow64 = boolItem(value); break;
      default: break;
    }
  }
  return raw;
}

function objBrands(v: unknown): Brand[] | null {
  if (!Array.isArray(v)) return null;
  const out: Brand[] = [];
  for (const item of v as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { brand, version } = item as Record<string, unknown>;
    if (typeof brand === "string") out.push({ brand, version: typeof version === "string" ? version : "" });
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

function readObject(o: Record<string, unknown>): Raw {
  return {
    brands: objBrands(o["brands"]),
    fullVersionList: objBrands(o["fullVersionList"]),
    mobile: bool(o["mobile"]),
    platform: str(o["platform"]),
    platformVersion: str(o["platformVersion"]),
    architecture: str(o["architecture"]),
    bitness: str(o["bitness"]),
    model: str(o["model"]),
    wow64: bool(o["wow64"]),
  };
}

export function parseClientHints(input: string | Record<string, unknown>): ClientHints | null {
  const raw = typeof input === "string" ? readHeaders(input) : typeof input === "object" && input !== null ? readObject(input) : emptyRaw();
  const found = raw.brands !== null || raw.fullVersionList !== null || raw.mobile !== null || raw.platform !== null || raw.platformVersion !== null || raw.architecture !== null || raw.bitness !== null || raw.model !== null || raw.wow64 !== null;
  if (!found) return null;
  const notes: string[] = [];
  return {
    brands: dropGrease(raw.brands ?? []),
    fullVersionList: dropGrease(raw.fullVersionList ?? []),
    mobile: raw.mobile,
    platform: raw.platform,
    platformVersion: raw.platformVersion,
    architecture: raw.architecture,
    bitness: raw.bitness,
    model: raw.model,
    wow64: raw.wow64,
    osGuess: guessOs(raw.platform, raw.platformVersion, notes),
    notes,
  };
}
