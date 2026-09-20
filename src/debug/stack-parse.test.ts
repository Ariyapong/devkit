import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStackTrace } from "./stack-parse.js";

const ESC = String.fromCharCode(0x1b);

const JS_TRACE = [
  "TypeError: Cannot read properties of undefined (reading 'name')",
  "    at getUser (/app/src/routes/user.ts:42:17)",
  "    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)",
  "    at next (/app/node_modules/express/lib/router/route.js:149:13)",
  "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
  "    at async run (/app/src/server.ts:12:3)",
].join("\n");

const CS_TRACE = [
  "System.InvalidOperationException: Sequence contains no elements",
  " ---> System.NullReferenceException: Object reference not set to an instance of an object.",
  "   at MyApp.Services.UserService.GetUser(Int32 id) in C:\\proj\\Services\\UserService.cs:line 42",
  "   at System.Linq.Enumerable.First[TSource](IEnumerable`1 source)",
  "   at Microsoft.AspNetCore.Mvc.Infrastructure.ActionMethodExecutor.Execute(Object controller)",
  "   at MyApp.Controllers.UserController.Get(Int32 id) in C:\\proj\\Controllers\\UserController.cs:line 18",
].join("\n");

const PY_TRACE = [
  "Traceback (most recent call last):",
  '  File "/app/main.py", line 10, in <module>',
  "    run()",
  '  File "/usr/lib/python3.11/site-packages/requests/api.py", line 59, in get',
  "    return request('get', url)",
  '  File "/app/client.py", line 4, in fetch',
  "    return data['user']",
  "KeyError: 'user'",
].join("\n");

test("parseStackTrace returns the parsed shape without any rendered body", () => {
  const p = parseStackTrace(JS_TRACE);
  assert.ok(p);
  assert.equal(p.language, "js");
  assert.ok(p.frames.length > 0);
  assert.equal(p.frameCount, p.frames.length);
  assert.equal(p.collapsedCount, p.frames.filter((f) => !f.app).length);
  assert.equal("body" in p, false);
});

test("js: detected, headline and top app frame extracted", () => {
  const parsed = parseStackTrace(JS_TRACE);
  assert.equal(parsed?.language, "js");
  assert.match(parsed?.headline ?? "", /TypeError/);
  assert.match(parsed?.topAppFrame ?? "", /user\.ts:42:17/);
});

test("python: sentinel required, exception line is the headline", () => {
  const parsed = parseStackTrace(PY_TRACE);
  assert.equal(parsed?.language, "python");
  assert.match(parsed?.headline ?? "", /KeyError/);
  assert.match(parsed?.topAppFrame ?? "", /client\.py:4/);
});

test("minimum two frames to claim", () => {
  const one = "Error: nope\n    at once (/app/x.ts:1:1)";
  assert.equal(parseStackTrace(one), null);
});

test("prose is not a trace", () => {
  assert.equal(parseStackTrace("we were at the meeting at 10:30:00 today"), null);
  assert.equal(parseStackTrace("just words"), null);
});

test("ANSI-colored trace still parses", () => {
  const colored = JS_TRACE.split("\n")
    .map((line) => `${ESC}[31m${line}${ESC}[0m`)
    .join("\n");
  assert.equal(parseStackTrace(colored)?.language, "js");
});

// Regression: reviewer finding 1 — two "at ..." prose lines ending in a
// clock-time tail shape-matched the old JS frame regex (bare :\d+:\d+) and
// fabricated a trace with no real headline or frame.
test("js: clock-time prose lines are not frames (reviewer finding 1)", () => {
  const prose = [
    "at the scene, officers arrived at roughly 10:30:00",
    "at the station, the report was filed around 11:45:12",
  ].join("\n");
  assert.equal(parseStackTrace(prose), null);
});

// Regression: reviewer finding 2 — an unrelated log line containing
// "...Exception:" mid-sentence, appearing above the real C# header, used to
// steal the headline because CS_HEADER_RE was unanchored.
test("csharp: a log line mentioning Exception: mid-sentence does not steal the headline (reviewer finding 2)", () => {
  const trace = [
    "Log note: an UnexpectedException: was logged upstream before this failure",
    "System.InvalidOperationException: Sequence contains no elements",
    "   at MyApp.Services.UserService.GetUser(Int32 id) in C:\\proj\\Services\\UserService.cs:line 42",
    "   at MyApp.Controllers.UserController.Get(Int32 id) in C:\\proj\\Controllers\\UserController.cs:line 18",
  ].join("\n");
  const parsed = parseStackTrace(trace);
  assert.equal(parsed?.language, "csharp");
  assert.match(parsed?.headline ?? "", /InvalidOperationException/);
  assert.ok(!(parsed?.headline ?? "").includes("UnexpectedException"));
  assert.ok(!(parsed?.headline ?? "").includes("Log note"));
});

// Regression: reviewer finding 3 — a chained Python traceback ("During
// handling of the above exception...") used to report the FIRST exception
// block, dropping the one that actually terminated the process.
test("python: chained traceback reports the LAST exception, not the first (reviewer finding 3)", () => {
  const trace = [
    "Traceback (most recent call last):",
    '  File "/app/client.py", line 10, in fetch',
    "    resp = requests.get(url)",
    '  File "/usr/lib/python3.11/site-packages/requests/api.py", line 59, in get',
    "    return request('get', url)",
    "ConnectionError: failed to connect",
    "",
    "During handling of the above exception, another exception occurred:",
    "",
    "Traceback (most recent call last):",
    '  File "/app/main.py", line 20, in <module>',
    "    run()",
    '  File "/app/client.py", line 15, in run',
    "    raise RuntimeError('fatal')",
    "RuntimeError: fatal",
  ].join("\n");
  const parsed = parseStackTrace(trace);
  assert.equal(parsed?.language, "python");
  assert.match(parsed?.headline ?? "", /RuntimeError/);
  assert.ok(!(parsed?.headline ?? "").includes("ConnectionError"));
  assert.match(parsed?.topAppFrame ?? "", /client\.py:15/);
});
