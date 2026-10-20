import * as http from "./index.js";
import { registerOutputScan } from "../scan/output-scan.js";
import { fixtures } from "./scan-fixtures.js";

registerOutputScan("http", http as Record<string, unknown>, fixtures);
