/**
 * /api request — build a curl command from the five modal fields.
 * Pure: imports only errors.js. Spec: 2026-09-03-api-request-design.md.
 */
import { InputError } from "../errors.js";

/**
 * Exactly `$NAME` or `${NAME}` — the WHOLE value. A "contains $VAR" rule was
 * rejected (design decision 5): `p$ss` would be double-quoted and `$ss` would
 * expand to nothing — a silent credential corruption.
 */
const PLACEHOLDER_RE = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/;

/** The five modal fields, raw — `""` for a field the user left blank. */
export interface RequestForm {
  url: string;
  method: string;
  auth: string;
  headers: string;
  body: string;
}

export interface RequestSpec {
  /** The typed string (scheme guaranteed) — never the WHATWG-normalised href. */
  url: string;
  /** Resolved, uppercase. */
  method: string;
  /** Resolved method ≠ what curl would infer ⇒ emit -X. HEAD emits -I regardless. */
  emitMethodFlag: boolean;
  auth:
    | { kind: "bearer"; token: string }
    | { kind: "basic"; credentials: string }
    | null;
  /** User headers, in order, duplicates kept. */
  headers: [string, string][];
  /** The automatic `Content-Type: application/json`. */
  contentTypeAdded: boolean;
  body: { kind: "json" | "raw"; text: string } | null;
  warnings: string[];
}

export const ERR_URL = "The URL is not valid.";
export const ERR_METHOD = "The method must be letters only.";
export const ERR_AUTH_BLANK = "The auth value is blank.";
export const ERR_AUTH_TWICE = "Authorization is given twice (auth field and headers).";
export const ERR_HEAD_BODY = "HEAD cannot carry a body.";
export const WARN_NO_SCHEME = "no scheme given — assumed https://";
export const WARN_RAW_BODY =
  "no Content-Type given — curl sends this body as application/x-www-form-urlencoded; add a Content-Type header if it should be something else";

/** WITH the slashes: a bare `:` would read `localhost:3000/x` as a scheme (decision 7). */
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
/** A scheme-like value with only ONE slash after the colon — `http:/x` — is a
 *  typo, not a bare host; without this it would be prefixed into a mangled
 *  `https://http:/x` that still validates under WHATWG (final review). */
const SCHEME_LIKE_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\//;
const METHOD_RE = /^[A-Za-z]+$/;

/** RFC 7230 tchar for the name; the value is everything after the colon and optional blanks. */
const HEADER_LINE_RE = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+):[ \t]*(.*)$/;

function parseUrl(raw: string, warnings: string[]): string {
  const typed = raw.trim();
  // `$` is a legal WHATWG host character, so `https://$URL` would validate
  // and the prefix would silently break the placeholder — short-circuit.
  if (PLACEHOLDER_RE.test(typed)) return typed;
  // WHATWG percent-encodes a space; curl 8 rejects it. Ours fires first.
  if (typed === "" || /\s/.test(typed)) throw new InputError(ERR_URL);
  const hasScheme = SCHEME_RE.test(typed);
  // A scheme-like typo (`http:/x`, one slash) or a protocol-relative value
  // (`//host/x`) reads as a mangled host once `https://` is prepended
  // (`https://http:/x`, `https:////host/x` both validate under WHATWG) —
  // reject instead. `localhost:3000/x` is unaffected: a digit follows its
  // colon, so SCHEME_LIKE_RE does not match.
  if (!hasScheme && (SCHEME_LIKE_RE.test(typed) || typed.startsWith("//"))) {
    throw new InputError(ERR_URL);
  }
  const url = hasScheme ? typed : "https://" + typed;
  try {
    new URL(url);
  } catch {
    throw new InputError(ERR_URL);
  }
  if (url !== typed) warnings.push(WARN_NO_SCHEME);
  return url;
}

function parseBody(raw: string): RequestSpec["body"] {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text === "") return null;
  try {
    JSON.parse(text);
    return { kind: "json", text };
  } catch {
    return { kind: "raw", text };
  }
}

function parseMethod(raw: string, hasBody: boolean): { method: string; emitMethodFlag: boolean } {
  const inferred = hasBody ? "POST" : "GET";
  const trimmed = raw.trim();
  if (trimmed === "") return { method: inferred, emitMethodFlag: false };
  // Validate on the TRIMMED value before uppercasing, so a non-ASCII letter
  // (`ß` → `SS`) is rejected instead of laundered into a valid-looking method.
  if (!METHOD_RE.test(trimmed)) throw new InputError(ERR_METHOD);
  const typed = trimmed.toUpperCase();
  return { method: typed, emitMethodFlag: typed !== inferred };
}

function parseHeaders(raw: string): [string, string][] {
  const out: [string, string][] = [];
  raw.replace(/\r\n?/g, "\n").split("\n").forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    const m = HEADER_LINE_RE.exec(trimmed);
    // The line NUMBER is derived from input structure (the locateJsonError
    // precedent); the line's content never reaches the message.
    if (!m) throw new InputError(`Header line ${i + 1} is not in Name: value form.`);
    out.push([m[1]!, m[2]!]);
  });
  return out;
}

function hasHeader(headers: [string, string][], lowerName: string): boolean {
  return headers.some(([name]) => name.toLowerCase() === lowerName);
}

function parseAuth(raw: string, headers: [string, string][]): RequestSpec["auth"] {
  const typed = raw.trim();
  if (typed === "") return null;
  if (hasHeader(headers, "authorization")) throw new InputError(ERR_AUTH_TWICE);
  // A typed "Bearer" prefix is an unambiguous intent signal and WINS over the
  // colon rule (final review, 2026-09-03): `Bearer abc:def` is a bearer token
  // `abc:def`, not `-u 'Bearer abc:def'`. The colon rule applies only when no
  // prefix was present.
  const stripped = typed.replace(/^bearer(?:\s+|$)/i, "");
  if (stripped !== typed) {
    if (stripped === "") throw new InputError(ERR_AUTH_BLANK);
    return { kind: "bearer", token: stripped };
  }
  if (typed.includes(":")) return { kind: "basic", credentials: typed };
  return { kind: "bearer", token: typed };
}

export function parseRequestForm(form: RequestForm): RequestSpec {
  const warnings: string[] = [];
  const url = parseUrl(form.url, warnings);
  const headers = parseHeaders(form.headers);
  const auth = parseAuth(form.auth, headers);
  const body = parseBody(form.body);
  let contentTypeAdded = false;
  if (body !== null && !hasHeader(headers, "content-type")) {
    if (body.kind === "json") contentTypeAdded = true;
    else warnings.push(WARN_RAW_BODY);
  }
  const { method, emitMethodFlag } = parseMethod(form.method, body !== null);
  // curl refuses `-I` together with `-d` (exit 2, nothing sent) — fail closed
  // at parse time rather than emit a command that cannot run.
  if (method === "HEAD" && body !== null) throw new InputError(ERR_HEAD_BODY);
  return { url, method, emitMethodFlag, auth, headers, contentTypeAdded, body, warnings };
}

/**
 * Shell-quote one argument. `literal` is the fixed part we wrote (a header
 * name, `Authorization: Bearer `), `value` the user's part. Single quotes
 * always, except when `value` is a placeholder: then double quotes so the
 * shell expands it, with the literal part escaped for that context.
 */
export function quoteArg(literal: string, value = ""): string {
  if (PLACEHOLDER_RE.test(value)) {
    return '"' + literal.replace(/["\\`$]/g, (c) => "\\" + c) + value + '"';
  }
  return "'" + (literal + value).replace(/'/g, "'\\''") + "'";
}

const STANDARD_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function headerArg(name: string, value: string): string {
  // `Name:` (no trailing space) when empty — curl's remove-this-header form, emitted as typed.
  return quoteArg(value === "" ? name + ":" : name + ": ", value);
}

/** The bare command — no comment lines, so tests can feed it straight to parseCurl. */
export function toCurl(spec: RequestSpec): string {
  const first = ["curl"];
  if (spec.method === "HEAD") first.push("-I");
  else if (spec.emitMethodFlag) first.push("-X", spec.method);
  first.push(quoteArg("", spec.url));
  const rest: string[] = [];
  if (spec.auth?.kind === "basic") rest.push("-u " + quoteArg("", spec.auth.credentials));
  if (spec.auth?.kind === "bearer") rest.push("-H " + quoteArg("Authorization: Bearer ", spec.auth.token));
  for (const [name, value] of spec.headers) rest.push("-H " + headerArg(name, value));
  if (spec.contentTypeAdded) rest.push("-H 'Content-Type: application/json'");
  if (spec.body !== null) {
    const flag = spec.body.text.startsWith("@") ? "--data-raw " : "-d ";
    rest.push(flag + quoteArg("", spec.body.text));
  }
  return [first.join(" "), ...rest].join(" \\\n  ");
}

/** For the log line only: a user-typed method is an argument, and arguments never reach a log. */
export function methodForLog(method: string): string {
  return STANDARD_METHODS.has(method) ? method : "custom";
}
