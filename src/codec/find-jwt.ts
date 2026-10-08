// JWT headers are JSON objects, so base64url always starts with "eyJ" ({").
// Three non-empty dot-separated base64url parts by default; unsecured JWTs
// with an empty signature (spec §A) are matched only on request.
const JWT_RE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/;
const JWT_UNSECURED_RE = /\beyJ[\w-]+\.[\w-]+\.[\w-]*/;

export function findJwt(text: string, opts: { allowUnsecured?: boolean } = {}): string | null {
  const re = opts.allowUnsecured ? JWT_UNSECURED_RE : JWT_RE;
  return re.exec(text)?.[0] ?? null;
}
