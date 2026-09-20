import * as codec from "./index.js";
import { registerOutputScan } from "../scan/output-scan.js";
import { fixtures } from "./scan-fixtures.js";

registerOutputScan("codec", codec as Record<string, unknown>, fixtures);
