import * as json from "./index.js";
import { registerOutputScan } from "../scan/output-scan.js";
import { fixtures } from "./scan-fixtures.js";

registerOutputScan("json", json as Record<string, unknown>, fixtures);
