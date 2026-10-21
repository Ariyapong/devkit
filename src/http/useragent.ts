import UAParser from "ua-parser-js";
import { InputError } from "../errors.js";

export type UaDeviceType = "desktop" | "mobile" | "tablet" | "console" | "smarttv" | "wearable" | "embedded" | "bot" | "tool" | "unknown";

export type UaFlag =
  | "bot" | "http-tool" | "headless"
  | "in-app-browser" | "android-webview" | "ios-webview"
  | "chromium-edge" | "chromium-opera" | "chromium-samsung"
  | "frozen-windows" | "frozen-mac" | "frozen-android" | "frozen-linux" | "reduced-minor-version";

export interface UaResult {
  ua: string;
  browser: { name: string | null; version: string | null; major: string | null };
  engine: { name: string | null; version: string | null };
  os: { name: string | null; version: string | null };
  device: { type: UaDeviceType; vendor: string | null; model: string | null };
  cpu: { architecture: string | null };
  underlying: { name: string | null; version: string | null } | null; // the engine's browser behind an in-app browser or WebView
  flags: UaFlag[];
  caveats: string[]; // one sentence per applicable frozen-UA flag
  app: string | null; // the in-app host ("LINE", "Facebook", …) or the tool ("curl", "PostmanRuntime")
}

// Short label per flag, for chips.
export const UA_FLAG_TEXT: Record<UaFlag, string> = {
  bot: "Bot",
  "http-tool": "HTTP client",
  headless: "Headless",
  "in-app-browser": "In-app browser",
  "android-webview": "Android WebView",
  "ios-webview": "iOS WebView",
  "chromium-edge": "Chromium (Edge)",
  "chromium-opera": "Chromium (Opera)",
  "chromium-samsung": "Chromium (Samsung)",
  "frozen-windows": "Frozen Windows version",
  "frozen-mac": "Frozen macOS version",
  "frozen-android": "Frozen Android version",
  "frozen-linux": "Frozen Linux platform",
  "reduced-minor-version": "Frozen minor version",
};

const MAX_UA_CHARS = 4096;
const ERR_EMPTY = "The user agent is empty.";
const ERR_TOO_LONG = `Too long — the user agent is over ${MAX_UA_CHARS} characters.`;

const CAVEAT_TEXT: Partial<Record<UaFlag, string>> = {
  "frozen-windows": "Windows NT 10.0 is reported by both Windows 10 and Windows 11. The user-agent string can't tell them apart; Client Hints can.",
  "frozen-mac": "macOS 10.15.7 is frozen in the user-agent string. The real version is 10.15.7 or newer.",
  "frozen-android": "Android 10 and the model K are placeholders. Chrome stopped sending the real version and device model.",
  "frozen-linux": "Linux x86_64 is a placeholder. The real distribution and architecture aren't sent.",
  "reduced-minor-version": "Only the major browser version is real. Chrome sends 0.0.0 for the rest.",
};

const HTTP_TOOLS = [
  "curl", "Wget", "PostmanRuntime", "insomnia", "axios", "node-fetch", "undici", "Go-http-client", "Java",
  "Apache-HttpClient", "okhttp", "python-requests", "python-urllib", "aiohttp", "libwww-perl", "PowerShell",
  "WindowsPowerShell", "Dart", "Deno", "Bun", "HTTPie", "k6", "Faraday", "RestSharp", ".NET",
];
// PowerShell puts its product token after a Mozilla/5.0 (...) prefix rather than at the start.
const MOZILLA_PREFIXED_TOOLS = new Set(["PowerShell", "WindowsPowerShell"]);
const MOZILLA_PREFIX = /^Mozilla\/5\.0 \([^)]*\) /i;

const NAMED_BOTS = [
  "Googlebot", "Bingbot", "Slurp", "DuckDuckBot", "Baiduspider", "YandexBot", "Applebot", "facebookexternalhit",
  "Twitterbot", "LinkedInBot", "Slackbot", "Discordbot", "TelegramBot", "WhatsApp", "AhrefsBot", "SemrushBot",
  "MJ12bot", "PetalBot", "GPTBot", "ClaudeBot", "Claude-Web", "anthropic-ai", "CCBot", "Bytespider",
  "PerplexityBot", "Amazonbot", "UptimeRobot", "Pingdom", "StatusCake", "Site24x7",
];
const GENERIC_BOT_TOKENS = ["bot/", "bot;", "crawler", "spider"];
const HEADLESS_TOKENS = ["HeadlessChrome", "PhantomJS", "Playwright", "Puppeteer"];

// Each in-app host with the tokens that betray it, in the spec's order.
const IN_APP_HOSTS: [string, string[]][] = [
  ["LINE", ["Line/"]],
  ["Facebook", ["FBAN", "FBAV", "FB_IAB"]],
  ["Instagram", ["Instagram"]],
  ["Microsoft Teams", ["Teams/", "MSTeams", "Microsoft Teams"]],
  ["WeChat", ["MicroMessenger"]],
  ["TikTok", ["musical_ly", "BytedanceWebview", "TikTok"]],
  ["X", ["Twitter for"]],
  ["Snapchat", ["Snapchat"]],
  ["Electron", ["Electron/"]],
  ["Google app", ["GSA/"]],
  ["DuckDuckGo", ["DuckDuckGo/"]],
  ["Outlook", ["Outlook-iOS", "Outlook-Android"]],
];

const IOS_NON_WEBVIEW = ["Safari/", "CriOS/", "FxiOS/", "EdgiOS/", "OPiOS/"];
const PASS_THROUGH_DEVICES = new Set<string>(["mobile", "tablet", "console", "smarttv", "wearable", "embedded"]);
const FROZEN_LINUX_BROWSERS = new Set(["Chrome", "Chromium", "Edge"]);

const CHROME_TOKEN = /\bChrome\/(\d[\d.]*)/i;
const WEBKIT_TOKEN = /\bAppleWebKit\/(\d[\d.]*)/i;
const REDUCED_VERSION = /^\d+\.0\.0\.0$/;

function orNull(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

function has(lower: string, token: string): boolean {
  return lower.includes(token.toLowerCase());
}

function hasAny(lower: string, tokens: string[]): boolean {
  return tokens.some((t) => has(lower, t));
}

function matchHttpTool(ua: string): string | null {
  const lower = ua.toLowerCase();
  const prefix = MOZILLA_PREFIX.exec(ua);
  const afterPrefix = prefix === null ? null : lower.slice(prefix[0].length);
  for (const name of HTTP_TOOLS) {
    const token = `${name.toLowerCase()}/`;
    if (lower.startsWith(token)) return name;
    if (afterPrefix !== null && MOZILLA_PREFIXED_TOOLS.has(name) && afterPrefix.startsWith(token)) return name;
  }
  return null;
}

// A named bot yields its name; a generic token marks a bot without naming it.
function matchBot(lower: string): { name: string | null } | null {
  const named = NAMED_BOTS.find((n) => has(lower, n));
  if (named !== undefined) return { name: named };
  return hasAny(lower, GENERIC_BOT_TOKENS) ? { name: null } : null;
}

function matchInApp(lower: string): string | null {
  const host = IN_APP_HOSTS.find(([, tokens]) => hasAny(lower, tokens));
  return host === undefined ? null : host[0];
}

function versionOf(ua: string, token: RegExp): string | null {
  return token.exec(ua)?.[1] ?? null;
}

// The engine's browser behind an in-app browser or WebView: Chrome on Android, WebKit on iOS.
function underlyingOf(ua: string, lower: string): UaResult["underlying"] {
  if (has(lower, "Android")) {
    const version = versionOf(ua, CHROME_TOKEN);
    if (version !== null) return { name: "Chrome", version };
  }
  if (hasAny(lower, ["iPhone", "iPad", "iPod"])) {
    const version = versionOf(ua, WEBKIT_TOKEN);
    if (version !== null) return { name: "WebKit", version };
  }
  return null;
}

/**
 * Parses a user-agent string with ua-parser-js and adds a flag layer: bots,
 * HTTP clients, headless and in-app browsers, WebViews, Chromium forks and
 * the frozen parts of reduced user-agent strings, each frozen part with a caveat.
 */
export function parseUserAgent(input: string): UaResult {
  if (input.trim() === "") throw new InputError(ERR_EMPTY);
  if (input.length > MAX_UA_CHARS) throw new InputError(ERR_TOO_LONG);
  // Every rule below reads the trimmed string, so pasted surrounding whitespace changes nothing.
  const ua = input.trim();

  // Rule 4.4 exception: ua-parser-js reads navigator itself when the string equals the browser's own UA.
  const raw = new UAParser(ua).getResult();
  const browser = { name: orNull(raw.browser.name), version: orNull(raw.browser.version), major: orNull(raw.browser.major) };
  const os = { name: orNull(raw.os.name), version: orNull(raw.os.version) };
  const lower = ua.toLowerCase();

  const flags: UaFlag[] = [];
  let app: string | null = null;
  const setApp = (name: string | null): void => {
    if (app === null) app = name;
  };

  // The rules run in the spec's order; the first rule that names an app keeps it.
  const tool = matchHttpTool(ua);
  if (tool !== null) {
    flags.push("http-tool");
    setApp(tool);
  }
  const bot = matchBot(lower);
  if (bot !== null) {
    flags.push("bot");
    setApp(bot.name);
  }
  if (hasAny(lower, HEADLESS_TOKENS)) flags.push("headless");
  const inApp = matchInApp(lower);
  if (inApp !== null) {
    flags.push("in-app-browser");
    setApp(inApp);
  }
  const android = has(lower, "Android");
  if (android && (has(lower, "; wv)") || (has(lower, "Version/") && has(lower, "Chrome/")))) flags.push("android-webview");
  if (hasAny(lower, ["iPhone", "iPad", "iPod"]) && has(lower, "AppleWebKit") && !hasAny(lower, IOS_NON_WEBVIEW)) flags.push("ios-webview");
  if (hasAny(lower, ["Edg/", "EdgA/", "EdgiOS/"])) flags.push("chromium-edge");
  if (has(lower, "OPR/")) flags.push("chromium-opera");
  if (has(lower, "SamsungBrowser/")) flags.push("chromium-samsung");
  if (os.name === "Windows" && has(lower, "Windows NT 10.0")) flags.push("frozen-windows");
  if ((os.name === "Mac OS" || os.name === "macOS") && (has(lower, "Mac OS X 10_15_7") || has(lower, "10.15.7"))) flags.push("frozen-mac");
  if (has(lower, "Android 10; K")) flags.push("frozen-android");
  const major = browser.major === null ? NaN : Number(browser.major);
  if (os.name === "Linux" && browser.name !== null && FROZEN_LINUX_BROWSERS.has(browser.name) && major >= 110 && ua.includes("(X11; Linux x86_64)")) {
    flags.push("frozen-linux");
  }
  if (browser.version !== null && REDUCED_VERSION.test(browser.version)) flags.push("reduced-minor-version");

  const embedded = flags.includes("in-app-browser") || flags.includes("android-webview") || flags.includes("ios-webview");
  const deviceType = raw.device.type;
  let type: UaDeviceType;
  // A self-declared crawler outranks the HTTP client it happens to use.
  if (bot !== null) type = "bot";
  else if (tool !== null) type = "tool";
  else if (deviceType !== undefined && PASS_THROUGH_DEVICES.has(deviceType)) type = deviceType as UaDeviceType;
  else type = os.name !== null ? "desktop" : "unknown";

  return {
    ua,
    browser,
    engine: { name: orNull(raw.engine.name), version: orNull(raw.engine.version) },
    os,
    device: { type, vendor: orNull(raw.device.vendor), model: orNull(raw.device.model) },
    cpu: { architecture: orNull(raw.cpu.architecture) },
    underlying: embedded ? underlyingOf(ua, lower) : null,
    flags,
    caveats: flags.flatMap((f) => CAVEAT_TEXT[f] ?? []),
    app,
  };
}

export const MAX_UA_INPUT_CHARS = 1_000_000;
export const MAX_UA_BATCH = 5000;

const ERR_INPUT_TOO_LONG = `Too long — the input is over ${MAX_UA_INPUT_CHARS} characters.`;
const UA_HEADER = "user-agent:";
// A generic product token: name/version, the name starting with a letter, then letters, digits, "." "_" "-" and the version starting with a
// digit (or a short label then a digit, as in Roku/DVP-12.0, which the spec's own example needs).
const GENERIC_PRODUCT = /^[A-Za-z][A-Za-z0-9._-]*\/(?:\d|[A-Za-z]+-\d)/;

// The rest of a "User-Agent:" header line, without wrapping quotes or a trailing comma.
function headerValue(rest: string): string {
  let value = rest.trim();
  if (value.endsWith(",")) value = value.slice(0, -1).trim();
  if (value.length >= 1 && (value.startsWith('"') || value.startsWith("'"))) value = value.slice(1);
  if (value.endsWith('"') || value.endsWith("'")) value = value.slice(0, -1);
  return value.trim();
}

function startsWithBot(text: string): boolean {
  const lower = text.toLowerCase();
  return [...NAMED_BOTS, ...GENERIC_BOT_TOKENS].some((t) => lower.startsWith(t.toLowerCase()));
}

function looksLikeUserAgent(text: string): boolean {
  return text.startsWith("Mozilla/") || matchHttpTool(text) !== null || GENERIC_PRODUCT.test(text) || startsWithBot(text);
}

// A quoted segment counts when it starts like a user agent, or is a product line naming a bot.
function isUserAgentSegment(segment: string): boolean {
  if (segment.startsWith("Mozilla/") || matchHttpTool(segment) !== null || startsWithBot(segment)) return true;
  return GENERIC_PRODUCT.test(segment) && matchBot(segment.toLowerCase()) !== null;
}

// Quoted segments pair up left to right; an unbalanced final quote takes the rest of the line.
function quotedUserAgent(line: string): string | null {
  let i = line.indexOf('"');
  while (i !== -1) {
    const close = line.indexOf('"', i + 1);
    const segment = (close === -1 ? line.slice(i + 1) : line.slice(i + 1, close)).trim();
    if (isUserAgentSegment(segment)) return segment;
    if (close === -1) return null;
    i = line.indexOf('"', close + 1);
  }
  return null;
}

/**
 * Pulls user-agent strings out of pasted text: `User-Agent:` header lines,
 * the quoted segment of nginx/Apache access logs or JSON, and bare lines that
 * start like a product token. Each candidate is trimmed and capped at 4096
 * characters. Line numbers are 1-based. Never throws.
 */
export function extractUserAgents(text: string): { ua: string; line: number }[] {
  const found: { ua: string; line: number }[] = [];
  text.split(/\r\n|\n|\r/).forEach((line, index) => {
    const headerAt = line.toLowerCase().indexOf(UA_HEADER);
    let ua: string | null = null;
    if (headerAt !== -1) ua = headerValue(line.slice(headerAt + UA_HEADER.length));
    else {
      ua = quotedUserAgent(line);
      if (ua === null) {
        const whole = line.trim();
        if (looksLikeUserAgent(whole)) ua = whole;
      }
    }
    if (ua === null) return;
    const capped = ua.slice(0, MAX_UA_CHARS).trim();
    if (capped !== "") found.push({ ua: capped, line: index + 1 });
  });
  return found;
}

export interface UaBatch {
  rows: ({ line: number } & UaResult)[];
  counts: { browsers: [string, number][]; os: [string, number][]; devices: [string, number][] };
  truncated: boolean;
}

// Count descending, then name ascending.
function tally(names: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * Parses every user agent found in pasted text (see `extractUserAgents`), up to
 * `MAX_UA_BATCH` rows, and counts browsers, operating systems and device types.
 */
export function parseUserAgentBatch(text: string): UaBatch {
  if (text.length > MAX_UA_INPUT_CHARS) throw new InputError(ERR_INPUT_TOO_LONG);
  const candidates = extractUserAgents(text);
  const rows = candidates.slice(0, MAX_UA_BATCH).map(({ ua, line }) => ({ line, ...parseUserAgent(ua) }));
  return {
    rows,
    counts: {
      browsers: tally(rows.map((r) => r.browser.name ?? "Unknown")),
      os: tally(rows.map((r) => r.os.name ?? "Unknown")),
      devices: tally(rows.map((r) => r.device.type)),
    },
    truncated: candidates.length > MAX_UA_BATCH,
  };
}
