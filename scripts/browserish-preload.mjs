// Makes the runtime look browser-ish for the compiled test run: the two Node
// globals browser-safe code must never touch are removed before any test
// file loads. This run cannot go through tsx — its loader reads both.
delete globalThis.Buffer;
delete globalThis.process;
