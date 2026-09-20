import { InputError } from "../errors.js";
import { base64ToBytes, bytesEqual, bytesToHex, bytesToUtf8Lossy, utf8ToBase64, utf8ToBytes } from "../shared/bytes.js";

export function base64Encode(text: string): string {
  return utf8ToBase64(text);
}

export function base64Decode(
  input: string,
): { ok: true; text: string } | { ok: false; hexPreview: string } {
  const cleaned = input.replace(/\s/g, "");
  const bytes = base64ToBytes(cleaned);
  if (cleaned.length > 0 && bytes.length === 0) {
    throw new InputError("Not valid base64.");
  }
  const text = bytesToUtf8Lossy(bytes);
  // Round-trip check (today's algorithm verbatim): if re-encoding the decoded
  // text loses bytes, the payload wasn't UTF-8 text — show hex instead of mojibake.
  if (bytesEqual(utf8ToBytes(text), bytes)) return { ok: true, text };
  return { ok: false, hexPreview: bytesToHex(bytes.subarray(0, 64)) };
}

export function urlEncode(text: string): string {
  try {
    return encodeURIComponent(text);
  } catch {
    throw new InputError("Text contains an unpaired surrogate.");
  }
}

export function urlDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    throw new InputError("Malformed percent-encoding.");
  }
}

export interface JwtInfo {
  header: unknown;
  payload: Record<string, unknown>;
  times: { claim: string; epochSeconds: number }[];
  /** Negative ⇒ expired that long ago; null ⇒ no exp claim. */
  expiresInMs: number | null;
}

function decodeJwtPart(part: string, label: string): unknown {
  try {
    return JSON.parse(bytesToUtf8Lossy(base64ToBytes(part)));
  } catch {
    throw new InputError(`JWT ${label} is not base64url-encoded JSON.`);
  }
}

export function decodeJwt(token: string, nowMs = Date.now()): JwtInfo {
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    throw new InputError("A JWT has 3 dot-separated parts (header.payload.signature).");
  }
  const header = decodeJwtPart(parts[0]!, "header");
  const payload = decodeJwtPart(parts[1]!, "payload");
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InputError("JWT payload is not a JSON object.");
  }
  const claims = payload as Record<string, unknown>;
  const times: { claim: string; epochSeconds: number }[] = [];
  for (const claim of ["iat", "nbf", "exp"]) {
    const value = claims[claim];
    if (typeof value === "number") times.push({ claim, epochSeconds: value });
  }
  const exp = claims["exp"];
  const expiresInMs = typeof exp === "number" ? exp * 1000 - nowMs : null;
  return { header, payload: claims, times, expiresInMs };
}

export function makeUuids(count: number): string[] {
  return Array.from({ length: count }, () => globalThis.crypto.randomUUID());
}
