#!/usr/bin/env node
// primitives-drift-check.ts — has packages/quay/src/primitives/*.mjs been edited IN PLACE without
// re-recording its baseline? (tasks/gap-ac253-session-primitives-shared-layer-adoption;
// direction reversed by tasks/gap-primitives-decouple-from-quay-fleet.)
//
// WHY IT EXISTS: the four session read/write primitives (pty-frame / delivery-audit /
// session-liveness / session-schema) must exist in exactly ONE shape (SPEC §3.3: "唯一不可接受的
// 是第二份手写实现"). They were originally copied byte-for-byte from quay-fleet, so a "quick local
// fix" would silently fork that shape; a one-sided hash check catches exactly that.
//
// WHAT CHANGED (2026-11-06): the upstream repo is RETIRED. quay is now the canonical home, so there
// is no second side to read: this checker compares each local file against the sha256 recorded in
// `plugin/scripts/primitives-drift-manifest.json`. That makes the invariant machine-independent —
// it is evaluable on any checkout, with no external path and no `git` subprocess. The only failure
// mode the two-copy arrangement still had is the one that remains: editing a primitive in place
// while the baseline says otherwise.
//
// STATES — deliberately distinct exit codes (hard rule 3b: a judge that cannot read its input must
// not return a value shaped like "qualified"):
//   0  = every local file matches its recorded sha256. Evaluated and consistent.
//   1  = DRIFT. A declared file is missing or its bytes differ from the baseline. Reported per file
//        with both sha256 values, so the reading is actionable.
//   3  = NOT-EVALUATED. The manifest (the baseline itself) is missing, unparsable, empty, or
//        carries a value that is not a sha256. ⛔ Never a PASS — "I have no baseline to compare
//        against" must not read the same as "everything agrees with the baseline".
//   2  = usage/env error (bad arguments; `--fleet` was retired with the external repo).
//
// Run:
//   node --experimental-strip-types plugin/scripts/primitives-drift-check.ts [--root <dir>] [--json]

import fs from "node:fs";
import path from "node:path";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { helpExit, isDirectEntry, flagValue } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";
import { sha256OfBuffer } from "./sha256.ts";

/** The manifest carrying the local baseline (repo-root-relative). */
export const MANIFEST_REL = "plugin/scripts/primitives-drift-manifest.json";

/** A sha256 as it appears in the manifest — 64 lowercase hex characters, nothing else. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface PrimitivesDriftManifest {
  /** Directory holding the primitives, relative to the repo root. */
  localDir: string;
  /** file basename → the sha256 this repo has re-baselined it to. */
  files: Record<string, string>;
}

export interface FileReading {
  file: string;
  /** sha256 of the file on disk, or null when it is absent/unreadable. */
  localSha256: string | null;
  /** sha256 recorded in the manifest (the baseline). */
  baselineSha256: string;
}

export interface PrimitivesDriftResult {
  /** The manifest's local dir, repo-root-relative (echoed so a reading names its own subject). */
  localDir: string;
  files: FileReading[];
}

function sha256OfFile(abs: string): string | null {
  try {
    return sha256OfBuffer(fs.readFileSync(abs));
  } catch {
    return null; // absent or unreadable — a null reading, never a fabricated hash
  }
}

/**
 * Read the baseline. Throws on a missing/corrupt/empty manifest and on any value that is not a
 * sha256 — the caller maps every one of those to exit 3 (NOT-EVALUATED), because in each case we
 * have no baseline and therefore no basis to call the files wrong OR right.
 */
export function readManifest(root: string): PrimitivesDriftManifest {
  const abs = path.join(root, MANIFEST_REL);
  const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as PrimitivesDriftManifest;
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    typeof parsed.localDir !== "string" ||
    !parsed.files || typeof parsed.files !== "object" || Array.isArray(parsed.files)
  ) {
    throw new Error(`manifest ${MANIFEST_REL} is malformed (missing localDir/files)`);
  }
  const entries = Object.entries(parsed.files);
  if (entries.length === 0) {
    throw new Error(`manifest ${MANIFEST_REL} records no baseline files`);
  }
  for (const [file, sha] of entries) {
    if (typeof sha !== "string" || !SHA256_HEX.test(sha)) {
      throw new Error(`manifest ${MANIFEST_REL} has a malformed baseline for ${file} (expected 64 lowercase hex chars)`);
    }
  }
  return parsed;
}

/**
 * Compare every declared file against the baseline. Every field is a direct reading — no derived
 * boolean stands in for a hash, and no second source (repo, commit, working tree) is consulted.
 */
export function runPrimitivesDriftCheck(root: string): PrimitivesDriftResult {
  const manifest = readManifest(root);
  const localDir = path.join(root, manifest.localDir);

  const files: FileReading[] = Object.entries(manifest.files).map(([file, baselineSha256]) => ({
    file,
    localSha256: sha256OfFile(path.join(localDir, file)),
    baselineSha256,
  }));

  return { localDir: manifest.localDir, files };
}

/** The files that disagree with the baseline. A missing local file IS a drift, not a skip. */
export function driftedFiles(res: PrimitivesDriftResult): FileReading[] {
  return res.files.filter((f) => f.localSha256 !== f.baselineSha256);
}

const usage = `primitives-drift-check.ts — has packages/quay/src/primitives/*.mjs been edited in place without re-recording its baseline?

Usage:
  node --experimental-strip-types plugin/scripts/primitives-drift-check.ts [--root <dir>] [--json]

Exit: 0 = every primitive matches its recorded local baseline; 1 = drift (bytes differ or a
declared file is missing); 2 = usage/env error; 3 = NOT-EVALUATED (the baseline manifest is
missing, unparsable, empty, or not sha256 values — never conflated with 'consistent').`;

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  if (args.includes("--fleet") || args.some((a) => a.startsWith("--fleet="))) {
    // The external side was retired (gap-primitives-decouple-from-quay-fleet). Silently ignoring a
    // stale `--fleet` would let a caller believe a two-sided comparison happened when only the
    // local baseline was read — the exact shape hard rule 3b forbids.
    process.stderr.write(
      "primitives-drift-check: usage error — `--fleet` was retired with the external reference repo; " +
      "this checker compares the LOCAL baseline only (packages/quay/src/primitives/PROVENANCE.md).\n",
    );
    return 2;
  }
  const asJson = args.includes("--json");
  const root = path.resolve(flagValue(args, "--root") ?? repoRoot());

  let res: PrimitivesDriftResult;
  try {
    res = runPrimitivesDriftCheck(root);
  } catch (err) {
    // An unreadable baseline is NOT-EVALUATED, not drift: no baseline means we cannot call any file
    // wrong OR right (hard rule 3b — never a PASS, never a fabricated RED).
    process.stderr.write(
      `primitives-drift-check: NOT-EVALUATED — baseline unreadable (${(err as Error).message})\n`,
    );
    if (asJson) console.log(JSON.stringify({ evaluated: false, reason: (err as Error).message }, null, 2));
    return 3;
  }

  const drifted = driftedFiles(res);
  if (asJson) {
    console.log(JSON.stringify({ ...res, ok: drifted.length === 0 }, null, 2));
  } else {
    console.log(
      `primitives-drift-check: ${res.files.length} file(s) compared against the local baseline (${res.localDir})`,
    );
    for (const f of res.files) {
      const local = f.localSha256 === null ? "<missing>" : f.localSha256.slice(0, 12);
      const mark = f.localSha256 === f.baselineSha256 ? "ok   " : "DRIFT";
      console.log(`  ${mark} ${f.file}: local=${local} baseline=${f.baselineSha256.slice(0, 12)}`);
    }
    if (drifted.length === 0) {
      console.log("primitives-drift-check: PASS — all four primitives match their recorded local baseline.");
    } else {
      console.log(
        `primitives-drift-check: RED — ${drifted.length} primitive(s) diverge from the recorded baseline ` +
        `(an in-place edit without a same-commit re-baseline).`,
      );
    }
  }
  return drifted.length === 0 ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "primitives-drift-check")) {
  process.exitCode = main(process.argv);
}
