#!/usr/bin/env node
// chart2-s2-delivery-completeness.ts — machine-verifiable cov calculator for chart-2 surface S2
// (Delivery completeness), per DIR-064 / DIR-064-A §6.2. S2 replaces prose ("~0.1: Core-only;
// 5-way version drift; no install mechanism") with an OBJECTIVE, capped cov computed from three
// sub-checks:
//
//   (1) version-consistency — LOCALLY COMPUTABLE NOW. The 5 published version fields must all be
//       equal. Sourced live from:
//         packages/quay/package.json                → .version
//         .claude-plugin/marketplace.json           → .plugins[0].version   (root marketplace)
//         plugin/.claude-plugin/plugin.json         → .version
//         plugin/.claude-plugin/marketplace.json    → .plugins[0].version
//         plugin/vendor/quay/package.json           → .version
//       A missing file/field reads as null → treated as NOT consistent.
//
//   (2) full-manifest-published — from the checked-in evidence file chart2-s2-delivery.json
//       (fullManifestPublished). A delivery manifest does not exist yet → false.
//
//   (3) foreign-install-e2e-green — from the same evidence file (foreignInstallE2eGreen). No
//       foreign-workspace install e2e exists yet → false.
//
//   cov = (# sub-checks satisfied) / 3.
//
// On the CURRENT real repo this computes cov = 0/3 = 0.0: the 5 versions are inconsistent
// (0.3.8 / 0.3.5 / 0.3.22 / 0.3.16 / 0.3.5) and both evidence flags are false. When all 5 versions
// align AND the full manifest is published AND the foreign-install e2e goes green, cov → 3/3 = 1.0.
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

// The 5 version sources. `pointer` selects how to read the version out of the parsed JSON:
//   "version"           → obj.version
//   "plugins0.version"  → obj.plugins[0].version   (marketplace.json nesting)
interface VersionSourceSpec {
  relPath: string;
  pointer: "version" | "plugins0.version";
}

const VERSION_SOURCES: VersionSourceSpec[] = [
  { relPath: "packages/quay/package.json", pointer: "version" },
  { relPath: ".claude-plugin/marketplace.json", pointer: "plugins0.version" },
  { relPath: "plugin/.claude-plugin/plugin.json", pointer: "version" },
  { relPath: "plugin/.claude-plugin/marketplace.json", pointer: "plugins0.version" },
  { relPath: "plugin/vendor/quay/package.json", pointer: "version" },
];

// ── readVersionField — read one version field from one JSON file. ────────────────────────────────
// A missing file, unparseable JSON, or a missing/non-string field all yield version:null.
function readVersionField(repoRoot: string, spec: VersionSourceSpec): VersionField {
  const abs = path.join(repoRoot, spec.relPath);
  let version: string | null = null;
  try {
    const raw = fs.readFileSync(abs, "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    let val: unknown;
    if (spec.pointer === "version") {
      val = obj.version;
    } else {
      const plugins = obj.plugins;
      if (Array.isArray(plugins) && plugins.length > 0 && plugins[0] && typeof plugins[0] === "object") {
        val = (plugins[0] as Record<string, unknown>).version;
      }
    }
    version = typeof val === "string" ? val : null;
  } catch {
    version = null;
  }
  return { source: spec.relPath, version };
}

// ── readVersionFields — read all 5 version fields, in declared order. ────────────────────────────
export function readVersionFields(repoRoot: string): VersionField[] {
  return VERSION_SOURCES.map((spec) => readVersionField(repoRoot, spec));
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
// RED case 1: 5-way version drift (the real repo's state) + no evidence → cov 0/3.
// RED case 2: versions aligned but evidence flags false → cov 1/3.
// RED case 3: a missing version file (null) → not consistent → cov contribution 0.
// GREEN case: all 5 versions aligned + both evidence flags true → cov 3/3 = 1.0.
export function selftest(): boolean {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chart2-s2-"));
  let allPassed = true;

  function writeVersioned(root: string, versions: (string | null)[]): void {
    // versions maps 1:1 onto VERSION_SOURCES. null → omit the field (still write the file).
    VERSION_SOURCES.forEach((spec, i) => {
      const abs = path.join(root, spec.relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const v = versions[i];
      let obj: Record<string, unknown>;
      if (spec.pointer === "version") {
        obj = v === null ? { name: "x" } : { name: "x", version: v };
      } else {
        obj = v === null ? { plugins: [{ name: "x" }] } : { plugins: [{ name: "x", version: v }] };
      }
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

  // RED case 1: 5-way drift (real repo's actual values) + no evidence → 0/3.
  {
    const root = path.join(tmpDir, "drift");
    writeVersioned(root, ["0.3.8", "0.3.5", "0.3.22", "0.3.16", "0.3.5"]);
    const ev = writeEvidence(root, false, false);
    const fields = readVersionFields(root);
    const vc = versionsConsistent(fields);
    const { fullManifestPublished, foreignInstallE2eGreen } = loadS2Evidence(ev);
    const { cov } = computeS2Cov(vc, fullManifestPublished, foreignInstallE2eGreen);
    if (vc !== false) { console.error("SELFTEST FAIL: drift versions should be inconsistent"); allPassed = false; }
    check("red-5way-drift-no-evidence", cov, 0);
  }

  // RED case 2: versions aligned but evidence flags false → 1/3.
  {
    const root = path.join(tmpDir, "aligned-no-evidence");
    writeVersioned(root, ["0.4.0", "0.4.0", "0.4.0", "0.4.0", "0.4.0"]);
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
    writeVersioned(root, ["0.4.0", "0.4.0", null, "0.4.0", "0.4.0"]);
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
    writeVersioned(root, ["0.4.0", "0.4.0", "0.4.0", "0.4.0", "0.4.0"]);
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
