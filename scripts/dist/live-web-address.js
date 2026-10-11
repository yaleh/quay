import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/live-web-address.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var CARRIER_RELATIVE_PATH = path.join(".quay", "server.json");
function deriveLiveWebAddress(root, expectedPid) {
  const carrierPath = path.join(root, CARRIER_RELATIVE_PATH);
  let raw;
  try {
    raw = fs.readFileSync(carrierPath, "utf8");
  } catch {
    return { state: "not-evaluated", subState: fs.existsSync(carrierPath) ? "carrier-unreadable" : "carrier-absent" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "not-evaluated", subState: "carrier-unreadable" };
  }
  if (parsed === null || typeof parsed !== "object") return { state: "not-evaluated", subState: "carrier-unreadable" };
  const carrier = parsed;
  if (carrier.schemaVersion !== 1 || !Array.isArray(carrier.services)) {
    return { state: "not-evaluated", subState: "carrier-unreadable" };
  }
  if (expectedPid !== void 0 && expectedPid !== null && String(carrier.pid) !== String(expectedPid)) {
    return { state: "not-evaluated", subState: "carrier-pid-mismatch" };
  }
  const web = carrier.services.find(
    (s) => s !== null && typeof s === "object" && s.name === "web"
  );
  if (!web) return { state: "not-evaluated", subState: "carrier-no-web-service" };
  if (web.up === false) return { state: "web-down", subState: "carrier-web-down" };
  if (web.up !== true) return { state: "not-evaluated", subState: "carrier-web-up-absent" };
  const host = web.host;
  const port = web.port;
  if (typeof host !== "string" || host === "" || typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { state: "not-evaluated", subState: "carrier-web-address-unusable" };
  }
  return { state: "address", address: `${host}:${port}` };
}
function runLiveWebAddressCli(argv) {
  const [root, expectedPid] = argv;
  if (!root) {
    process.stderr.write("usage: live-web-address.ts <workspace-root> [<expected-pid>]\n");
    return 2;
  }
  const result = deriveLiveWebAddress(root, expectedPid ?? null);
  if (result.state === "address") {
    process.stdout.write(result.address);
    return 0;
  }
  process.stderr.write(result.subState + "\n");
  return result.state === "web-down" ? 1 : 3;
}
function isMain() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(argv1) === self;
  } catch {
    return path.resolve(argv1) === self;
  }
}
if (isMain()) {
  process.exit(runLiveWebAddressCli(process.argv.slice(2)));
}
export {
  CARRIER_RELATIVE_PATH,
  deriveLiveWebAddress,
  runLiveWebAddressCli
};
