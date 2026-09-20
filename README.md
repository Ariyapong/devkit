# @devwizards/devkit

Pure TypeScript developer tools. Browser-safe subpaths `/json /api /time /codec /text /debug`; Discord renderers under `/discord`. Node >= 22. MIT.

## Install

```
npm i @devwizards/devkit
```

Requires Node >= 22 (`engines.node` in `package.json`; not enforced at install time by npm itself, only by CI and by any tool that checks it).

## Subpaths

| Subpath | Purpose |
|---|---|
| `@devwizards/devkit` (root) | Everything below, re-exported under one barrel — except `./discord` |
| `@devwizards/devkit/json` | JSON/YAML/DSV parsing, linting, table/CSV conversion, and located parse errors |
| `@devwizards/devkit/api` | HTTP contract diffing, JSON Schema inference, and curl ↔ fetch conversion |
| `@devwizards/devkit/time` | Epoch/ISO/cron parsing, timezone conversion, and time-string detection |
| `@devwizards/devkit/codec` | Base64, URL encoding, JWT decoding, and UUID/random-index generation |
| `@devwizards/devkit/text` | Semver, unit conversion, URL parsing, case conversion, counting, Unicode inspection, base conversion, diffing |
| `@devwizards/devkit/debug` | Stack trace parsing, error-code lookup, ANSI stripping, HTTP status lookup |
| `@devwizards/devkit/discord` | **Discord-only rendering, never for the web** — turns the compute above into fenced excerpts, `<t:…>` stamps and `-#` subtext |

The root barrel re-exports every runtime export of the six domain subpaths
(`/json /api /time /codec /text /debug`) plus `InputError`/`sanitizeError`.
It never re-exports anything from `./discord` — a function whose output
contains Discord layout syntax is reachable only through
`@devwizards/devkit/discord`.

## Errors

Every domain throws the same error class for bad input:

```ts
import { InputError, sanitizeError, type ErrorDetail } from "@devwizards/devkit";
```

- `InputError extends Error` — the **only** type thrown for bad input,
  anywhere in the package.
- `message` is **text, not markup**. Render it as-is; it may embed the
  user's payload verbatim, newlines included (some parsers echo the
  offending input back when they have no position to report), but it never
  contains Discord fences or subtext.
- `detail?: ErrorDetail` carries a structured position and excerpt when the
  producer has one (`{ kind: "excerpt", position?, positionLine?, lines,
  caretLine }`). It is absent — not `undefined` — when there is nothing to
  show. Pass it to `renderErrorDetail` from `@devwizards/devkit/discord` to
  reproduce the fenced, Discord-shaped string; don't build a fence around
  `message` yourself.
- `sanitizeError(error)` is for **logs**, `message` is for the **reply**.
  It collapses an `InputError` to the literal string `"InputError"` (so a
  payload never reaches a log line) and truncates any other error to its
  first line, capped at 120 characters.

## Invariants

Rules load-bearing enough that a "simplification" would silently reintroduce
a bug already found and fixed once:

- `jsonStringify` never parses — it escapes ANY text. Don't route it through
  a JSON parser to "validate" first.
- `schemaOf` accumulates properties into `Object.create(null)` and spreads
  the result back to a plain object — a payload key that shadows
  `Object.prototype` (`__proto__`, `toString`, `constructor`) would
  otherwise vanish or corrupt the schema on a `{}`-literal accumulator.
- `parseCurl`/`toFetch`'s body choice (`chooseBody`) emits an object literal
  only when **four AND-ed gates** all hold — object-or-array shape, depth
  ≤ 100, `JSON.stringify(parsed) === minifyJson(raw)`, and no `__proto__`
  key — each checked in that order (the depth gate first, because the other
  two recurse unbounded) and each failing safe toward the verbatim string
  literal.
- A curl `-d` body carries an implicit
  `Content-Type: application/x-www-form-urlencoded` — `toFetch` adds it,
  because a bare `fetch` would send `text/plain` and silently change the
  request the snippet reproduces.
- `parseRequestForm`/`toCurl` quote a `$VAR`/`${VAR}` placeholder only on an
  **exact-match** value — a "contains `$`" rule would mis-quote a literal
  password like `p$ss`.
- Never widen a Discord code fence past three backticks — Discord treats a
  fourth backtick as content, not a wider delimiter.
- `base64Decode` is a hand-written decoder that mirrors
  `Buffer.from(x, "base64")` byte-for-byte (fuzzed against it on 100,000
  random inputs across two Node versions with zero mismatches) and never
  throws a `DOMException` the way an `atob`-based decoder would on input
  `Buffer` accepts.
- Grapheme/word counting (`countText`, `cellDisplay`, …) uses
  `Intl.Segmenter` with **no fixed locale** — always `undefined`. This is
  full-ICU dependent: Thai word counts may differ by a word between JS
  engines with different ICU data.
- `explainCron`'s `nextRuns` reads the wall clock **inside** `cron-parser`,
  by design — "when does this next run" is a from-now question, not a
  deterministic one, so there is no `currentDate`/`nowMs` parameter for it.
- `urlEncode` throws `InputError` on a lone surrogate — never a raw
  `URIError` escaping from `encodeURIComponent`.
- `parseUrl` never throws. An undecodable `xn--` punycode label in a
  non-special scheme simply leaves `hostUnicode` absent on the result.
- `InputError.detail` is **absent**, not `undefined`, when the producer set
  none (`exactOptionalPropertyTypes`-safe) — a `"detail" in error` check
  behaves correctly either way, but `JSON.stringify`/`deepEqual` against a
  literal without the key will not.

## Browser safety

The six domain subpaths and `./discord` are safe to bundle for a browser.
This is enforced, not just documented:

- No subpath imports `node:*`, calls `require(`, or touches the identifiers
  `Buffer`, `process`, `__dirname` — an AST-level scan over every source
  file fails the build on any of these (matched as identifiers, so a
  `node:` substring inside a regex literal doesn't trip it).
- `npm run test:browserish` compiles the whole suite and re-runs it under a
  preload that **deletes `Buffer` and `process` from `globalThis`** before
  any package code loads — proving the guarantee at runtime, not only in
  the import graph.
- No hidden clocks: a zero-argument `Date.now()`/`new Date()` may appear
  only as a parameter default or on the right of `??` in an options
  fallback (`opts.nowMs ?? Date.now()`). Every function that needs "now"
  takes it as a parameter.
- No environment reads and no logging inside any domain subpath — `nowMs`,
  `tz` and `rng` are always parameters with defaults, never read from
  `process.env` or a module-level global.
- Discord layout syntax (a code fence, `-# ` subtext, a `<t:…>` timestamp)
  never appears in a domain subpath's *output* — enforced per export
  against a fixture table (`scan-fixtures.ts`) in each domain, over both its
  `returns` and `throws` cases. Only `./discord` may emit it.

## Versioning

- `0.1.0` is cycle one exactly as shipped: the six domain subpaths plus
  `./discord`. Minor bumps add domains, exports, or trailing optional
  parameters; patch bumps fix behavior only.
- **Pre-1.0 shape changes** (an existing export's return type changes) ship
  as one PR containing the compute change, the matching `./discord`
  renderer update, the moved string test, and a CHANGELOG entry naming the
  old and new shape — always a minor bump, never silent.
- `1.0.0` lands once a real consumer has run these tools for a full release
  cycle with no parity fix required. Not a fixed date.
- `npm pack --dry-run` is pinned in CI so a stray test file, fixture,
  `scan-fixtures.ts`, `.map` file, or `dist-test/` output never ships.
