import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../errors.js";
import { extractUserAgents, MAX_UA_BATCH, MAX_UA_INPUT_CHARS, parseUserAgent, parseUserAgentBatch, UA_FLAG_TEXT } from "./useragent.js";
import type { UaDeviceType, UaFlag } from "./useragent.js";

interface Row {
  label: string;
  ua: string;
  expect: { browser: string | null; major: string | null; os: string | null; device: UaDeviceType; flags: UaFlag[]; app: string | null; underlying: string | null };
}

const UAS: Row[] = [
  {
    label: "Chrome/Windows 11",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    expect: { browser: "Chrome", major: "129", os: "Windows", device: "desktop", flags: ["frozen-windows", "reduced-minor-version"], app: null, underlying: null },
  },
  {
    label: "Edge/Windows",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    expect: { browser: "Edge", major: "129", os: "Windows", device: "desktop", flags: ["chromium-edge", "frozen-windows", "reduced-minor-version"], app: null, underlying: null },
  },
  {
    label: "Firefox/Windows",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    expect: { browser: "Firefox", major: "131", os: "Windows", device: "desktop", flags: ["frozen-windows"], app: null, underlying: null },
  },
  {
    label: "Safari/macOS",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    expect: { browser: "Safari", major: "18", os: "Mac OS", device: "desktop", flags: ["frozen-mac"], app: null, underlying: null },
  },
  {
    label: "Chrome/macOS",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    expect: { browser: "Chrome", major: "129", os: "Mac OS", device: "desktop", flags: ["frozen-mac", "reduced-minor-version"], app: null, underlying: null },
  },
  {
    label: "Chrome/Android (reduced)",
    ua: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    expect: { browser: "Chrome", major: "129", os: "Android", device: "mobile", flags: ["frozen-android", "reduced-minor-version"], app: null, underlying: null },
  },
  {
    label: "Samsung Internet",
    ua: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
    expect: { browser: "Samsung Internet", major: "26", os: "Android", device: "mobile", flags: ["chromium-samsung", "frozen-android"], app: null, underlying: null },
  },
  {
    label: "Safari/iPhone",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    expect: { browser: "Mobile Safari", major: "18", os: "iOS", device: "mobile", flags: [], app: null, underlying: null },
  },
  {
    label: "Chrome/iPhone (CriOS)",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
    expect: { browser: "Chrome", major: "129", os: "iOS", device: "mobile", flags: [], app: null, underlying: null },
  },
  {
    label: "LINE in-app Android",
    ua: "Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 Line/14.15.1/IAB",
    expect: { browser: "Line", major: "14", os: "Android", device: "mobile", flags: ["in-app-browser", "android-webview"], app: "LINE", underlying: "Chrome" },
  },
  {
    label: "Facebook in-app iOS",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/482.0.0.40.108;FBBV/645698420;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.6.1;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]",
    expect: { browser: "Facebook", major: "482", os: "iOS", device: "mobile", flags: ["in-app-browser", "ios-webview"], app: "Facebook", underlying: "WebKit" },
  },
  {
    label: "Android WebView",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.70 Mobile Safari/537.36",
    expect: { browser: "Chrome WebView", major: "129", os: "Android", device: "mobile", flags: ["android-webview"], app: null, underlying: "Chrome" },
  },
  {
    label: "iOS WebView",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    expect: { browser: "WebKit", major: "605", os: "iOS", device: "mobile", flags: ["ios-webview"], app: null, underlying: "WebKit" },
  },
  {
    label: "curl",
    ua: "curl/8.7.1",
    expect: { browser: null, major: null, os: null, device: "tool", flags: ["http-tool"], app: "curl", underlying: null },
  },
  {
    label: "PostmanRuntime",
    ua: "PostmanRuntime/7.42.0",
    expect: { browser: null, major: null, os: null, device: "tool", flags: ["http-tool"], app: "PostmanRuntime", underlying: null },
  },
  {
    label: "PowerShell",
    ua: "Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.22631; en-US) PowerShell/7.4.5",
    expect: { browser: null, major: null, os: "Windows", device: "tool", flags: ["http-tool", "frozen-windows"], app: "PowerShell", underlying: null },
  },
  {
    label: "Googlebot",
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    expect: { browser: null, major: null, os: null, device: "bot", flags: ["bot"], app: "Googlebot", underlying: null },
  },
  {
    label: "ClaudeBot",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    expect: { browser: "WebKit", major: "537", os: null, device: "bot", flags: ["bot"], app: "ClaudeBot", underlying: null },
  },
  {
    label: "HeadlessChrome",
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.6668.58 Safari/537.36",
    expect: { browser: "Chrome Headless", major: "129", os: "Linux", device: "desktop", flags: ["headless"], app: null, underlying: null },
  },
  {
    label: "Dalvik",
    ua: "Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP2A.240905.003)",
    expect: { browser: null, major: null, os: "Android", device: "mobile", flags: [], app: null, underlying: null },
  },
];

test("parseUserAgent: pinned table", () => {
  assert.equal(UAS.length, 20);
  for (const row of UAS) {
    const r = parseUserAgent(row.ua);
    assert.deepEqual({ browser: r.browser.name, major: r.browser.major, os: r.os.name, device: r.device.type, flags: r.flags, app: r.app, underlying: r.underlying?.name ?? null }, row.expect, row.label);
  }
});
test("parseUserAgent: caveats text", () => {
  assert.deepEqual(parseUserAgent(UAS[0]!.ua).caveats, ["Windows NT 10.0 is reported by both Windows 10 and Windows 11. The user-agent string can't tell them apart; Client Hints can.", "Only the major browser version is real. Chrome sends 0.0.0 for the rest."]);
});
test("parseUserAgent: frozen macOS, Android and Linux caveats", () => {
  assert.deepEqual(parseUserAgent(UAS[3]!.ua).caveats, ["macOS 10.15.7 is frozen in the user-agent string. The real version is 10.15.7 or newer."]);
  assert.deepEqual(parseUserAgent(UAS[6]!.ua).caveats, ["Android 10 and the model K are placeholders. Chrome stopped sending the real version and device model."]);
  const linux = parseUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36");
  assert.deepEqual(linux.flags, ["frozen-linux", "reduced-minor-version"]);
  assert.deepEqual(linux.caveats, ["Linux x86_64 is a placeholder. The real distribution and architecture aren't sent.", "Only the major browser version is real. Chrome sends 0.0.0 for the rest."]);
});
test("parseUserAgent: underlying versions and empty strings mapped to null", () => {
  assert.deepEqual(parseUserAgent(UAS[9]!.ua).underlying, { name: "Chrome", version: "128.0.6613.127" });
  assert.deepEqual(parseUserAgent(UAS[12]!.ua).underlying, { name: "WebKit", version: "605.1.15" });
  const curl = parseUserAgent(UAS[13]!.ua);
  assert.deepEqual(curl.browser, { name: null, version: null, major: null });
  assert.deepEqual(curl.engine, { name: null, version: null });
  assert.deepEqual(curl.device, { type: "tool", vendor: null, model: null });
  assert.deepEqual(curl.cpu, { architecture: null });
  assert.equal(curl.ua, "curl/8.7.1");
});
test("parseUserAgent: empty and too long", () => {
  assert.throws(() => parseUserAgent("  "), (e: unknown) => e instanceof InputError && e.message === "The user agent is empty.");
  assert.throws(() => parseUserAgent("x".repeat(4097)), (e: unknown) => e instanceof InputError && e.message === "Too long — the user agent is over 4096 characters.");
  assert.doesNotThrow(() => parseUserAgent("x".repeat(4096)));
});
test("UA_FLAG_TEXT covers every flag", () => {
  assert.deepEqual(UA_FLAG_TEXT, {
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
  });
});
test("parseUserAgent: surrounding whitespace is trimmed before parsing", () => {
  const r = parseUserAgent("  curl/8.7.1  ");
  assert.equal(r.device.type, "tool");
  assert.equal(r.app, "curl");
  assert.ok(r.flags.includes("http-tool"));
});

const NGINX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const NGINX_LINE = `203.0.113.7 - - [20/Oct/2026:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 612 "-" "${NGINX_UA}"`;

test("extractUserAgents: nginx combined, JSON, raw list, generic product, unbalanced quote", () => {
  assert.deepEqual(extractUserAgents(NGINX_LINE), [{ ua: NGINX_UA, line: 1 }]);
  assert.deepEqual(extractUserAgents('{"ua":"curl/8.4.0","status":200}'), [{ ua: "curl/8.4.0", line: 1 }]);
  assert.deepEqual(extractUserAgents("User-Agent: PostmanRuntime/7.36.0,").map((x) => x.ua), ["PostmanRuntime/7.36.0"]);
  assert.deepEqual(extractUserAgents("Dalvik/2.1.0 (Linux; U; Android 13; Pixel 7 Build/TQ3A)\nMyApp/3.2 CFNetwork/1485 Darwin/23.1.0\nRoku/DVP-12.0 (12.0.0.4182-46)").map((x) => x.line), [1, 2, 3]);
  assert.deepEqual(extractUserAgents("2026-10-20 ok\n\nnothing here"), []);
  assert.equal(extractUserAgents('1.2.3.4 - - [20/Oct/2026] "GET / HTTP/1.1" 200 1 "-" "Mozilla/5.0 (X11').at(0)?.ua, "Mozilla/5.0 (X11");
});
test("extractUserAgents: trims candidates and caps each at 4096 characters", () => {
  assert.deepEqual(extractUserAgents("   curl/8.4.0  "), [{ ua: "curl/8.4.0", line: 1 }]);
  assert.equal(extractUserAgents(`curl/8.4.0 ${"x".repeat(5000)}`)[0]?.ua.length, 4096);
});
test("parseUserAgentBatch: counts sorted by count then name, truncation", () => {
  const b = parseUserAgentBatch([NGINX_LINE, "curl/8.4.0", "curl/8.4.0"].join("\n"));
  assert.equal(b.rows.length, 3);
  assert.deepEqual(b.counts.devices, [["tool", 2], ["desktop", 1]]);
  assert.deepEqual(b.counts.os.map(([n]) => n), ["Unknown", parseUserAgent(NGINX_UA).os.name]); // count 2 before count 1
  assert.equal(b.truncated, false);
  const big = parseUserAgentBatch(Array.from({ length: MAX_UA_BATCH + 1 }, () => "curl/8.4.0").join("\n"));
  assert.equal(big.rows.length, MAX_UA_BATCH); assert.equal(big.truncated, true);
});
test("parseUserAgentBatch: too long", () => {
  assert.throws(() => parseUserAgentBatch("x".repeat(MAX_UA_INPUT_CHARS + 1)), (e: unknown) => e instanceof InputError && e.message === "Too long — the input is over 1000000 characters.");
});

test("extractUserAgents: bot-led lines without a slash, and no date-led log lines", () => {
  const slack = "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)";
  assert.deepEqual(extractUserAgents(slack), [{ ua: slack, line: 1 }]);
  assert.deepEqual(extractUserAgents(`1.2.3.4 - - [20/Oct/2026] "GET / HTTP/1.1" 200 1 "-" "${slack}"`).map((x) => x.ua), [slack]);
  assert.deepEqual(extractUserAgents('1.2.3.4 - - [20/Oct/2026] "GET /spider HTTP/1.1" 200 1'), []);
  assert.deepEqual(extractUserAgents('2026/10/20 10:00:00 [error] 1#1: *1 open() failed, request: "GET /x HTTP/1.1"\n10/20/2026 something happened'), []);
});
