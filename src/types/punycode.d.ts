// Ambient types for the ESM file inside the untyped `punycode` package.
// Import ONLY "punycode/punycode.es6.js" — the bare "punycode" specifier
// resolves to Node's deprecated builtin (DEP0040) and bundlers resolve it
// differently. This shim is build-time only; nothing public references it.
declare module "punycode/punycode.es6.js" {
  export function toUnicode(input: string): string;
  export function toASCII(input: string): string;
}
