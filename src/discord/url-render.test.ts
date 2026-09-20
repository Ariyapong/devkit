import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUrl } from "../text/urltools.js";
import { renderUrl } from "./url-render.js";

const FULL = "https://api.example.com:8080/users?id=123&name=John%20Doe#section1";

test("renderUrl: full layout — lines, params fence, reconstructed fence", () => {
  const body = renderUrl(parseUrl(FULL)!, FULL);
  assert.match(body, /^Scheme: `https`\n/);
  assert.ok(body.includes("Host: `api.example.com`"));
  assert.ok(body.includes("Port: `8080`"));
  assert.ok(body.includes("Path: `/users`"));
  assert.ok(body.includes("Fragment: `section1`"));
  assert.ok(body.includes('Query parameters:\n```json\n'));
  assert.ok(body.includes('"name": "John Doe"'));
  assert.ok(body.includes("Reconstructed:\n```\n" + FULL + "\n```"));
});

test("renderUrl: absent parts leave no lines and no params fence", () => {
  const raw = "https://x.example/docs";
  const body = renderUrl(parseUrl(raw)!, raw);
  assert.ok(!body.includes("Port:"));
  assert.ok(!body.includes("Fragment:"));
  assert.ok(!body.includes("User:"));
  assert.ok(!body.includes("Query parameters:"));
  assert.ok(body.includes("Reconstructed:\n```\n"));
});

test("renderUrl: decoded arrow only when the form differs", () => {
  const thai = "https://x.example/%E0%B8%81";
  assert.ok(renderUrl(parseUrl(thai)!, thai).includes("Path: `/%E0%B8%81` → `/ก`"));
  const plain = "https://x.example/users";
  assert.ok(renderUrl(parseUrl(plain)!, plain).includes("Path: `/users`\n"));
  assert.ok(!renderUrl(parseUrl(plain)!, plain).includes("→"));
});

test("renderUrl: password never appears; user line marks it hidden", () => {
  const raw = "https://alice:secret@x.example/";
  const body = renderUrl(parseUrl(raw)!, raw);
  assert.ok(!body.includes("secret"));
  assert.ok(body.includes("User: `alice` (password hidden)"));
});

test("renderUrl: empty host renders no Host line (mailto:)", () => {
  const raw = "mailto:someone@example.com";
  const body = renderUrl(parseUrl(raw)!, raw);
  assert.ok(!body.includes("Host:"));
  assert.match(body, /^Scheme: `mailto`\n/);
});
