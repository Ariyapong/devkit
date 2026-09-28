// Punycode → Unicode for domain names: the decode half of punycode.js 2.3.1
// (https://github.com/mathiasbynens/punycode.js), vendored so the package
// ships no CommonJS-packaged ESM file. `punycode/punycode.es6.js` sits in a
// package without "type": "module", which Vite's SSR dev runner loads natively
// and rejects ("does not provide an export named 'toUnicode'").
//
// Copyright Mathias Bynens <https://mathiasbynens.be/>
// Released under the MIT license:
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions: The above copyright
// notice and this permission notice shall be included in all copies or
// substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
// WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
// TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
// FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
// THE USE OR OTHER DEALINGS IN THE SOFTWARE.

const MAX_INT = 2147483647;
const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const DELIMITER = "-";

// RFC 3490 label separators: full stop, ideographic full stop, fullwidth full
// stop, halfwidth ideographic full stop. Code points, not a \u-range regex
// (see the note in urltools.ts).
const SEPARATORS = new Set([0x2e, 0x3002, 0xff0e, 0xff61]);

function fail(message: string): never {
  throw new RangeError(message);
}

function basicToDigit(codePoint: number): number {
  if (codePoint >= 0x30 && codePoint < 0x3a) return 26 + (codePoint - 0x30);
  if (codePoint >= 0x41 && codePoint < 0x5b) return codePoint - 0x41;
  if (codePoint >= 0x61 && codePoint < 0x7b) return codePoint - 0x61;
  return BASE;
}

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let k = 0;
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  for (; delta > ((BASE - T_MIN) * T_MAX) >> 1; k += BASE) {
    delta = Math.floor(delta / (BASE - T_MIN));
  }
  return Math.floor(k + ((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

/** Decodes one Punycode label (without the `xn--` prefix). Throws RangeError on invalid input. */
export function decodeLabel(input: string): string {
  const output: number[] = [];
  let i = 0;
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;

  const basic = Math.max(input.lastIndexOf(DELIMITER), 0);
  for (let j = 0; j < basic; ++j) {
    if (input.charCodeAt(j) >= 0x80) fail("Illegal input >= 0x80 (not a basic code point)");
    output.push(input.charCodeAt(j));
  }

  for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
    const oldi = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) fail("Invalid input");
      const digit = basicToDigit(input.charCodeAt(index++));
      if (digit >= BASE) fail("Invalid input");
      if (digit > Math.floor((MAX_INT - i) / w)) fail("Overflow: input needs wider integers to process");
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      if (w > Math.floor(MAX_INT / (BASE - t))) fail("Overflow: input needs wider integers to process");
      w *= BASE - t;
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi === 0);
    if (Math.floor(i / out) > MAX_INT - n) fail("Overflow: input needs wider integers to process");
    n += Math.floor(i / out);
    i %= out;
    output.splice(i++, 0, n);
  }

  // String.fromCodePoint throws RangeError past U+10FFFF, the same class of error as above.
  return String.fromCodePoint(...output);
}

/**
 * punycode.js `toUnicode`: every `xn--` label of a domain (or of the part
 * after `@` in an email address) decoded; other labels verbatim. Separators
 * are normalised to ".". Throws RangeError on an undecodable label.
 */
export function toUnicode(input: string): string {
  // punycode.js splits on every "@" and keeps only the first two parts; mirror it.
  const parts = input.split("@");
  const prefix = parts.length > 1 ? `${parts[0]}@` : "";
  const domain = parts.length > 1 ? (parts[1] ?? "") : input;
  let normalised = "";
  for (const ch of domain) {
    normalised += SEPARATORS.has(ch.codePointAt(0) ?? 0) ? "." : ch;
  }
  return (
    prefix +
    normalised
      .split(".")
      .map((label) => (label.startsWith("xn--") ? decodeLabel(label.slice(4).toLowerCase()) : label))
      .join(".")
  );
}
