// Compiled in CI against the BUILT package via self-reference: proves the
// exports map's "types" condition, and that no build-time shim leaks.
import { formatJson, InputError, type ErrorDetail } from "@devwizards/devkit";
import { parseUrl } from "@devwizards/devkit/text";
import { renderErrorDetail } from "@devwizards/devkit/discord";
const d: ErrorDetail = { kind: "excerpt", lines: ["x"], caretLine: -1 };
export const out: string[] = [formatJson("{}"), String(parseUrl("https://a.b/")?.host), renderErrorDetail(d), new InputError("m", d).message];
