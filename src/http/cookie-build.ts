// Set-Cookie builder: form to header string, Express and .NET snippets, and the inverse.

import { InputError } from "../errors.js";
import { parseCookieDate } from "./cookie-date.js";
import { parseSetCookie } from "./cookie-parse.js";
import type { ParsedCookie } from "./cookie-types.js";

export interface SetCookieForm {
  name: string;
  value: string;
  domain: string;
  path: string;
  lifetime: "session" | "max-age" | "expires";
  maxAge: string; // raw digits as typed; seconds
  expires: string; // raw as typed; any form parseCookieDate accepts
  secure: boolean;
  httpOnly: boolean;
  partitioned: boolean;
  sameSite: "" | "Strict" | "Lax" | "None";
  priority: "" | "Low" | "Medium" | "High";
}

export interface BuiltSetCookie {
  header: string; // the Set-Cookie value, no "Set-Cookie: " prefix
  cookie: ParsedCookie; // the header re-parsed, audit filled
  express: string; // res.cookie(...) snippet
  dotnet: string; // CookieOptions snippet
}

export const ERR_COOKIE_NAME = "The cookie needs a name.";
export const ERR_MAX_AGE = "Max-Age must be a whole number of seconds.";
export const ERR_EXPIRES = "Expires isn't a date browsers can read.";

const NO_COOKIE_OPTIONS_NOTE = "// Partitioned and Priority have no CookieOptions property; append them to the header yourself.";

function expressSnippet(form: SetCookieForm, expiresMs: number | null): string {
  const lines: string[] = [];
  if (form.domain !== "") lines.push(`  domain: ${JSON.stringify(form.domain)},`);
  if (form.path !== "") lines.push(`  path: ${JSON.stringify(form.path)},`);
  if (form.lifetime === "max-age") lines.push(`  maxAge: ${form.maxAge} * 1000,        // Express takes milliseconds`);
  if (expiresMs !== null) lines.push(`  expires: new Date(${JSON.stringify(new Date(expiresMs).toISOString())}),`);
  if (form.secure) lines.push("  secure: true,");
  if (form.httpOnly) lines.push("  httpOnly: true,");
  if (form.sameSite !== "") lines.push(`  sameSite: ${JSON.stringify(form.sameSite.toLowerCase())},            // lowercase, as Express expects`);
  if (form.partitioned) lines.push("  partitioned: true,");
  if (form.priority !== "") lines.push(`  priority: ${JSON.stringify(form.priority.toLowerCase())},`);
  return [`res.cookie(${JSON.stringify(form.name)}, ${JSON.stringify(form.value)}, {`, ...lines, "});"].join("\n");
}

function dotnetSnippet(form: SetCookieForm, expiresMs: number | null): string {
  const lines: string[] = [];
  if (form.domain !== "") lines.push(`    Domain = ${JSON.stringify(form.domain)},`);
  if (form.path !== "") lines.push(`    Path = ${JSON.stringify(form.path)},`);
  if (form.lifetime === "max-age") lines.push(`    MaxAge = TimeSpan.FromSeconds(${form.maxAge}),`);
  if (expiresMs !== null) {
    const iso = new Date(expiresMs).toISOString().replace(".000Z", "Z");
    lines.push(`    Expires = DateTimeOffset.Parse(${JSON.stringify(iso)}),`);
  }
  if (form.secure) lines.push("    Secure = true,");
  if (form.httpOnly) lines.push("    HttpOnly = true,");
  if (form.sameSite !== "") lines.push(`    SameSite = SameSiteMode.${form.sameSite},   // SameSiteMode.None / Strict`);
  if (form.partitioned || form.priority !== "") lines.push(`    ${NO_COOKIE_OPTIONS_NOTE}`);
  return [`Response.Cookies.Append(${JSON.stringify(form.name)}, ${JSON.stringify(form.value)}, new CookieOptions`, "{", ...lines, "});"].join("\n");
}

export function buildSetCookie(form: SetCookieForm, opts?: { nowMs?: number }): BuiltSetCookie {
  const nowMs = opts?.nowMs ?? Date.now();
  if (form.name.trim() === "") throw new InputError(ERR_COOKIE_NAME);
  if (form.lifetime === "max-age" && !/^-?[0-9]+$/.test(form.maxAge)) throw new InputError(ERR_MAX_AGE);
  let expiresMs: number | null = null;
  if (form.lifetime === "expires") {
    expiresMs = parseCookieDate(form.expires);
    if (expiresMs === null) throw new InputError(ERR_EXPIRES);
  }

  const parts = [`${form.name}=${form.value}`];
  if (expiresMs !== null) parts.push(`Expires=${new Date(expiresMs).toUTCString()}`);
  if (form.lifetime === "max-age") parts.push(`Max-Age=${form.maxAge}`);
  if (form.domain !== "") parts.push(`Domain=${form.domain}`);
  if (form.path !== "") parts.push(`Path=${form.path}`);
  if (form.secure) parts.push("Secure");
  if (form.httpOnly) parts.push("HttpOnly");
  if (form.sameSite !== "") parts.push(`SameSite=${form.sameSite}`);
  if (form.partitioned) parts.push("Partitioned");
  if (form.priority !== "") parts.push(`Priority=${form.priority}`);
  const header = parts.join("; ");

  return {
    header,
    cookie: parseSetCookie(header, { nowMs }),
    express: expressSnippet(form, expiresMs),
    dotnet: dotnetSnippet(form, expiresMs),
  };
}

export function formFromCookie(cookie: ParsedCookie): SetCookieForm {
  const a = cookie.attributes;
  const form: SetCookieForm = {
    name: cookie.name,
    value: cookie.value,
    domain: a?.domain ?? "",
    path: a?.path ?? "",
    lifetime: "session",
    maxAge: "",
    expires: "",
    secure: a?.secure ?? false,
    httpOnly: a?.httpOnly ?? false,
    partitioned: a?.partitioned ?? false,
    sameSite: a?.sameSite ?? "",
    priority: a?.priority ?? "",
  };
  if (a === null) return form;
  if (a.maxAge !== null) {
    form.lifetime = "max-age";
    form.maxAge = String(a.maxAge);
  } else if (a.expires !== null) {
    const l = cookie.lifetime;
    form.lifetime = "expires";
    form.expires = l !== null && (l.kind === "expires" || l.kind === "expired") ? new Date(l.atMs).toISOString() : a.expires;
  }
  return form;
}
