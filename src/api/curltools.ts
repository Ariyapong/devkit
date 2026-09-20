import { InputError } from "../errors.js";
import { utf8ToBase64 } from "../shared/bytes.js";

const UNTERMINATED = "The curl command has an unterminated quote.";

/**
 * Shell-style word splitting, the subset a pasted curl line uses: '…' literal,
 * "…" with escapes, backslash-newline continuations, whitespace splits.
 *
 * `open` tracks "a token has started" separately from its content, so `''`
 * yields an empty token rather than disappearing.
 */
export function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let open = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === "'") {
      const end = raw.indexOf("'", i + 1);
      if (end === -1) throw new InputError(UNTERMINATED);
      cur += raw.slice(i + 1, end);
      open = true;
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      let closed = false;
      while (i < raw.length) {
        const c = raw[i]!;
        if (c === "\\" && i + 1 < raw.length) {
          const next = raw[i + 1]!;
          // Only these four are escapes inside shell double quotes; any other
          // backslash is literal and must survive into the token.
          cur += next === '"' || next === "\\" || next === "$" || next === "`"
            ? next
            : "\\" + next;
          i += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        cur += c;
        i++;
      }
      if (!closed) throw new InputError(UNTERMINATED);
      open = true;
      continue;
    }
    if (ch === "\\" && raw[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (ch === "\\" && raw[i + 1] === "\r" && raw[i + 2] === "\n") {
      i += 3;
      continue;
    }
    if (ch === "\\" && i + 1 < raw.length) {
      cur += raw[i + 1]!;
      open = true;
      i += 2;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (open) {
        tokens.push(cur);
        cur = "";
        open = false;
      }
      i++;
      continue;
    }
    cur += ch;
    open = true;
    i++;
  }
  if (open) tokens.push(cur);
  return tokens;
}

/**
 * Whitespace removed outside string literals. Used only to compare a raw body
 * against its re-serialized parse — see jsonRoundTrips.
 */
export function minifyJson(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === '"') {
      const start = i;
      i++;
      while (i < raw.length) {
        if (raw[i] === "\\") {
          i += 2;
          continue;
        }
        if (raw[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out += raw.slice(start, i);
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * A PROOF that re-emitting `parsed` loses nothing: if the re-serialized parse is
 * character-identical to the minified source, no number was rounded, no key was
 * collapsed or reordered, no escape was rewritten.
 *
 * Never replace this with a heuristic. A "16+ consecutive digits" rule was
 * written first and missed 1e400 (⇒ null), duplicate keys, integer-key
 * reordering and -0, while false-firing on snowflake strings — see the spec's
 * decision 4 table.
 */
export function jsonRoundTrips(raw: string, parsed: unknown): boolean {
  return JSON.stringify(parsed) === minifyJson(raw);
}

/**
 * `__proto__: v` in an object literal SETS THE PROTOTYPE rather than creating an
 * own property, and quoting the key does not help. JSON.parse does not invoke
 * that setter, so such a payload round-trips perfectly and still corrupts when
 * re-emitted as source — the guard has to be separate.
 */
export function hasProtoKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasProtoKey);
  if (typeof value !== "object" || value === null) return false;
  for (const [key, child] of Object.entries(value)) {
    if (key === "__proto__") return true;
    if (hasProtoKey(child)) return true;
  }
  return false;
}

export interface CurlRequest {
  url: string;
  method: string;
  headers: [string, string][];
  body: { kind: "json"; value: unknown } | { kind: "raw"; text: string } | null;
  notTranslated: string[];
}

/** Flags whose value is the following token (or attached, for short forms). */
const VALUE_FLAGS = new Set([
  "-X", "--request", "-H", "--header", "-u", "--user", "-b", "--cookie",
  "-A", "--user-agent", "-e", "--referer", "--url",
  "-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--json",
]);

/** `@value` means "read a file" for these, but is literal text for --data-raw. */
const FILE_AWARE_DATA = new Set(["-d", "--data", "--data-binary", "--data-ascii"]);

/** Changes only curl's output or exit code — never the request on the wire. */
const IGNORED = new Set([
  "-s", "--silent", "-v", "--verbose", "-i", "--include", "-f", "--fail",
  "-S", "--show-error", "-#", "--progress-bar", "-L", "--location",
  // --compressed DOES add Accept-Encoding, but fetch sends its own and the
  // header is forbidden in browsers, so re-emitting it would be stripped.
  "--compressed",
]);
const IGNORED_WITH_VALUE = new Set(["-o", "--output", "--retry", "-m", "--max-time", "--connect-timeout"]);

/** Would change the request; dropped WITH a named warning. */
const UNSUPPORTED_NOTES = new Map<string, string>([
  ["-F", "-F/--form (multipart body omitted)"],
  ["--form", "-F/--form (multipart body omitted)"],
  ["--data-urlencode", "--data-urlencode (url-encoding not applied)"],
  ["-k", "-k/--insecure (fetch cannot skip certificate checks)"],
  ["--insecure", "-k/--insecure (fetch cannot skip certificate checks)"],
  ["-T", "-T/--upload-file (file body unavailable)"],
  ["--upload-file", "-T/--upload-file (file body unavailable)"],
  ["-x", "--proxy (no fetch equivalent)"],
  ["--proxy", "--proxy (no fetch equivalent)"],
  ["--cert", "--cert (client certificates unsupported)"],
  ["--key", "--key (client certificates unsupported)"],
  ["--cacert", "--cacert (client certificates unsupported)"],
  ["--interface", "--interface (no fetch equivalent)"],
  ["--limit-rate", "--limit-rate (no fetch equivalent)"],
]);
/** Every unsupported flag except -k/--insecure carries a value to consume. */
const UNSUPPORTED_WITH_VALUE = new Set(
  [...UNSUPPORTED_NOTES.keys()].filter((f) => f !== "-k" && f !== "--insecure"),
);

/**
 * True for any flag that consumes a value — the union of every table a
 * value-taking flag can appear in. One definition, used at all three call
 * sites that ask this question (expandShortClusters, the attached-value
 * split, and the arg loop's dispatch). Before this was extracted, the
 * attached-value split asked a narrower question (VALUE_FLAGS only), so an
 * attached tier-2/tier-3 flag like `-oout.txt` survived as one opaque token
 * and fell through to the per-letter unknown-flag loop, fabricating warnings
 * (a false `--proxy` note from the "x" in ".txt", among others).
 */
function takesValueFlag(flag: string): boolean {
  return (
    VALUE_FLAGS.has(flag) ||
    IGNORED_WITH_VALUE.has(flag) ||
    UNSUPPORTED_WITH_VALUE.has(flag)
  );
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * URL-shaped, not merely bare: an unknown flag's value would otherwise be taken
 * as the url. Known value-taking flags consume their own value; this covers the
 * ones we cannot know.
 *
 * Shape alone is not enough — `foo.txt` and `api.x.com` are indistinguishable
 * by any honest rule, so selection PREFERS a scheme-bearing candidate (below).
 */
function looksLikeUrl(token: string): boolean {
  if (SCHEME_RE.test(token)) return true;
  if (token.startsWith("localhost")) return true;
  const slash = token.indexOf("/");
  const head = slash === -1 ? token : token.slice(0, slash);
  return head.includes(".");
}

function splitHeader(value: string): [string, string] {
  const at = value.indexOf(":");
  if (at === -1) return [value, ""];
  return [value.slice(0, at).trim(), value.slice(at + 1).trim()];
}

function basicAuth(value: string, note: (n: string) => void): string {
  const at = value.indexOf(":");
  if (at === -1) {
    note("-u/--user without a password (curl would prompt; sent empty)");
    return "Basic " + utf8ToBase64(`${value}:`);
  }
  return "Basic " + utf8ToBase64(value);
}

/**
 * Depth joins the other fail-safe gates rather than raising an error: the
 * verbatim literal is always correct, so a body too deep to pretty-print is
 * emitted as-is. Bounded recursion — this function itself cannot overflow,
 * which is why it must run BEFORE the unbounded checks below it.
 */
const MAX_BODY_DEPTH = 100;

function exceedsDepth(value: unknown, depth: number): boolean {
  if (depth > MAX_BODY_DEPTH) return true;
  if (Array.isArray(value)) return value.some((v) => exceedsDepth(v, depth + 1));
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some((v) => exceedsDepth(v, depth + 1));
}

/**
 * The object form is emitted only when it is PROVABLY lossless and safe to
 * re-emit as source. Four gates, each fail-safe toward the verbatim literal:
 * object-or-array (a scalar gains nothing), depth cap (recursion below here
 * is unbounded), round-trip proof, no __proto__ key.
 */
function chooseBody(parts: string[]): CurlRequest["body"] {
  if (parts.length === 0) return null;
  const text = parts.join("&");
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value === "object" &&
      value !== null &&
      !exceedsDepth(value, 1) &&
      jsonRoundTrips(text, value) &&
      !hasProtoKey(value)
    ) {
      return { kind: "json", value };
    }
  } catch {
    // not json — fall through to the verbatim literal
  }
  return { kind: "raw", text };
}

/**
 * `-sX POST` must reach the switch as `-s` then `-X POST`, or -X's value is
 * never consumed and the method is lost. A value-taking letter stops the
 * expansion and keeps the remainder as its attached value, so `-sXPOST`
 * becomes `-s` + `-XPOST`.
 */
function expandShortClusters(tokens: string[]): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("--") || !token.startsWith("-") || token.length <= 2) {
      out.push(token);
      continue;
    }
    let rest = token;
    while (rest.length > 2) {
      const head = rest.slice(0, 2);
      if (takesValueFlag(head)) {
        break;
      }
      out.push(head);
      rest = "-" + rest.slice(2);
    }
    out.push(rest);
  }
  return out;
}

export function parseCurl(raw: string): CurlRequest {
  if (raw.trim() === "") throw new InputError("The curl command is blank.");
  const tokens = expandShortClusters(tokenize(raw));
  if (tokens[0] === "curl") tokens.shift();

  const headers: [string, string][] = [];
  const notes: string[] = [];
  const note = (n: string): void => {
    if (!notes.includes(n)) notes.push(n);
  };

  const candidates: string[] = [];
  let explicitUrl = "";
  let explicitMethod = "";
  let head = false;
  const dataParts: string[] = [];
  let query = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token.startsWith("-") || token === "-") {
      if (looksLikeUrl(token)) candidates.push(token);
      continue;
    }

    // Split `--flag=value`, and short flags with an attached value (-XPOST).
    let flag = token;
    let inline: string | null = null;
    const eq = token.indexOf("=");
    if (token.startsWith("--") && eq !== -1) {
      flag = token.slice(0, eq);
      inline = token.slice(eq + 1);
    } else if (!token.startsWith("--") && token.length > 2 && takesValueFlag(token.slice(0, 2))) {
      flag = token.slice(0, 2);
      inline = token.slice(2);
    }

    const takesValue = takesValueFlag(flag);
    const value = inline ?? (takesValue ? (tokens[++i] ?? "") : "");

    switch (flag) {
      case "-X":
      case "--request":
        explicitMethod = value.toUpperCase();
        break;
      case "-H":
      case "--header": {
        // A value-taking flag with nothing after it (curl ... -H as the
        // final token) splits to an empty name, which would emit
        // headers: {"": ""} — a TypeError when the snippet runs.
        const header = splitHeader(value);
        if (header[0].trim() !== "") headers.push(header);
        break;
      }
      case "-u":
      case "--user":
        headers.push(["Authorization", basicAuth(value, note)]);
        break;
      case "-b":
      case "--cookie":
        if (value.includes("=")) headers.push(["Cookie", value]);
        else note("-b/--cookie with a file (cookie file unavailable)");
        break;
      case "-A":
      case "--user-agent":
        headers.push(["User-Agent", value]);
        break;
      case "-e":
      case "--referer":
        headers.push(["Referer", value]);
        break;
      case "--url":
        if (explicitUrl === "") explicitUrl = value;
        else note("multiple urls (only the first is converted)");
        break;
      case "-I":
      case "--head":
        head = true;
        break;
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
        if (FILE_AWARE_DATA.has(flag) && value.startsWith("@")) {
          note("-d @file (file body unavailable)");
        } else {
          dataParts.push(value);
        }
        break;
      case "--json":
        if (value.startsWith("@")) {
          note("--json @file (file body unavailable)");
        } else {
          dataParts.push(value);
        }
        for (const [name, v] of [
          ["Content-Type", "application/json"],
          ["Accept", "application/json"],
        ] as [string, string][]) {
          const already = headers.some(
            ([h]) => h.toLowerCase() === name.toLowerCase(),
          );
          if (!already) headers.push([name, v]);
        }
        break;
      case "-G":
      case "--get":
        query = true;
        break;
      default: {
        if (IGNORED.has(flag) || IGNORED_WITH_VALUE.has(flag)) break;
        const known = UNSUPPORTED_NOTES.get(flag);
        if (known !== undefined) {
          note(known);
          break;
        }
        if (flag.startsWith("--")) {
          note(`${flag} (not translated)`);
          break;
        }
        // A short cluster like -sZQ: report each unknown letter separately.
        for (const letter of flag.slice(1)) {
          const single = `-${letter}`;
          if (IGNORED.has(single)) continue;
          const mapped = UNSUPPORTED_NOTES.get(single);
          note(mapped ?? `${single} (not translated)`);
        }
        break;
      }
    }
  }

  // A scheme-bearing candidate always wins: it is the only way to tell a real
  // url from an unknown flag's value (`--frobnicate foo.txt https://a.co`),
  // and every DevTools "Copy as cURL" emits one. Scheme-less support survives
  // for `curl api.x.com`, where there is nothing to disambiguate against.
  const withScheme = candidates.filter((c) => SCHEME_RE.test(c));
  const pool = withScheme.length > 0 ? withScheme : candidates;
  // With an explicit --url, only a SCHEME-BEARING candidate counts as a second
  // url. `candidates` deliberately collects url-shaped values of unknown flags,
  // and --url leaves no bare url to outrank them, so counting the whole pool
  // reported `--url https://a.co --frobnicate foo.txt` as two urls when there
  // is one — the same fabricated-warning class as the flag-table mismatch.
  const multipleUrls =
    explicitUrl !== "" ? withScheme.length > 0 : pool.length > 1;
  if (multipleUrls) note("multiple urls (only the first is converted)");
  let url = explicitUrl !== "" ? explicitUrl : (pool[0] ?? "");

  if (url === "") throw new InputError("No URL found in the curl command.");
  if (!SCHEME_RE.test(url)) {
    url = "http://" + url;
    note("scheme-less url (curl defaults to http://)");
  }

  // -G moves the data into the query REGARDLESS of the method: `-X POST -G`
  // sends POST with the data in the query and no body, exactly as curl does.
  let body: CurlRequest["body"] = null;
  if (query) {
    if (dataParts.length > 0) {
      url += (url.includes("?") ? "&" : "?") + dataParts.join("&");
    }
  } else {
    body = chooseBody(dataParts);
  }

  // curl's -d/--data family implies this Content-Type on the whole request
  // whenever a body is sent, regardless of method or body shape — fetch has
  // no such default (text/plain), so form endpoints 415 or mis-parse without
  // it. Runs AFTER the arg loop so an explicit -H 'Content-Type: …' always
  // wins, and after --json's own header push above so it is never doubled.
  if (
    body !== null &&
    !headers.some(([h]) => h.toLowerCase() === "content-type")
  ) {
    headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
  }

  const method =
    explicitMethod !== ""
      ? explicitMethod
      : head
        ? "HEAD"
        : query
          ? "GET"
          : body !== null
            ? "POST"
            : "GET";

  // fetch throws `TypeError: Request with GET/HEAD method cannot have body`;
  // curl sends it happily (the Elasticsearch idiom: -X GET -d '{...}'). Name
  // the gap rather than silently stripping the body — same contract as every
  // other tier-3 warning.
  if ((method === "GET" || method === "HEAD") && body !== null) {
    note("a body on GET/HEAD (fetch forbids it)");
  }

  return {
    url,
    method,
    headers,
    body,
    notTranslated: [...notes].sort(),
  };
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Double-quoted JS string literal. Control characters are detected by CODE
 * POINT, never by a \u-range regex — escape-flattening has corrupted such a
 * regex in this repo twice, once into raw NUL bytes.
 */
function jsString(text: string): string {
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    // A lone (unpaired) surrogate has no valid UTF-8 encoding on its own —
    // left raw it round-trips as U+FFFD in transit, sending different bytes
    // than the pasted snippet. Code-point comparison only, never a \u-range
    // regex: escape-flattening has corrupted such a regex here twice before.
    else if (code >= 0xd800 && code <= 0xdfff) {
      out += "\\u" + code.toString(16).padStart(4, "0");
    } else out += ch;
  }
  return out + '"';
}

/** Pretty JS literal. Reached only for values that passed chooseBody's gates. */
function jsLiteral(value: unknown, indent: string): string {
  if (value === null) return "null";
  if (typeof value === "string") return jsString(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${inner}${jsLiteral(v, inner)},`);
    return ["[", ...items, `${indent}]`].join("\n");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  const lines = entries.map(([key, v]) => {
    const name = IDENT_RE.test(key) ? key : jsString(key);
    return `${inner}${name}: ${jsLiteral(v, inner)},`;
  });
  return ["{", ...lines, `${indent}}`].join("\n");
}

/**
 * Object form only when every name is unique case-insensitively and none is
 * `__proto__` — in an object literal that key sets the prototype even quoted.
 * Otherwise the pair-array form, which is valid HeadersInit and keeps both.
 */
function headersLiteral(headers: [string, string][]): string {
  const lower = headers.map(([name]) => name.toLowerCase());
  const safe =
    new Set(lower).size === lower.length && !lower.includes("__proto__");
  if (!safe) {
    const pairs = headers.map(([n, v]) => `[${jsString(n)}, ${jsString(v)}]`);
    return `[${pairs.join(", ")}]`;
  }
  const lines = headers.map(([n, v]) => `    ${jsString(n)}: ${jsString(v)},`);
  return ["{", ...lines, "  }"].join("\n");
}

export function toFetch(req: CurlRequest): string {
  const lines: string[] = req.notTranslated.map(
    (n) => `// ⚠ not translated: ${n}`,
  );
  lines.push(`await fetch(${jsString(req.url)}, {`);
  lines.push(`  method: ${jsString(req.method)},`);
  if (req.headers.length > 0) {
    lines.push(`  headers: ${headersLiteral(req.headers)},`);
  }
  if (req.body?.kind === "json") {
    lines.push(`  body: JSON.stringify(${jsLiteral(req.body.value, "  ")}),`);
  } else if (req.body?.kind === "raw") {
    lines.push(`  body: ${jsString(req.body.text)},`);
  }
  lines.push("});");
  return lines.join("\n");
}
