// Reads provider.yml — the native Provider's static self-declaration
// (quay-proposal.md §10, quay-native-design.md). Static vs runtime split:
// this file is read for UI chrome / capability negotiation; MCP tools are
// the runtime data surface (proposal §7).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST_PATH = path.join(__dirname, "..", "provider.yml");

export function readManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  return YAML.parse(raw);
}
