import * as text from "./index.js";
import { registerOutputScan } from "../scan/output-scan.js";
import { fixtures } from "./scan-fixtures.js";

registerOutputScan("text", text as Record<string, unknown>, fixtures);
