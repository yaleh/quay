// Reads provider.yml (proposal §10) — static self-declaration for the
// Backlog.md Provider. Mirrors quay-native's/quay-github's src/manifest.js
// shape (design §6 "native as conformance reference").

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, "..", "provider.yml");

export function readManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  return YAML.parse(raw);
}
