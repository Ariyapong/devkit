import { stripAnsi } from "./ansitools.js";

export type StackLanguage = "js" | "csharp" | "python";

export interface StackParse {
  language: StackLanguage;
  headline: string;
  headlines: string[];
  topAppFrame: string | null;
  /**
   * The first-app-frame location, computed BEFORE the Python
   * last-app-frame override below. `./discord`'s Discord body was built
   * from this value even after the override changed the reported
   * `topAppFrame` to the last app frame — this field lets the Discord
   * layer reproduce that exactly. Equal to `topAppFrame` for js/csharp,
   * where no override ever runs.
   */
  headTopAppFrame: string | null;
  frames: Frame[];
  frameCount: number;
  collapsedCount: number;
}

export interface Frame {
  raw: string;
  app: boolean;
  location: string | null;
}

// Bounds the C# ↳ inner-exception chain in the headline block — without this
// a text carrying many "---> ...Exception:" lines inside the first trace's
// own contiguous region (not just scattered elsewhere, which the region
// restriction below already excludes) could still produce an unbounded
// headline.
const MAX_INNER_LINES = 5;
const PY_SENTINEL = "Traceback (most recent call last):";

// A JS frame carries :line:col; a C# frame is `at Method(args)` with an
// optional ` in file:line N` and never :line:col.
const JS_FRAME_RE = /^\s*at\s+.*:\d+:\d+\)?\s*$/;
const JS_FRAMEWORK_RE = /node_modules|node:|\binternal\//;
const JS_LOCATION_RE = /\(?([^\s()]+:\d+:\d+)\)?\s*$/;
// A bare "at ...HH:MM:SS" clock-time tail shape-matches JS_FRAME_RE (prose
// like "at the scene, officers arrived at roughly 10:30:00"). Real V8
// locations are always path-like: a "/" or "\" path separator, a "node:"
// builtin prefix, or a "name.ext" file token — a clock time has none of
// those, so the prefix left after stripping the trailing :line:col is
// checked against this before a JS_FRAME_RE match is trusted.
const JS_LOCATION_TAIL_RE = /:\d+:\d+$/;
const JS_PATHLIKE_RE = /^node:|[/\\]|\.[A-Za-z0-9]+$/;
const CS_FRAME_RE = /^\s*at\s+[\w.<>`+[\]]+\(.*\)(?:\s+in\s+.+:line\s+\d+)?\s*$/;
const CS_FRAMEWORK_RE = /^\s*at\s+(?:System\.|Microsoft\.)/;
const CS_LOCATION_RE = /\sin\s+(.+:line\s+\d+)\s*$/;
// Anchored to the start of the (already-trimmed, inner-prefix-stripped) line
// — a real header line's exception type opens the line, optionally after
// "Unhandled exception. ". An unanchored match let a log line mentioning
// "...Exception:" mid-sentence steal the headline from the real header below
// it; anchoring closes that.
const CS_HEADER_RE = /^(?:Unhandled exception\.\s*)?[\w.]+Exception\b\s*:/;
const CS_INNER_PREFIX_RE = /^-{3,}>\s*/;
// The two standard .NET stack-trace separator lines: "--- End of inner
// exception stack trace ---" (between a wrapped inner exception's frames and
// the outer frames) and "--- End of stack trace from previous location ---"
// (ASP.NET's async rethrow marker). Neither is a frame, but both sit inside
// a single trace's own contiguous region — matching them keeps that region
// open instead of ending it. Anchored to the whole (trimmed) line so it
// can't fire on prose that merely mentions a stack trace.
const CS_SEPARATOR_RE =
  /^-{3,}\s*End of (?:inner exception stack trace|stack trace from previous location)\s*-{3,}$/;
const PY_FRAME_RE = /^\s*File\s+"(.+)",\s+line\s+(\d+)/;
const PY_FRAMEWORK_RE = /site-packages|dist-packages/;

function isJsFrameLine(line: string): boolean {
  if (!JS_FRAME_RE.test(line)) return false;
  const location = JS_LOCATION_RE.exec(line)?.[1];
  if (location === undefined) return false;
  const prefix = location.replace(JS_LOCATION_TAIL_RE, "");
  return prefix !== "" && JS_PATHLIKE_RE.test(prefix);
}

function classifyLine(line: string): "js" | "csharp" | null {
  if (isJsFrameLine(line)) return "js";
  if (CS_FRAME_RE.test(line)) return "csharp";
  return null;
}

interface CsHeaderCandidate {
  isInner: boolean;
  text: string;
}

// A C# header line ("SomeException: msg", optionally "Unhandled exception. "
// prefixed) or a "---> SomeException: msg" inner-exception line, tested
// against an already-trimmed input. Shared by the backward walk (the header
// block sitting above the first trace's first frame) and the forward region
// walk (an inline inner line found between frames, e.g. after a "--- End of
// inner exception..." separator) — both must stay confined to the first
// trace, never sweep the whole text.
function csHeaderCandidate(trimmed: string): CsHeaderCandidate | null {
  const isInner = CS_INNER_PREFIX_RE.test(trimmed);
  const candidate = isInner ? trimmed.replace(CS_INNER_PREFIX_RE, "") : trimmed;
  if (!CS_HEADER_RE.test(candidate)) return null;
  return { isInner, text: candidate };
}

function buildParse(language: StackLanguage, headlines: string[], frames: Frame[]): StackParse {
  const headline = headlines[0] ?? "(no exception line found)";
  const firstApp = frames.find((frame) => frame.app);
  const topAppFrame = firstApp?.location ?? null;
  return {
    language,
    headline,
    headlines,
    topAppFrame,
    headTopAppFrame: topAppFrame,
    frames,
    frameCount: frames.length,
    // Every non-app frame is collapsed by the renderer (flush() accounts for
    // all of them), so the count is knowable before any rendering.
    collapsedCount: frames.filter((frame) => !frame.app).length,
  };
}

function parsePython(lines: string[]): StackParse | null {
  // Chained tracebacks ("During handling of the above exception...") repeat
  // the sentinel once per block; the LAST block is the one that actually
  // terminated the program, so search from the end rather than taking the
  // first (and, pre-fix, only-ever-parsed) occurrence.
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if ((lines[i] ?? "").includes(PY_SENTINEL)) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const frames: Frame[] = [];
  let exceptionLine: string | null = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const m = PY_FRAME_RE.exec(line);
    if (m !== null) {
      const path = m[1] ?? "";
      const lineNo = m[2] ?? "";
      frames.push({
        raw: line,
        app: !PY_FRAMEWORK_RE.test(path),
        location: `${path}:${lineNo}`,
      });
      continue;
    }
    if (/^\S/.test(line) && line.trim() !== "") {
      exceptionLine = line.trim();
      break;
    }
  }
  if (frames.length < 2) return null;
  // Python prints innermost last — the last app frame is the interesting one.
  const lastApp = [...frames].reverse().find((frame) => frame.app);
  const parsed = buildParse("python", [exceptionLine ?? "(no exception line found)"], frames);
  return { ...parsed, topAppFrame: lastApp?.location ?? parsed.topAppFrame };
}

export function parseStackTrace(text: string): StackParse | null {
  const clean = stripAnsi(text);
  const lines = clean.split("\n");

  const python = parsePython(lines);
  if (python !== null) return python;

  let jsCount = 0;
  let csCount = 0;
  for (const line of lines) {
    const kind = classifyLine(line);
    if (kind === "js") jsCount += 1;
    else if (kind === "csharp") csCount += 1;
  }
  const language: StackLanguage | null =
    jsCount >= 2 && jsCount >= csCount ? "js" : csCount >= 2 ? "csharp" : null;
  if (language === null) return null;

  // Frame collection is bounded to the FIRST contiguous trace region: once
  // frames have begun, a line keeps the region alive only by being another
  // frame of `language`, blank, or (C# only) an inline inner-exception/header
  // line; the first line that fails all three ends the region for good — a
  // second trace later in the text contributes nothing.
  const frames: Frame[] = [];
  const headlines: string[] = [];
  const inlineCsHeaders: CsHeaderCandidate[] = [];
  let firstFrameIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const kind = classifyLine(line);
    if (kind === language) {
      if (firstFrameIndex === -1) firstFrameIndex = i;
      if (language === "js") {
        const m = JS_LOCATION_RE.exec(line);
        frames.push({
          raw: line,
          app: !JS_FRAMEWORK_RE.test(line),
          location: m?.[1] ?? null,
        });
      } else {
        const m = CS_LOCATION_RE.exec(line);
        frames.push({
          raw: line,
          app: !CS_FRAMEWORK_RE.test(line),
          location: m?.[1] ?? null,
        });
      }
      continue;
    }
    if (firstFrameIndex === -1) continue; // first trace hasn't started yet
    if (line.trim() === "") continue; // blank lines don't end the region
    if (language === "csharp") {
      const header = csHeaderCandidate(line.trim());
      if (header !== null) {
        inlineCsHeaders.push(header);
        continue;
      }
      // A .NET rethrow/inner-exception separator keeps the CURRENT region
      // open (the outer frames after it belong to this same trace) — it is
      // not itself a frame, so it isn't pushed anywhere.
      if (CS_SEPARATOR_RE.test(line.trim())) continue;
    }
    break; // first line outside the first trace's region — stop collecting
  }
  if (frames.length < 2) return null;

  // Headline: for C#, the exception header plus each `--->` inner line,
  // sourced only from the first trace's own header/frame region — the lines
  // walked backward from its first frame, plus any inline ones caught above
  // while the region was still open — and capped at MAX_INNER_LINES so an
  // adversarial run of inner-exception lines can't produce an unbounded
  // headline block. For JS, the last non-empty non-frame line above the
  // first frame.
  if (language === "csharp") {
    const backwardHeaders: CsHeaderCandidate[] = [];
    for (let i = firstFrameIndex - 1; i >= 0; i -= 1) {
      const line = lines[i] ?? "";
      if (line.trim() === "") continue;
      const header = csHeaderCandidate(line.trim());
      if (header === null) break;
      backwardHeaders.push(header);
    }
    backwardHeaders.reverse();
    let innerCount = 0;
    let innerOverflow = 0;
    for (const candidate of [...backwardHeaders, ...inlineCsHeaders]) {
      if (candidate.isInner) {
        if (innerCount < MAX_INNER_LINES) {
          headlines.push(candidate.text);
          innerCount += 1;
        } else {
          innerOverflow += 1;
        }
      } else if (headlines.length === 0) {
        headlines.push(candidate.text);
      }
    }
    if (innerOverflow > 0) {
      headlines.push(`… ${innerOverflow} more inner exception${innerOverflow === 1 ? "" : "s"}`);
    }
  } else {
    for (let i = firstFrameIndex - 1; i >= 0; i -= 1) {
      const candidate = (lines[i] ?? "").trim();
      if (candidate !== "") {
        headlines.push(candidate);
        break;
      }
    }
  }
  return buildParse(language, headlines, frames);
}
