// JWT headers are JSON objects, so base64url always starts with "eyJ" ({").
// Three non-empty dot-separated base64url parts; unsecured JWTs with an
// empty signature are deliberately not matched (spec §A).
const JWT_RE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/;

export function findJwt(text: string): string | null {
  return JWT_RE.exec(text)?.[0] ?? null;
}
