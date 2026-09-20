#!/usr/bin/env node
// chart2-s2-delivery-completeness.ts — machine-verifiable cov calculator for chart-2 surface S2
// (Delivery completeness), per DIR-064 / DIR-064-A §6.2. S2 replaces prose ("~0.1: Core-only;
// 5-way version drift; no install mechanism") with an OBJECTIVE, capped cov computed from three
// sub-checks:
//
//   (1) version-consistency — LOCALLY COMPUTABLE NOW. The 3 published version-bearing surfaces
//       must all be equal. Sourced live from:
//         packages/quay/package.json                → .version
//         plugin/.claude-plugin/plugin.json         → .version
//         plugin/vendor/quay/package.json           → .version
//       A missing file/field reads as null → treated as NOT consistent.
//
//       ⛔ The two `marketplace.json` files are deliberately NOT sources (2026-09-20,
//       gap-version-marketplace-omit-and-spec-amendment). Their `plugins[].version` was MEASURED
//       never to be read: an isolated-CLAUDE_CONFIG_DIR real install returns the version of the
//       plugin manifest it actually fetched, keyed by THAT file's version, whatever the marketplace
//       entry says. Decisive control (hard rule 4 corollary four): an entry pinned to `9.9.9`
//       against a manifest of `0.10.0-dev` still installs into `…/cache/quay/quay/0.10.0-dev` — the
//       reading differs if the "CLI reads this field" hypothesis is true, and it does not differ.
//       The field was therefore DELETED from both files rather than left as an unread
//       hand-maintained literal. The guard that it never returns lives in
//       `plugin/test/plugin-packaging.test.mjs` (one source of truth); this script does not carry a
//       second, weaker copy of that assertion. See §12 of
//       orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md.
//
//   (2) full-manifest-published — from the checked-in evidence file chart2-s2-delivery.json
//       (fullManifestPublished). A delivery manifest does not exist yet → false.
//
//   (3) foreign-install-e2e-green — from the same evidence file (foreignInstallE2eGreen). No
//       foreign-workspace install e2e exists yet → false.
//
//   cov = (# sub-checks satisfied) / 3.
//
// On the CURRENT real repo this computes cov = 3/3 = 1.0: all 3 version-bearing surfaces read
// `0.10.0-dev` and both evidence flags are true (chart2-s2-delivery.json, DELIVERY-C/D). cov falls
// to 2/3 when the version surfaces drift, and to 0/3 when the evidence flags are false as well.
//
// This is a LOAD-BEARING script: its cov output feeds chart-2's S2 cell in the inherited-core VT
// model (DIR-064-B). Hard check over stored/live facts — NOT a paraphrase of prose (ADR-004).
//
// Usage:
//   node chart2-s2-delivery-completeness.ts [<repoRoot>]   (default: repo root inferred from script location)
//   node chart2-s2-delivery-completeness.ts --selftest
//
// Exit codes:
//   0 = computed successfully (any cov) / selftest PASS
//   1 = selftest FAIL
//   2 = usage/environment error

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ → experiments/quay-perpetual-stream/ → experiments/ → repo root
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
// Evidence file lives beside the experiment dir (one level up from scripts/).
const DEFAULT_EVIDENCE_PATH = path.resolve(__dirname, "..", "chart2-s2-delivery.json");

export interface VersionField {
  source: string;
  version: string | null;
}

export interface S2Evidence {
  fullManifestPublished: boolean;
  foreignInstallE2eGreen: boolean;
}

export interface S2Cov {
  cov: number;
  satisfied: number;
  total: number;
}

// The 3 version-bearing surfaces. All three carry a flat top-level `.version` — the
// `plugins[0].version` pointer went away with the two `marketplace.json` sources (see the header),
// so no dead variant of it is kept here.
const VERSION_SOURCES: string[] = [
  "packages/quay/package.json",
  "plugin/.claude-plugin/plugin.json",
  "plugin/vendor/quay/package.json",
];

// ── readVersionField — read one version field from one JSON file. ────────────────────────────────
// A missing file, unparseable JSON, or a missing/non-string field all yield version:null.
function readVersionField(repoRoot: string, relPath: string): VersionField {
  const abs = path.join(repoRoot, relPath);
  let version: string | null = null;
  try {
    const raw = fs.readFileSync(abs, "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    version = typeof obj.version === "string" ? obj.version : null;
  } catch {
    version = null;
  }
  return { source: relPath, version };
}

// ── readVersionFields — read all 3 version fields, in declared order. ────────────────────────────
export function readVersionFields(repoRoot: string): VersionField[] {
  return VERSION_SOURCES.map((relPath) => readVersionField(repoRoot, relPath));
}

// ── versionsConsistent — true iff every field is non-null AND all versions are equal. ────────────
// A single null (missing file/field) or any divergence → false.
export function versionsConsistent(fields: VersionField[]): boolean {
  if (fields.length === 0) return false;
  if (fields.some((f) => f.version === null)) return false;
  const first = fields[0].version;
  return fields.every((f) => f.version === first);
}

// ── computeS2Cov — cov = satisfied / 3 over the three objective sub-checks. ──────────────────────
export function computeS2Cov(
  versionConsistent: boolean,
  fullManifestPublished: boolean,
  foreignInstallGreen: boolean
): S2Cov {
  const total = 3;
  const satisfied =
    (versionConsistent ? 1 : 0) +
    (fullManifestPublished ? 1 : 0) +
    (foreignInstallGreen ? 1 : 0);
  return { cov: satisfied / total, satisfied, total };
}

// ── loadS2Evidence — read the checked-in evidence file for sub-checks (2) and (3). ───────────────
// A missing file or absent flag reads as false (fail-closed): delivery is not "published"
// unless a checked-in fact asserts it.
export function loadS2Evidence(jsonPath: string): S2Evidence {
  let fullManifestPublished = false;
  let foreignInstallE2eGreen = false;
  try {
    const raw = fs.readFileSync(jsonPath, "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    fullManifestPublished = obj.fullManifestPublished === true;
    foreignInstallE2eGreen = obj.foreignInstallE2eGreen === true;
  } catch {
    // fail-closed: both stay false
  }
  return { fullManifestPublished, foreignInstallE2eGreen };
}

// ── selftest — RED+GREEN fixture cases exercised against temp repo trees. ────────────────────────
// RED case 1: 3-way version drift + no evidence → cov 0/3.
// RED case 2: versions aligned but evidence flags false → cov 1/3.
// RED case 3: a missing version file (null) → not consistent → cov contribution 0.
// GREEN case: all 3 versions aligned + both evidence flags true → cov 3/3 = 1.0.
export function selftest(): boolean {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chart2-s2-"));
  let allPassed = true;

  function writeVersioned(root: string, versions: (string | null)[]): void {
    // versions maps 1:1 onto VERSION_SOURCES. null → omit the field (still write the file).
    VERSION_SOURCES.forEach((relPath, i) => {
      const abs = path.join(root, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const v = versions[i];
      const obj: Record<string, unknown> = v === null ? { name: "x" } : { name: "x", version: v };
      fs.writeFileSync(abs, JSON.stringify(obj));
    });
  }

  function writeEvidence(root: string, full: boolean, foreign: boolean): string {
    const p = path.join(root, "evidence.json");
    fs.writeFileSync(p, JSON.stringify({ fullManifestPublished: full, foreignInstallE2eGreen: foreign }));
    return p;
  }

  function check(name: string, actual: number, expected: number): void {
    // compare to 3 decimals to tolerate 1/3 float representation
    const ok = Math.abs(actual - expected) < 1e-9;
    if (ok) {
      console.log(`SELFTEST PASS: ${name} — cov = ${actual}`);
    } else {
      console.error(`SELFTEST FAIL: ${name} — expected cov ${expected}, got ${actual}`);
      allPassed = false;
    }
  }

  // RED case 1: 3-way drift (the shape M126 originally observed) + no evidence → 0/3.
  {
    const root = path.join(tmpDir, "drift");
    writeVersioned(root, ["0.3.8", "0.3.22", "0.3.5"]);
    const ev = writeEvidence(root, false, false);
    const fields = readVersionFields(root);
    const vc = versionsConsistent(fields);
    const { fullManifestPublished, foreignInstallE2eGreen } = loadS2Evidence(ev);
    const { cov } = computeS2Cov(vc, fullManifestPublished, foreignInstallE2eGreen);
    if (vc !== false) { console.error("SELFTEST FAIL: drift versions should be inconsistent"); allPassed = false; }
    check("red-drift-no-evidence", cov, 0);
  }

  // RED case 2: versions aligned but evidence flags false → 1/3.
  {
    const root = path.join(tmpDir, "aligned-no-evidence");
    writeVersioned(root, ["0.4.0", "0.4.0", "0.4.0"]);
    const ev = writeEvidence(root, false, false);
    const fields = readVersionFields(root);
    const vc = versionsConsistent(fields);
    const { fullManifestPublished, foreignInstallE2eGreen } = loadS2Evidence(ev);
    const { cov } = computeS2Cov(vc, fullManifestPublished, foreignInstallE2eGreen);
    if (vc !== true) { console.error("SELFTEST FAIL: aligned versions should be consistent"); allPassed = false; }
    check("red-aligned-no-evidence", cov, 1 / 3);
  }

  // RED case 3: one missing version field (null) → not consistent → cov 0/3.
  {
    const root = path.join(tmpDir, "missing-field");
    writeVersioned(root, ["0.4.0", null, "0.4.0"]);
    const ev = writeEvidence(root, false, false);
    const fields = readVersionFields(root);
    const vc = versionsConsistent(fields);
    const { fullManifestPublished, foreignInstallE2eGreen } = loadS2Evidence(ev);
    const { cov } = computeS2Cov(vc, fullManifestPublished, foreignInstallE2eGreen);
    if (vc !== false) { console.error("SELFTEST FAIL: a null field should make versions inconsistent"); allPassed = false; }
    check("red-missing-version-field", cov, 0);
  }

  // GREEN case: all aligned + both evidence flags true → 3/3 = 1.0.
  {
    const root = path.join(tmpDir, "all-green");
    writeVersioned(root, ["0.4.0", "0.4.0", "0.4.0"]);
    const ev = writeEvidence(root, true, true);
    const fields = readVersionFields(root);
    const vc = versionsConsistent(fields);
    const { fullManifestPublished, foreignInstallE2eGreen } = loadS2Evidence(ev);
    const { cov } = computeS2Cov(vc, fullManifestPublished, foreignInstallE2eGreen);
    check("green-all-satisfied", cov, 1);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (allPassed) {
    console.log("SELFTEST: all fixture cases PASS.");
    return true;
  } else {
    console.error("SELFTEST: one or more fixture cases FAILED.");
    return false;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage(): never {
  console.error("usage: node chart2-s2-delivery-completeness.ts [<repoRoot>]");
  console.error("       node chart2-s2-delivery-completeness.ts --selftest");
  process.exit(2);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();
  if (args.includes("--selftest")) {
    const ok = selftest();
    process.exit(ok ? 0 : 1);
  }
  const repoRootArg = args.find((a) => !a.startsWith("--"));
  const repoRoot = repoRootArg ? path.resolve(process.cwd(), repoRootArg) : DEFAULT_REPO_ROOT;
  // Evidence path: co-located with the experiment for the default root; else look under the given root.
  const evidencePath = repoRootArg
    ? path.join(repoRoot, "experiments", "quay-perpetual-stream", "chart2-s2-delivery.json")
    : DEFAULT_EVIDENCE_PATH;

  const fields = readVersionFields(repoRoot);
  const versionConsistent = versionsConsistent(fields);
  const { fullManifestPublished, foreignInstallE2eGreen } = loadS2Evidence(evidencePath);
  const { cov, satisfied } = computeS2Cov(versionConsistent, fullManifestPublished, foreignInstallE2eGreen);

  console.log(
    `S2 Delivery-completeness cov = ${cov} (${satisfied}/3: version-consistent=${versionConsistent}, manifest-published=${fullManifestPublished}, foreign-install-green=${foreignInstallE2eGreen})`
  );
  process.exit(0);
}
