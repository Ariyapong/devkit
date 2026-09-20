import * as debug from "./index.js";
import { registerOutputScan } from "../scan/output-scan.js";
import { fixtures } from "./scan-fixtures.js";

registerOutputScan("debug", debug as Record<string, unknown>, fixtures);
