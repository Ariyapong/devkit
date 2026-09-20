import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyStackTrace, renderStackReply } from "./stack-render.js";
import { parseStackTrace } from "../debug/stack-parse.js";

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

test("tidyStackTrace = parseStackTrace + body assembly, counts agree", () => {
  const tidy = tidyStackTrace(JS_TRACE)!;
  const parsed = parseStackTrace(JS_TRACE)!;
  assert.equal(tidy.collapsedCount, parsed.collapsedCount);
  assert.equal(tidy.topAppFrame, parsed.topAppFrame);
  assert.match(tidy.body, /^\*\*.+\*\*\n/);
  assert.match(tidy.body, /```\n[\s\S]*\n```$/);
});

// Pins the Python head/report discrepancy (controller ruling 1): the body's
// "Top app frame:" line is built BEFORE the last-app override, so it shows
// the FIRST app frame's location, while the reported topAppFrame field is
// overridden afterward to the LAST app frame's location. PY_TRACE has two
// app frames — main.py:10 (first) and client.py:4 (last) — straddling one
// framework frame, so the two must differ here.
test("python: body's Top app frame line shows the FIRST app frame while topAppFrame reports the LAST", () => {
  const tidy = tidyStackTrace(PY_TRACE)!;
  assert.ok(tidy !== null);
  assert.match(tidy.topAppFrame ?? "", /client\.py:4/);
  assert.match(tidy.body, /Top app frame: `[^`]*main\.py:10[^`]*`/);
  assert.ok(!tidy.body.includes("client.py:4"));
});

test("js: framework frames collapsed, app frames kept", () => {
  const tidy = tidyStackTrace(JS_TRACE);
  assert.ok(tidy !== null);
  assert.match(tidy.body, /framework frames/);
  assert.match(tidy.body, /server\.ts:12:3/);
  assert.ok(!tidy.body.includes("express/lib/router"));
  assert.equal(tidy.frameCount, 5);
  assert.equal(tidy.collapsedCount, 3);
});

test("csharp: detected with inner exception chain in headline block", () => {
  const tidy = tidyStackTrace(CS_TRACE);
  assert.equal(tidy?.language, "csharp");
  assert.match(tidy?.headline ?? "", /InvalidOperationException/);
  assert.match(tidy?.body ?? "", /NullReferenceException/);
  assert.match(tidy?.topAppFrame ?? "", /UserService\.cs:line 42/);
});

test("csharp: System and Microsoft frames collapse", () => {
  const tidy = tidyStackTrace(CS_TRACE);
  assert.ok(tidy !== null);
  assert.ok(!tidy.body.includes("System.Linq.Enumerable"));
  assert.match(tidy.body, /UserController\.cs:line 18/);
});

test("repeating trace bounded by app-frame cap", () => {
  const frames = Array.from({ length: 200 }, () => "    at loop (/app/r.ts:5:9)");
  const tidy = tidyStackTrace(["RangeError: Maximum call stack size exceeded", ...frames].join("\n"));
  assert.ok(tidy !== null);
  assert.match(tidy.body, /more app frames/);
  assert.ok(tidy.body.length < 2500);
});

test("renderStackReply: notes ride from the error-code scanner", () => {
  const trace = [
    "Error: connect ECONNREFUSED 127.0.0.1:5432",
    "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1595:16)",
    "    at connect (/app/src/db.ts:9:3)",
  ].join("\n");
  const reply = renderStackReply(trace);
  assert.ok(reply !== null);
  assert.match(reply.notes[0] ?? "", /ECONNREFUSED/);
});

test("renderStackReply: null on non-trace input", () => {
  assert.equal(renderStackReply("hello"), null);
});

// Regression: final whole-branch review, finding 1 (repro 1) — two distinct
// JS traces separated by prose used to be swept together: frame collection
// scanned every line in the text instead of stopping at the first trace's
// region, so trace-2's frames rendered under trace-1's headline.
test("js: only the FIRST trace's frames are collected, a second trace later in the text contributes nothing", () => {
  const trace = [
    "TypeError: first error",
    "    at foo (/app/a.ts:1:1)",
    "    at bar (/app/a.ts:2:2)",
    "",
    "some unrelated log lines here",
    "",
    "TypeError: second error",
    "    at baz (/app/b.ts:3:3)",
    "    at qux (/app/b.ts:4:4)",
  ].join("\n");
  const tidy = tidyStackTrace(trace);
  assert.equal(tidy?.language, "js");
  assert.match(tidy?.headline ?? "", /first error/);
  assert.equal(tidy?.frameCount, 2);
  assert.ok(!(tidy?.body ?? "").includes("b.ts"));
  assert.ok(!(tidy?.body ?? "").includes("second error"));
});

// Regression: final whole-branch review, finding 2 (repro 2) — every
// "---> SomeException: msg" line ANYWHERE in the text used to be appended to
// the first headline's ↳ chain (frame collection and the C# headline loop
// both swept the whole input), so 500 scattered inner-exception lines far
// below the real trace produced a headline block tens of thousands of chars
// long. The scattered lines sit outside the first trace's contiguous region
// (separated by an unrelated log line), so none of them should surface.
test("csharp: inner-exception lines scattered elsewhere in the text do not join the first trace's headline (repro 2)", () => {
  const scattered = Array.from(
    { length: 500 },
    (_, i) => ` ---> System.Exception: scattered inner ${i}`,
  ).join("\n");
  const trace = [
    "System.InvalidOperationException: Sequence contains no elements",
    "   at MyApp.Services.UserService.GetUser(Int32 id) in C:\\proj\\Services\\UserService.cs:line 42",
    "   at MyApp.Controllers.UserController.Get(Int32 id) in C:\\proj\\Controllers\\UserController.cs:line 18",
    "",
    "unrelated log separator, not part of the trace",
    "",
    scattered,
  ].join("\n");
  const tidy = tidyStackTrace(trace);
  assert.equal(tidy?.language, "csharp");
  assert.match(tidy?.headline ?? "", /InvalidOperationException/);
  assert.equal(tidy?.frameCount, 2);
  assert.ok(!(tidy?.body ?? "").includes("scattered inner"));
  assert.ok((tidy?.body ?? "").length < 2000);
});

// Regression: required fix behavior — even inner-exception lines that ARE
// inside the first trace's own contiguous header region must be bounded, so
// a legitimately deep (or adversarially long) chain right above the frames
// can't produce an unbounded headline block either.
test("csharp: inner-exception chain within the first trace's own region is capped (↳ cap)", () => {
  const innerLines = Array.from(
    { length: 10 },
    (_, i) => ` ---> System.Exception: inner ${i}`,
  );
  const trace = [
    "System.InvalidOperationException: Sequence contains no elements",
    ...innerLines,
    "   at MyApp.Services.UserService.GetUser(Int32 id) in C:\\proj\\Services\\UserService.cs:line 42",
    "   at MyApp.Controllers.UserController.Get(Int32 id) in C:\\proj\\Controllers\\UserController.cs:line 18",
  ].join("\n");
  const tidy = tidyStackTrace(trace);
  assert.equal(tidy?.language, "csharp");
  assert.match(tidy?.headline ?? "", /InvalidOperationException/);
  const innerMatches = (tidy?.body ?? "").match(/↳ System\.Exception: inner \d+/g) ?? [];
  assert.equal(innerMatches.length, 5);
  assert.match(tidy?.body ?? "", /↳ … 5 more inner exceptions/);
});

// Regression: scoped re-review, Critical — the standard .NET
// "--- End of inner exception stack trace ---" separator (between a wrapped
// inner exception's frames and the outer frames) was neither a frame, blank,
// nor a csHeaderCandidate match, so it ended the region early. On this exact
// shape (1 inner frame, separator, 2 outer frames) that left frames.length
// at 1 and tidyStackTrace returned null entirely, dropping the whole trace.
test("csharp: '--- End of inner exception stack trace ---' keeps the region open into the outer frames (probe A)", () => {
  const trace = [
    "System.InvalidOperationException: outer message",
    " ---> System.NullReferenceException: inner message",
    "   at MyApp.Inner.DoWork() in C:\\proj\\Inner.cs:line 10",
    "   --- End of inner exception stack trace ---",
    "   at MyApp.Outer.Handle() in C:\\proj\\Outer.cs:line 30",
    "   at MyApp.Program.Main() in C:\\proj\\Program.cs:line 5",
  ].join("\n");
  const tidy = tidyStackTrace(trace);
  assert.equal(tidy?.language, "csharp");
  assert.equal(tidy?.frameCount, 3);
  assert.match(tidy?.topAppFrame ?? "", /Inner\.cs:line 10/);
  assert.match(tidy?.body ?? "", /Outer\.cs:line 30/);
  assert.match(tidy?.body ?? "", /Program\.cs:line 5/);
});

// Regression: scoped re-review, Critical — same shape with ASP.NET's async
// rethrow separator, "--- End of stack trace from previous location ---".
// Before the fix, 2 inner frames ahead of this separator silently truncated
// the tidy: the outer call-site frames (usually the most relevant ones) were
// dropped with no indication anything was cut.
test("csharp: '--- End of stack trace from previous location ---' keeps the region open into the outer frames (probe B)", () => {
  const trace = [
    "System.InvalidOperationException: outer message",
    " ---> System.NullReferenceException: inner message",
    "   at MyApp.Inner.DoWork() in C:\\proj\\Inner.cs:line 10",
    "   --- End of stack trace from previous location ---",
    "   at MyApp.Outer.Handle() in C:\\proj\\Outer.cs:line 30",
    "   at MyApp.Program.Main() in C:\\proj\\Program.cs:line 5",
  ].join("\n");
  const tidy = tidyStackTrace(trace);
  assert.equal(tidy?.language, "csharp");
  assert.equal(tidy?.frameCount, 3);
  assert.match(tidy?.topAppFrame ?? "", /Inner\.cs:line 10/);
  assert.match(tidy?.body ?? "", /Outer\.cs:line 30/);
  assert.match(tidy?.body ?? "", /Program\.cs:line 5/);
});
