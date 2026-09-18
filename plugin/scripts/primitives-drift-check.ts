#!/usr/bin/env node
// primitives-drift-check.ts — is packages/quay/src/primitives/*.mjs still the SAME BYTES as the
// pinned quay-fleet blob it was copied from? (tasks/gap-ac253-session-primitives-shared-layer-adoption,
// SPEC §3.3 / GOAL-017 AC-253 stage A3.)
//
// WHY IT EXISTS: the four session read/write primitives (pty-frame / delivery-audit /
// session-liveness / session-schema) live in TWO repos by design — quay-fleet is the reference,
// this repo carries the copy its own product + scripts consume. That is a deliberate two-copy
// arrangement, and TWO COPIES WITHOUT A MECHANICAL CHECK is the failure mode SPEC §3.3 names
// ("唯一不可接受的是第二份手写实现"). The fleet working tree keeps moving (the four files changed
// on the very day this copy was taken), so "copy the working tree" forks the next day silently.
// The pin is a COMMIT SHA + a sha256 per file, and this checker re-reads BOTH sides every run.
//
// THREE STATES — deliberately distinct exit codes (hard rule 3b: a judge that cannot read its
// input must not return a value shaped like "qualified"):
//   0  = every local file matches the manifest sha256 AND the fleet blob at the pinned SHA
//        matches it too. Evaluated and consistent.
//   1  = DRIFT. Either side differs from the manifest (or a declared local file is missing).
//        Reported per file with both sha256 values, so the reading is actionable.
//   3  = NOT-EVALUATED. The fleet repo is not reachable, or the pinned SHA does not resolve, or
//        the manifest itself cannot be read. ⛔ Never a PASS — "I could not look at the other
//        side" must not read the same as "the other side agrees with me".
//   2  = usage/env error (bad arguments).
//
// Run:
//   node --experimental-strip-types plugin/scripts/primitives-drift-check.ts [--root <dir>] [--json]
//   node --experimental-strip-types plugin/scripts/primitives-drift-check.ts --fleet <dir>

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the ~73 byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { helpExit, isDirectEntry, flagValue } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";

/** The manifest carrying the pin (repo-root-relative). */
export const MANIFEST_REL = "plugin/scripts/primitives-drift-manifest.json";

export interface PrimitivesDriftManifest {
  fleetRepo: string;
  fleetSha: string;
  fleetSourceDir: string;
  localDir: string;
  files: Record<string, string>;
}

export interface FileReading {
  file: string;
  /** sha256 of the copy in THIS repo, or null when the file is absent/unreadable. */
  localSha256: string | null;
  /** sha256 of the fleet blob at the pinned SHA, or null when it could not be read. */
  fleetSha256: string | null;
  /** sha256 recorded in the manifest. */
  pinnedSha256: string;
}

export interface PrimitivesDriftResult {
  /** false ⇒ the fleet side could not be read at all; the verdict is NOT-EVALUATED (exit 3). */
  evaluated: boolean;
  /** Why evaluation failed, when `evaluated` is false. */
  notEvaluatedReason: string | null;
  fleetRepo: string;
  fleetSha: string;
  pinnedFleetShaResolved: string | null;
  files: FileReading[];
}

function sha256OfBuffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256OfFile(abs: string): string | null {
  try {
    return sha256OfBuffer(fs.readFileSync(abs));
  } catch {
    return null; // absent or unreadable — a null reading, never a fabricated hash
  }
}

/** Read the manifest. Throws on a missing/corrupt manifest — the caller maps that to exit 3. */
export function readManifest(root: string): PrimitivesDriftManifest {
  const abs = path.join(root, MANIFEST_REL);
  const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as PrimitivesDriftManifest;
  if (!parsed || typeof parsed !== "object" || typeof parsed.fleetSha !== "string" ||
      typeof parsed.fleetRepo !== "string" || typeof parsed.fleetSourceDir !== "string" ||
      typeof parsed.localDir !== "string" || !parsed.files || typeof parsed.files !== "object") {
    throw new Error(`manifest ${MANIFEST_REL} is malformed (missing fleetRepo/fleetSha/fleetSourceDir/localDir/files)`);
  }
  return parsed;
}

/**
 * sha256 of `<fleetRepo>:<fleetSha>:<fleetSourceDir>/<file>`, or an error marker when the blob
 * cannot be produced (repo absent, SHA unknown, path not in that tree). The marker is what makes
 * the NOT-EVALUATED state reachable — a `null`-as-hash would silently compare unequal.
 */
function readFleetBlobSha256(
  fleetRepo: string,
  fleetSha: string,
  relPath: string,
): { sha256: string | null; reason: string | null } {
  if (!fs.existsSync(fleetRepo)) {
    return { sha256: null, reason: `fleet repo absent: ${fleetRepo}` };
  }
  try {
    const buf = execFileSync("git", ["-C", fleetRepo, "show", `${fleetSha}:${relPath}`], {
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { sha256: sha256OfBuffer(buf), reason: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { sha256: null, reason: `cannot read ${fleetSha}:${relPath} from ${fleetRepo} (${msg})` };
  }
}

/**
 * Compare both sides against the pin. Every field is a direct reading — no derived boolean stands
 * in for a hash. `evaluated:false` covers both "repo absent" and "SHA/path unreadable", which are
 * the same epistemic state: we could not look at the other side.
 */
export function runPrimitivesDriftCheck(root: string, fleetRepoOverride?: string): PrimitivesDriftResult {
  const manifest = readManifest(root);
  const fleetRepo = fleetRepoOverride ?? manifest.fleetRepo;
  const localDir = path.join(root, manifest.localDir);

  const files: FileReading[] = [];
  let firstFleetReason: string | null = null;
  let allFleetReadable = true;

  for (const [file, pinnedSha256] of Object.entries(manifest.files)) {
    const localSha256 = sha256OfFile(path.join(localDir, file));
    const fleet = readFleetBlobSha256(fleetRepo, manifest.fleetSha, `${manifest.fleetSourceDir}/${file}`);
    if (fleet.sha256 === null) {
      allFleetReadable = false;
      if (firstFleetReason === null) firstFleetReason = fleet.reason;
    }
    files.push({ file, localSha256, fleetSha256: fleet.sha256, pinnedSha256 });
  }

  return {
    evaluated: allFleetReadable,
    notEvaluatedReason: allFleetReadable ? null : firstFleetReason,
    fleetRepo,
    fleetSha: manifest.fleetSha,
    pinnedFleetShaResolved: allFleetReadable ? manifest.fleetSha : null,
    files,
  };
}

/** The files that disagree with the pin on either side. A missing local file IS a drift. */
export function driftedFiles(res: PrimitivesDriftResult): FileReading[] {
  return res.files.filter((f) => f.localSha256 !== f.pinnedSha256 || f.fleetSha256 !== f.pinnedSha256);
}

const usage = `primitives-drift-check.ts — are the four shared session primitives still byte-identical to the pinned quay-fleet blob?

Usage:
  node --experimental-strip-types plugin/scripts/primitives-drift-check.ts [--root <dir>] [--fleet <dir>] [--json]

Exit: 0 = consistent with the pin; 1 = drift (local or fleet side differs, or a declared file is
missing); 2 = usage/env error; 3 = NOT-EVALUATED (fleet repo absent, or the pinned SHA/path
unreadable — never conflated with 'consistent').`;

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const asJson = args.includes("--json");
  const root = path.resolve(flagValue(args, "--root") ?? repoRoot());
  const fleetOverride = flagValue(args, "--fleet");

  let res: PrimitivesDriftResult;
  try {
    res = runPrimitivesDriftCheck(root, fleetOverride);
  } catch (err) {
    // A missing/corrupt manifest is NOT-EVALUATED, not drift: the pin itself is unreadable, so we
    // have no basis to call either side wrong (hard rule 3b — never a PASS, never a false RED).
    process.stderr.write(
      `primitives-drift-check: NOT-EVALUATED — manifest unreadable (${(err as Error).message})\n`,
    );
    if (asJson) console.log(JSON.stringify({ evaluated: false, reason: (err as Error).message }, null, 2));
    return 3;
  }

  if (!res.evaluated) {
    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(
        `primitives-drift-check: NOT-EVALUATED — ${res.notEvaluatedReason} (pinned ${res.fleetSha.slice(0, 12)}); ` +
        `the local copies were NOT compared against the fleet side (never conflated with 'no drift')`,
      );
    }
    return 3;
  }

  const drifted = driftedFiles(res);
  if (asJson) {
    console.log(JSON.stringify({ ...res, ok: drifted.length === 0 }, null, 2));
  } else {
    console.log(
      `primitives-drift-check: ${res.files.length} file(s) pinned at ${res.fleetSha.slice(0, 12)} ` +
      `(${res.fleetRepo})`,
    );
    for (const f of res.files) {
      const local = f.localSha256 === null ? "<missing>" : f.localSha256.slice(0, 12);
      const fleet = f.fleetSha256 === null ? "<unreadable>" : f.fleetSha256.slice(0, 12);
      const mark = f.localSha256 === f.pinnedSha256 && f.fleetSha256 === f.pinnedSha256 ? "ok  " : "DRIFT";
      console.log(
        `  ${mark} ${f.file}: local=${local} fleet=${fleet} pinned=${f.pinnedSha256.slice(0, 12)}`,
      );
    }
    if (drifted.length === 0) {
      console.log("primitives-drift-check: PASS — all four primitives match the pinned quay-fleet blob byte-for-byte.");
    } else {
      console.log(`primitives-drift-check: RED — ${drifted.length} primitive(s) drifted from the pin.`);
    }
  }
  return drifted.length === 0 ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "primitives-drift-check")) {
  process.exitCode = main(process.argv);
}
