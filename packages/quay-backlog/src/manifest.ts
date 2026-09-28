// Reads provider.yml (proposal §10) — static self-declaration for the
// Backlog.md Provider. Mirrors quay-native's / quay-github's src/manifest.ts
// shape (design §6 "native as conformance reference").
//
// ⛔ DELIBERATELY a per-package copy, NOT extract-me duplication. The body is
// byte-identical to quay-github's on purpose, which is why routine
// `semantic-dedup-scan` re-files this pair as `readManifest` every round.
// Two mechanical reasons the copy is the correct shape here:
//   ① Dependency boundary — this package declares NO `quay` dependency
//      (package.json); its only Core touchpoint is the erased `import type`
//      from abi.ts. A shared loader would have to be imported from Core,
//      handing two ABI-only providers a RUNTIME dependency they deliberately
//      do not have. quay-native, which does declare "quay", is the only
//      provider that may carry one.
//   ② Packaging seam — the `__dirname`-relative read is where each provider's
//      own packaging bites: quay-native needed a SEA shim
//      (scripts/manifest.sea-shim.js + esbuild --alias) for it because
//      `import.meta.url` is empty under SEA. Centralising this in Core would
//      place a packaging-sensitive seam where per-provider control is
//      impossible.
// The path derivation is per-module by construction — quay-native's
// parameterised form still carries its own DEFAULT_MANIFEST_PATH, proving a
// shared helper would not remove it. Keep this file byte-identical to
// quay-github's: the pair has never drifted, so parity is the invariant.
//
// Disposition, evidence and the gate gap that keeps re-filing it:
// docs/analysis/provider-manifest-reader-is-a-per-package-copy.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { Manifest } from "../../quay/src/abi.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, "..", "provider.yml");

export function readManifest(): Manifest {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  return YAML.parse(raw) as Manifest;
}
