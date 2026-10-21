import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../errors.js";
import { parseUserAgent, UA_FLAG_TEXT } from "./useragent.js";
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
test("UA_FLAG_TEXT covers every flag", () => assert.equal(Object.keys(UA_FLAG_TEXT).length, 14));
