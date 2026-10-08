import { test } from "node:test";
import assert from "node:assert/strict";
import { NAMED_ENTITIES } from "./htmlentities.js";
import { htmlDecode, htmlEncode } from "./htmltools.js";

test("NAMED_ENTITIES: the generated table is intact", () => {
  // A truncated or mis-filtered regeneration fails here rather than silently
  // losing entities that no other test happens to name.
  assert.equal(Object.keys(NAMED_ENTITIES).length, 2125);
  assert.equal(NAMED_ENTITIES["amp"], "&");
  assert.equal(NAMED_ENTITIES["lt"], "<");
  assert.equal(NAMED_ENTITIES["nbsp"], " ");
  assert.equal(NAMED_ENTITIES["NotEqualTilde"], "≂̸");
  // Semicolon-less legacy forms were filtered out at generation time.
  assert.equal(NAMED_ENTITIES["amp;"], undefined);
});

test("htmlEncode: escapes the five markup characters", () => {
  assert.equal(htmlEncode("&"), "&amp;");
  assert.equal(htmlEncode("<"), "&lt;");
  assert.equal(htmlEncode(">"), "&gt;");
  assert.equal(htmlEncode('"'), "&quot;");
  // &#39; not &apos; — the named form is absent from HTML 4.01.
  assert.equal(htmlEncode("'"), "&#39;");
});

test("htmlEncode: single pass, so emitted ampersands are not re-encoded", () => {
  assert.equal(htmlEncode("&"), "&amp;");
  assert.equal(htmlEncode("&&"), "&amp;&amp;");
  assert.equal(htmlEncode("<&>"), "&lt;&amp;&gt;");
});

test("htmlEncode: leaves non-ASCII alone", () => {
  assert.equal(htmlEncode("เสี่ยวเอ้อ 🎲 café"), "เสี่ยวเอ้อ 🎲 café");
  assert.equal(htmlEncode("plain text"), "plain text");
});

test("htmlEncode: a real markup fragment", () => {
  assert.equal(
    htmlEncode(`<a href="x">Tom & Jerry's</a>`),
    "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
  );
});

test("htmlDecode: named entities require the semicolon", () => {
  assert.equal(htmlDecode("&lt;p&gt;Tom &amp; Jerry&lt;/p&gt;"), "<p>Tom & Jerry</p>");
  // Without the semicolon it is left literal, not guessed at.
  assert.equal(htmlDecode("&amp &copy"), "&amp &copy");
});

test("htmlDecode: prose entities above Latin-1", () => {
  assert.equal(
    htmlDecode("caf&eacute; &mdash; 50&deg;C &hellip; &copy;2026"),
    "café — 50°C … ©2026",
  );
});

test("htmlDecode: numeric references, semicolon optional", () => {
  assert.equal(htmlDecode("&#169; &#xA9;"), "© ©");
  assert.equal(htmlDecode("&#169 and &#xA9"), "© and ©");
});

test("htmlDecode: the stray-semicolon regression", () => {
  // The first spike draft omitted `;?` on the numeric branches, so &#39;
  // decoded to "'" and left the semicolon behind.
  assert.equal(htmlDecode("&#39;"), "'");
  assert.equal(htmlDecode("&#34;"), '"');
  assert.equal(htmlDecode("a&#39;b"), "a'b");
});

test("htmlDecode: entity names containing digits", () => {
  // 24 names carry digits; a bare [a-zA-Z]+ name class would miss all of them
  // while every other test in this file still passed.
  assert.equal(htmlDecode("&frac12;"), "½");
  assert.equal(htmlDecode("&sup1;"), "¹");
});

test("htmlDecode: astral-plane and multi-codepoint references", () => {
  assert.equal(htmlDecode("&#x1F600;"), "😀");
  assert.equal(htmlDecode("&#128512;"), "😀");
  // 93 entities expand to more than one codepoint.
  assert.equal(htmlDecode("&NotEqualTilde;"), "≂̸");
});

test("htmlDecode: unrecognised references are left untouched", () => {
  assert.equal(htmlDecode("&notarealentity; x"), "&notarealentity; x");
  assert.equal(htmlDecode("a & b"), "a & b");
});

test("htmlDecode: names colliding with Object.prototype stay literal", () => {
  // A bare NAMED_ENTITIES[name] lookup reaches inherited members and returns
  // native function source for these. None is a real HTML entity.
  for (const name of [
    "toString",
    "constructor",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
  ]) {
    assert.equal(htmlDecode(`&${name};`), `&${name};`);
  }
});

test("htmlDecode: unrepresentable numeric references become U+FFFD", () => {
  assert.equal(htmlDecode("&#0;"), "�");
  assert.equal(htmlDecode("&#xD800;"), "�");
  assert.equal(htmlDecode("&#x110000;"), "�");
});

test("htmlDecode: the C1 range is remapped through windows-1252", () => {
  // &#128; is €, not U+0080 — an HTML spec rule, not a workaround.
  assert.equal(htmlDecode("&#128;"), "€");
  assert.equal(htmlDecode("&#147;"), "“");
  assert.equal(htmlDecode("&#151;"), "—");
});

test("htmlDecode: one pass only, so double-encoding stays visible", () => {
  assert.equal(htmlDecode("&amp;lt;"), "&lt;");
  assert.equal(htmlDecode("&lt;&gt;&amp;"), "<>&");
});

test("htmlDecode: names are case-sensitive", () => {
  // &AMP; is a genuine separate entity; &Amp; is not one at all.
  assert.equal(htmlDecode("&AMP;"), "&");
  assert.equal(htmlDecode("&Amp;"), "&Amp;");
  // Hex digits, by contrast, are case-insensitive.
  assert.equal(htmlDecode("&#Xa9;"), "©");
});

test("htmlDecode(htmlEncode(x)) === x over adversarial text", () => {
  const samples = [
    `<script>alert("xss & 'stuff'")</script>`,
    "เสี่ยวเอ้อ & 🎲 <b>ตัวหนา</b>",
    "a&b<c>d\"e'f",
    "&amp; already encoded",
    "&#169; numeric",
    "«»…—™€",
    "",
  ];
  for (const sample of samples) {
    assert.equal(htmlDecode(htmlEncode(sample)), sample, `round-trip failed for ${sample}`);
  }
});

test("htmlDecode(htmlEncode(x)) === x over 20,000 generated inputs", () => {
  // Deterministic generator — no Math.random, so a failure is reproducible.
  const pool = [...`<>&"'abc \tเสี่ยว🎲é&#;xAMP`];
  for (let i = 0; i < 20000; i++) {
    let sample = "";
    for (let j = 0; j < i % 40; j++) sample += pool[(i * 31 + j * 17) % pool.length];
    assert.equal(htmlDecode(htmlEncode(sample)), sample, `round-trip failed for ${sample}`);
  }
});
