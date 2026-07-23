#!/usr/bin/env node
// chart2-s1-distribution-reliability.ts — the chart-2 Surface S1 (Distribution reliability)
// value ruler for the quay-perpetual-stream experiment (DIR-064 / DIR-064-A, §6.2).
//
// S1's machine-verifiable cov (capped [0,1]) is defined by DIR-064 as:
//
//     cov = (release artifacts passing runtime-smoke on the declared Node floor)
//           / (total artifacts)
//
// This script computes that quotient from an OBJECTIVE, checked-in evidence source
// (chart2-s1-artifacts.json), where each artifact's pass/fail is cited to a real CI run.
// It is the objective anti-gaming ruler: the cov is a count of green floor-smoke jobs over
// the total shipped artifacts, NOT an asserted number. On the seeded v0.3.8 evidence
// (npm-pack green; SEA×3 red — the exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH import.meta.url
// CJS crash; plugin untested) it computed cov = 1/5 = 0.2, matching DIR-064's ~0.2 estimate.
//
// Δv realized (M121): closing exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH flipped sea-linux-x64 to
// floorSmokePass:true (real evidence: sea-verify-node-free green on a Node-free container, run
// 29995456654), moving cov 1/5 → 2/5 = 0.4 — the concrete demonstration that the open backlog now
// scores on chart-2 (DIR-064 AC #5). sea-macos-arm64/sea-windows-x64 remain unflipped: their SEA
// builds succeeded in the same run, but no runtime-smoke job covers those platforms yet
// (sea-verify-node-free is linux-only) — honestly left at floorSmokePass:false pending
// exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY, not asserted without evidence.
//
// Fail-closed discipline: an empty artifact list throws rather than returning a silent 0/0.
// A cov ruler that reads 0 from "no artifacts" would be indistinguishable from "everything
// failed", gaming the slope downward with no evidence — so we refuse to compute it.
//
// Usage:
//   node chart2-s1-distribution-reliability.ts [<path-to-json>]   (default: ../chart2-s1-artifacts.json)
//   node chart2-s1-distribution-reliability.ts --selftest
//
// Exit codes:
//   0 = cov computed (or selftest passed)
//   1 = selftest failed
//   2 = usage/environment error (missing/invalid evidence file)

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default evidence source: the checked-in artifacts record one directory up from scripts/.
export const DEFAULT_ARTIFACTS_JSON = path.join(__dirname, "..", "chart2-s1-artifacts.json");

export interface S1Artifact {
  name: string;
  floorSmokePass: boolean;
}

export interface S1Cov {
  cov: number;
  passed: number;
  total: number;
}

// ── computeS1Cov — pure: cov = passed/total, passed = count(floorSmokePass===true). ──────────────
// Empty list → throw (fail-closed; never a silent 0/0). Only a strict boolean `true` counts as a
// pass — a missing/truthy-but-not-true floorSmokePass is treated as a fail, so the ruler cannot be
// inflated by a malformed evidence row.
export function computeS1Cov(artifacts: { name: string; floorSmokePass: boolean }[]): S1Cov {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error(
      "computeS1Cov: empty artifact list — refusing to compute a fail-closed 0/0 cov (DIR-064: cov must come from a real, non-empty release-artifact set)"
    );
  }
  const total = artifacts.length;
  const passed = artifacts.filter((a) => a.floorSmokePass === true).length;
  return { cov: passed / total, passed, total };
}

// ── loadArtifacts — read+parse the evidence JSON, return the artifacts array. ────────────────────
// Ignores the "//" comment key and any non-array top-level key (release, etc.). Throws on a missing
// file, unparseable JSON, or a missing/non-array `artifacts` key — all environment errors the CLI
// maps to exit 2.
export function loadArtifacts(jsonPath: string): S1Artifact[] {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`loadArtifacts: evidence file not found: ${jsonPath}`);
  }
  const raw = fs.readFileSync(jsonPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`loadArtifacts: invalid JSON in ${jsonPath}: ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`loadArtifacts: expected a JSON object with an "artifacts" array in ${jsonPath}`);
  }
  const artifacts = (parsed as Record<string, unknown>).artifacts;
  if (!Array.isArray(artifacts)) {
    throw new Error(`loadArtifacts: no "artifacts" array in ${jsonPath}`);
  }
  return artifacts.map((a) => {
    const rec = a as Record<string, unknown>;
    return { name: String(rec.name), floorSmokePass: rec.floorSmokePass === true };
  });
}

// ── selftest — RED+GREEN fixture cases, printing SELFTEST PASS/FAIL per case. ─────────────────────
// GREEN case: mixed 1/5 evidence (the seeded v0.3.8 shape) → cov 0.2.
// GREEN case: all-pass → 1.0; all-fail → 0.0.
// RED case: empty list → computeS1Cov throws (fail-closed).
// RED case: Δv demonstration — flipping the 3 SEA rows to pass moves cov 1/5 → 4/5 = 0.8.
// loadArtifacts round-trips a written temp evidence file (ignoring "//" and non-array keys).
export function selftest(): boolean {
  let allPassed = true;

  function check(name: string, condition: boolean, detail: string): void {
    if (condition) {
      console.log(`SELFTEST PASS: ${name} — ${detail}`);
    } else {
      console.error(`SELFTEST FAIL: ${name} — ${detail}`);
      allPassed = false;
    }
  }

  // GREEN 1: seeded mixed 1/5 → 0.2
  const mixed = [
    { name: "npm-pack", floorSmokePass: true },
    { name: "sea-linux-x64", floorSmokePass: false },
    { name: "sea-macos-arm64", floorSmokePass: false },
    { name: "sea-windows-x64", floorSmokePass: false },
    { name: "plugin-bundle", floorSmokePass: false },
  ];
  const mixedCov = computeS1Cov(mixed);
  check("mixed-1-of-5", mixedCov.cov === 0.2 && mixedCov.passed === 1 && mixedCov.total === 5, `cov=${mixedCov.cov} (${mixedCov.passed}/${mixedCov.total})`);

  // GREEN 2: all-pass → 1.0
  const allPass = computeS1Cov([{ name: "a", floorSmokePass: true }, { name: "b", floorSmokePass: true }]);
  check("all-pass", allPass.cov === 1.0, `cov=${allPass.cov}`);

  // GREEN 3: all-fail → 0.0
  const allFail = computeS1Cov([{ name: "a", floorSmokePass: false }, { name: "b", floorSmokePass: false }]);
  check("all-fail", allFail.cov === 0.0, `cov=${allFail.cov}`);

  // RED 1: empty list → throws (fail-closed)
  let threw = false;
  try {
    computeS1Cov([]);
  } catch {
    threw = true;
  }
  check("empty-throws", threw, "empty artifact list correctly threw (fail-closed, no silent 0/0)");

  // RED 2 / Δv: closing the SEA crash flips SEA×3 to pass → cov 1/5 → 4/5 = 0.8
  const afterSeaFix = mixed.map((a) => (a.name.startsWith("sea-") ? { ...a, floorSmokePass: true } : a));
  const dv = computeS1Cov(afterSeaFix);
  check("delta-v-sea-fix", dv.cov === 0.8, `closing SEA-crash moves cov 0.2 → ${dv.cov} (${dv.passed}/${dv.total})`);

  // loadArtifacts round-trip: write a temp evidence file, confirm "//" + non-array keys ignored
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chart2-s1-"));
  const tmpJson = path.join(tmpDir, "artifacts.json");
  fs.writeFileSync(
    tmpJson,
    JSON.stringify({ "//": "a comment", release: "vX", artifacts: [{ name: "one", floorSmokePass: true }, { name: "two", floorSmokePass: false }] })
  );
  const loaded = loadArtifacts(tmpJson);
  check("loadArtifacts-roundtrip", loaded.length === 2 && loaded[0].floorSmokePass === true && loaded[1].floorSmokePass === false, `loaded ${loaded.length} artifacts (ignored "//" + release keys)`);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Seeded real file → integration of loadArtifacts + computeS1Cov on the checked-in evidence.
  // Only asserts the invariant a real evidence file must satisfy (cov derived correctly from
  // passed/total, cov in [0,1]) — NOT a specific value, since the checked-in evidence legitimately
  // changes as real Δv lands (M121: 0.2 → 0.4 after the SEA crash fix flipped sea-linux-x64).
  if (fs.existsSync(DEFAULT_ARTIFACTS_JSON)) {
    const seeded = computeS1Cov(loadArtifacts(DEFAULT_ARTIFACTS_JSON));
    check(
      "seeded-file-consistent",
      seeded.cov === seeded.passed / seeded.total && seeded.cov >= 0 && seeded.cov <= 1,
      `real chart2-s1-artifacts.json → cov=${seeded.cov} (${seeded.passed}/${seeded.total})`,
    );
  }

  if (allPassed) {
    console.log("SELFTEST: all fixture cases PASS.");
    return true;
  }
  console.error("SELFTEST: one or more fixture cases FAILED.");
  return false;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    const ok = selftest();
    process.exit(ok ? 0 : 1);
  }
  const jsonPath = args.find((a) => !a.startsWith("--")) || DEFAULT_ARTIFACTS_JSON;
  try {
    const artifacts = loadArtifacts(path.resolve(process.cwd(), jsonPath));
    const { cov, passed, total } = computeS1Cov(artifacts);
    console.log(`S1 Distribution-reliability cov = ${cov} (${passed}/${total} artifacts pass floor-smoke)`);
    process.exit(0);
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    process.exit(2);
  }
}
