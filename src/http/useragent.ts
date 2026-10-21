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
export function parseUserAgent(ua: string): UaResult {
  if (ua.trim() === "") throw new InputError(ERR_EMPTY);
  if (ua.length > MAX_UA_CHARS) throw new InputError(ERR_TOO_LONG);

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
