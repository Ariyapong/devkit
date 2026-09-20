# Changelog

## 0.1.0 — 2026-09-20

- Add `/json`, `/api`, `/time`, `/codec`, `/text`, `/debug` — six browser-safe
  domain subpaths of pure compute, extracted from the xiao-er Discord bot's
  toolbox.
- Add `./discord` — the Discord-only renderers gathered from every domain
  (fenced excerpts, `<t:…>` stamps, `-#` subtext), plus the new
  `renderErrorDetail(detail)`, which turns an `ErrorDetail` into the
  position line and fenced excerpt today's error messages carried inline.
- Add the root barrel, re-exporting every runtime export of the six domain
  subpaths (never `./discord`).
- **Shape change:** `locateJsonError(input, error)` now returns
  `{ message: string; detail?: ErrorDetail }` instead of a single fenced
  string; `message + renderErrorDetail(detail)` reproduces the old string
  byte-for-byte.
- **Shape change:** `formatYamlError(error)` now returns
  `{ message: string; detail?: ErrorDetail } | null` instead of a single
  fenced string, for the same reason.
- `convertTz(time, from, to, nowMs?)` gains a trailing optional `nowMs`
  parameter (default `Date.now()`) — the same value, now injectable.
- `decodeJwt(token, nowMs?)` gains a trailing optional `nowMs` parameter
  (default `Date.now()`), used to compute `expiresInMs`.
- Add `parseStackTrace(text): StackParse | null` to `/debug` — the pure half
  of stack-trace tidying (language, headline, frames, `topAppFrame`,
  `collapsedCount`), independent of the Discord-flavored body assembly that
  stays behind in `./discord`'s `tidyStackTrace`/`renderStackReply`.

### Divergences from the xiao-er source

- `InputError.detail` is a `declare`d field: absent (not `undefined`) when
  unset.
- `urlEncode` throws `InputError("Text contains an unpaired surrogate.")` on
  a lone surrogate instead of leaking a `URIError`.
- `parseUrl`: the host is lowercased before punycode decoding (matches
  `node:url.domainToUnicode`); an undecodable `xn--` label in a non-special
  scheme leaves `hostUnicode` absent instead of the bot's `""`; never throws.
- `jsonToTable` and `lintYaml` no longer append the Discord modal-cap
  truncation notice (a consumer that wants it appends it — the bot's
  `runJsonSub` will).
- `relativeTime` moved from the bot's `format.ts` to `/time`.
- `randomIndex`'s default RNG and `makeUuids` use Web Crypto
  (`globalThis.crypto`) instead of `node:crypto`; `randomIndex(0)` still
  throws a `RangeError` (programmer error).
- `DEFAULT_TZ` is declared and exported once, from `/time`.
- `curltools`' internal `minifyJson` is not exported (name collision with
  `/json`).
