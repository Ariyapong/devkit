/**
 * Curated error-code tables — sized for usefulness, not completeness. Widen
 * only against an observed miss (house rule), never speculatively.
 * lookupErrCode is permissive (explicit /debug err intent); scanErrTokens is
 * strict (implicit context inside someone else's paste).
 */
export interface ErrInfo {
  code: string;
  meaning: string;
  family: "errno" | "http" | "dotnet" | "exit";
}

const ERRNO: Record<string, string> = {
  ECONNREFUSED: "the target actively refused the connection — nothing is listening on that host:port",
  ECONNRESET: "the peer closed the connection abruptly mid-conversation",
  ETIMEDOUT: "the operation timed out — host unreachable, firewalled, or too slow",
  ENOTFOUND: "DNS lookup failed — the hostname does not resolve",
  EAI_AGAIN: "transient DNS failure — the resolver timed out, retry usually works",
  EADDRINUSE: "the port is already taken by another process",
  EACCES: "permission denied — insufficient rights for the file or port",
  EPERM: "operation not permitted — blocked by OS policy or ownership",
  ENOENT: "no such file or directory",
  EPIPE: "wrote to a closed pipe or socket — the reader went away",
  EMFILE: "too many open files — file-descriptor limit hit",
  ENOMEM: "out of memory",
  EHOSTUNREACH: "no route to host",
  ENETUNREACH: "network unreachable",
  EEXIST: "file already exists",
  EISDIR: "expected a file but found a directory",
  ENOTDIR: "expected a directory but found a file",
  EROFS: "read-only file system",
  ENOSPC: "no space left on device",
  ELOOP: "too many symlink hops — likely a symlink loop",
};

const HTTP: Record<string, string> = {
  "200": "OK — success",
  "201": "Created",
  "204": "No Content — success with an empty body",
  "301": "Moved Permanently — permanent redirect",
  "302": "Found — temporary redirect",
  "304": "Not Modified — cached copy is still valid",
  "307": "Temporary Redirect — method preserved",
  "308": "Permanent Redirect — method preserved",
  "400": "Bad Request — the server rejected the request shape",
  "401": "Unauthorized — missing or invalid credentials",
  "403": "Forbidden — authenticated but not allowed",
  "404": "Not Found",
  "405": "Method Not Allowed — wrong HTTP verb for this route",
  "406": "Not Acceptable — content negotiation failed",
  "408": "Request Timeout — the client was too slow",
  "409": "Conflict — usually a versioning or duplicate-state clash",
  "410": "Gone — existed once, deliberately removed",
  "412": "Precondition Failed — an If-* header did not match",
  "413": "Payload Too Large",
  "415": "Unsupported Media Type — wrong Content-Type",
  "418": "I'm a teapot",
  "422": "Unprocessable Entity — valid syntax, invalid semantics",
  "425": "Too Early — replay risk, retry later",
  "426": "Upgrade Required",
  "428": "Precondition Required",
  "429": "Too Many Requests — rate limited; honor Retry-After",
  "431": "Request Header Fields Too Large",
  "451": "Unavailable For Legal Reasons",
  "500": "Internal Server Error — unhandled failure on the server",
  "501": "Not Implemented",
  "502": "Bad Gateway — the upstream behind the proxy returned garbage or nothing",
  "503": "Service Unavailable — overloaded or down for maintenance",
  "504": "Gateway Timeout — the upstream behind the proxy was too slow",
  "505": "HTTP Version Not Supported",
};

const DOTNET: Record<string, string> = {
  NullReferenceException: "used an object reference that is null — find what was never initialized",
  ArgumentNullException: "a required argument was passed as null",
  ArgumentException: "an argument was invalid for that method",
  ArgumentOutOfRangeException: "an argument fell outside the allowed range",
  InvalidOperationException: "the object's current state does not allow that call",
  IndexOutOfRangeException: "array or list index outside its bounds",
  KeyNotFoundException: "dictionary lookup for a key that is not there",
  FormatException: "string parse failed — input not in the expected format",
  InvalidCastException: "cast between incompatible types",
  TaskCanceledException: "an async task was cancelled — often an HttpClient timeout in disguise",
  OperationCanceledException: "the operation observed a cancellation token",
  TimeoutException: "the operation exceeded its time limit",
  HttpRequestException: "the HTTP request failed at the network or protocol level",
  ObjectDisposedException: "used an object after it was disposed",
  StackOverflowException: "runaway recursion exhausted the stack",
  OutOfMemoryException: "the runtime could not allocate memory",
  FileNotFoundException: "the file was not found",
  UnauthorizedAccessException: "the OS denied access — permissions or a locked file",
  JsonException: "JSON (de)serialization failed — shape mismatch or malformed JSON",
  AggregateException: "one or more wrapped task failures — read InnerExceptions",
};

const EXIT: Record<string, string> = {
  "1": "generic failure — the process exited with an unspecified error",
  "2": "shell builtin misuse or bad usage",
  "126": "command found but not executable",
  "127": "command not found",
  "130": "terminated by Ctrl-C (SIGINT)",
  "134": "aborted (SIGABRT) — often a failed assertion or runtime abort",
  "137": "killed by SIGKILL — usually the OOM killer or docker kill",
  "139": "segmentation fault (SIGSEGV)",
  "143": "terminated by SIGTERM — polite shutdown request",
  SIGKILL: "force-killed, cannot be caught — usually the OOM killer or kill -9",
  SIGTERM: "polite termination request — the default kill signal",
  SIGSEGV: "segmentation fault — invalid memory access",
  SIGINT: "interrupt — Ctrl-C",
  SIGABRT: "abort — runtime or assertion failure",
  SIGHUP: "hangup — the controlling terminal closed",
};

function fromTable(
  table: Record<string, string>,
  key: string,
  family: ErrInfo["family"],
): ErrInfo | null {
  const meaning = table[key];
  return meaning === undefined ? null : { code: key, meaning, family };
}

export function lookupErrCode(query: string): ErrInfo | null {
  const q = query.trim();
  if (q === "") return null;
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    const str = String(n);
    // Try HTTP first if in the typical HTTP status range
    if (n >= 100 && n <= 599) {
      const httpResult = fromTable(HTTP, str, "http");
      if (httpResult) return httpResult;
    }
    // Fall back to exit code
    return fromTable(EXIT, str, "exit");
  }
  const upper = q.toUpperCase();
  if (upper.startsWith("SIG")) return fromTable(EXIT, upper, "exit");
  const last = q.split(".").pop() ?? q;
  if (/exception$/i.test(last)) {
    const found = Object.entries(DOTNET).find(
      ([name]) => name.toLowerCase() === last.toLowerCase(),
    );
    return found === undefined
      ? null
      : { code: found[0], meaning: found[1], family: "dotnet" };
  }
  return fromTable(ERRNO, upper, "errno");
}

const ERRNO_TOKEN_RE = /\bE[A-Z]{2,}(?:_[A-Z]+)?\b/g;
const DOTNET_TOKEN_RE = /\b(?:[A-Za-z_][\w.]*\.)?([A-Z][A-Za-z]*Exception)\b/g;
const HTTP_CONTEXT_RE =
  /\b(?:HTTP|status(?:\s*code)?)\s*[:=]?\s*([1-5]\d{2})\b|\b([1-5]\d{2})\s+(?:Bad Request|Unauthorized|Forbidden|Not Found|Method Not Allowed|Request Timeout|Conflict|Gone|Unprocessable|Too Many Requests|Internal Server Error|Not Implemented|Bad Gateway|Service Unavailable|Gateway Timeout)\b/gi;
const EXIT_CODE_RE = /\bexit(?:ed)?(?:\s+with)?\s+code\s+(\d{1,3})\b/gi;
const SIGNAL_RE = /\b(SIG(?:KILL|TERM|SEGV|INT|ABRT|HUP))\b/g;

export function scanErrTokens(text: string): ErrInfo[] {
  const out: ErrInfo[] = [];
  const seen = new Set<string>();
  const push = (info: ErrInfo | null): void => {
    if (info === null || seen.has(info.code) || out.length >= 3) return;
    seen.add(info.code);
    out.push(info);
  };
  for (const m of text.matchAll(ERRNO_TOKEN_RE)) push(fromTable(ERRNO, m[0], "errno"));
  for (const m of text.matchAll(DOTNET_TOKEN_RE)) {
    const name = m[1];
    if (name !== undefined) push(fromTable(DOTNET, name, "dotnet"));
  }
  for (const m of text.matchAll(HTTP_CONTEXT_RE)) {
    const code = m[1] ?? m[2];
    if (code !== undefined) push(fromTable(HTTP, code, "http"));
  }
  for (const m of text.matchAll(EXIT_CODE_RE)) {
    const code = m[1];
    if (code !== undefined) push(fromTable(EXIT, code, "exit"));
  }
  for (const m of text.matchAll(SIGNAL_RE)) {
    const sig = m[1];
    if (sig !== undefined) push(fromTable(EXIT, sig, "exit"));
  }
  return out;
}

export function allErrCodes(): string[] {
  return [
    ...Object.keys(ERRNO),
    ...Object.keys(HTTP),
    ...Object.keys(DOTNET),
    ...Object.keys(EXIT),
  ];
}
