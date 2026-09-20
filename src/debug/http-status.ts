const HTTP_STATUS: Record<number, [name: string, meaning: string]> = {
  100: ["Continue", "Request headers received; client may send the body."],
  101: ["Switching Protocols", "Server agrees to switch protocols (e.g. WebSocket upgrade)."],
  200: ["OK", "Request succeeded."],
  201: ["Created", "Resource created; Location header usually points to it."],
  202: ["Accepted", "Accepted for async processing; not done yet."],
  204: ["No Content", "Success with an empty response body."],
  206: ["Partial Content", "Range request — partial body returned."],
  301: ["Moved Permanently", "Resource moved for good; update links. Method may change to GET."],
  302: ["Found", "Temporary redirect; method may change to GET."],
  303: ["See Other", "Redirect to a GET of another resource (post/redirect/get)."],
  304: ["Not Modified", "Cached copy is still valid — no body returned."],
  307: ["Temporary Redirect", "Temporary redirect preserving method and body."],
  308: ["Permanent Redirect", "Permanent redirect preserving method and body."],
  400: ["Bad Request", "Malformed request — client should fix and retry."],
  401: ["Unauthorized", "Missing or invalid authentication."],
  403: ["Forbidden", "Authenticated but not allowed."],
  404: ["Not Found", "Resource doesn't exist (or is hidden)."],
  405: ["Method Not Allowed", "HTTP method not supported here; check Allow header."],
  408: ["Request Timeout", "Server gave up waiting for the request."],
  409: ["Conflict", "State conflict — e.g. concurrent edit or duplicate."],
  410: ["Gone", "Deliberately removed for good — stop asking."],
  412: ["Precondition Failed", "If-Match / conditional header check failed."],
  413: ["Payload Too Large", "Body exceeds server limits."],
  415: ["Unsupported Media Type", "Content-Type not accepted."],
  418: ["I'm a teapot", "RFC 2324 April Fools — short and stout."],
  422: ["Unprocessable Content", "Syntax OK but semantically invalid (validation errors)."],
  425: ["Too Early", "Server won't risk a possibly replayed request."],
  426: ["Upgrade Required", "Switch protocols (see Upgrade header)."],
  428: ["Precondition Required", "Conditional request required (lost-update protection)."],
  429: ["Too Many Requests", "Rate limited — slow down; check Retry-After."],
  431: ["Request Header Fields Too Large", "Headers exceed server limits."],
  451: ["Unavailable For Legal Reasons", "Blocked for legal reasons."],
  500: ["Internal Server Error", "Server-side crash/bug — generic failure."],
  501: ["Not Implemented", "Server doesn't support this functionality."],
  502: ["Bad Gateway", "Upstream returned an invalid response to the proxy."],
  503: ["Service Unavailable", "Overloaded or down for maintenance; check Retry-After."],
  504: ["Gateway Timeout", "Upstream didn't answer the proxy in time."],
  507: ["Insufficient Storage", "Server out of space to complete the request."],
  511: ["Network Authentication Required", "Captive portal — authenticate to the network first."],
};

export function httpStatus(
  code: number,
): { name: string; meaning: string; category: string } | null {
  const entry = HTTP_STATUS[code];
  if (!entry) return null;
  const category =
    code < 200 ? "Informational"
    : code < 300 ? "Success"
    : code < 400 ? "Redirection"
    : code < 500 ? "Client error"
    : "Server error";
  return { name: entry[0], meaning: entry[1], category };
}
