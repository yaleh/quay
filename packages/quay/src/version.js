// version.js — reads this package's own version from package.json at
// runtime (QX-035, ENV-001 mitigation: lets MCP consumers detect server
// staleness via _version). Split out of mcp-server.js (M01-dist, exp5
// iteration 0) so the SEA build can alias this single module to a
// build-time-embedded shim (scripts/version-sea-shim.js) instead of the
// whole mcp-server.js file — see that shim's header comment for why
// import.meta.url-based reads don't survive Node SEA's CJS bundling.
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version: QUAY_VERSION } = JSON.parse(
  readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
);

export { QUAY_VERSION };
