#!/usr/bin/env node
// mirror-pair-drift-check.ts — general mirror-pair drift gate for the plugin/scripts/ ↔
// experiments/quay-perpetual-stream/scripts/ mirror (tasks/gap-mirror-pair-drift-policy-
// plugin-scripts-experiments). Replaces the per-case drift checkers (workflows-dual-copy-drift-check /
// suite-bucket-drift-check) with a GENERAL mechanism for THIS mirror class.
//
// WHY IT EXISTS: `plugin/scripts/` and `experiments/quay-perpetual-stream/scripts/` carry 61
// same-name entries: 21 are SYMLINKS (experiments → plugin, single-source references that cannot
// drift — same inode) and 40 are REAL-FILE copies (the drift surface — "copy instead of
// abstraction", doc §2.2/§2.8 R6/R7). The only prior drift checkers were PINNED single-file-pair
// lists; this checker AUTO-DISCOVERS every same-basename REAL-FILE pair between the two directories
// and byte-compares them, so a future mirror drift (any extension: .ts / .mjs / .sh) goes RED without
// anyone remembering to add the filename to a list. The 12 syncable copies were re-synced at filing
// (experiments ← plugin, the product/canonical layer); the 2 structural copies
// (tree-hygiene-check.sh / worktree-branch-hygiene-check.sh — whose repo-root resolution is
// directory-depth-dependent, so byte-identity is the WRONG invariant) live in the ALLOW-LIST.
//
// AUTO-DISCOVERY SEMANTICS (derived set, not pinned):
//   • a REGULAR FILE present in BOTH dirs is a pair (byte-compared). A SYMLINK on either side is
//     NOT a pair — it is a single-source reference (the same file), so it cannot drift; the checker
//     excludes it rather than comparing a file against itself.
//   • a file present in only ONE dir is NOT a pair — it is a legitimate layer-specific file
//     (plugin/ has 250 plugin-only files, experiments/ has 62 experiment-only files), so a missing
//     mirror is NOT a drift state. This is the deliberate trade-off of auto-discovery over a pinned
//     set: a mirror copy deleted from one side silently stops being compared (documented, not a
//     defect of this check — the set to dual-copy is a structural question this check does not
//     re-derive).
//
// ALLOW-LIST (AC3 — the exemption is READ and re-checked, never one-shot):
//   plugin/scripts/mirror-pair-drift-allowlist.json maps basename → { reason, pluginSha256,
//   experimentsSha256 }. A drifted pair whose name is in the allow-list AND whose CURRENT sha256s
//   equal the recorded sha256s is an ALLOWED drift (visible, not red). If EITHER side's sha256
//   changed since allow-listing, the drift EXPANDED ⇒ RED (the exemption did not become a blind
//   pass). An allow-list entry for a now-byte-identical pair is reported as redundant (informational,
//   not red) — the drift was resolved, the entry should be removed.
//
// Exit codes: 0 = every pair consistent-or-allowed; 1 = >=1 unexempted drift or expanded drift;
//             2 = usage/env error (incl. a corrupt allow-list, fail-closed — a broken data file must
//                 not read as "empty allow-list" = "nothing exempted", hard rule 3b);
//             3 = NOT-EVALUATED (the experiments mirror directory does not exist — never conflated
//                 with "0 drift", hard rule 3b).
//
// Run:
//   node --experimental-strip-types mirror-pair-drift-check.ts [--root <dir>] [--json]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { helpExit, isDirectEntry, flagValue } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";

/** The two mirror directories (repo-root-relative). */
export const LEFT_DIR_REL = "plugin/scripts";
export const RIGHT_DIR_REL = "experiments/quay-perpetual-stream/scripts";

/** The allow-list data file (repo-root-relative). */
export const ALLOWLIST_REL = "plugin/scripts/mirror-pair-drift-allowlist.json";

export interface AllowlistEntry {
  reason: string;
  pluginSha256: string;
  experimentsSha256: string;
}

export interface PairResult {
  name: string;
  left: string;            // plugin/scripts/<name>
  right: string;           // experiments/quay-perpetual-stream/scripts/<name>
  consistent: boolean;     // byte-identical
  allowed: boolean;        // drifted BUT allow-listed with a matching signature
  driftExpanded: boolean;  // allow-listed BUT the signature changed (drift grew)
  redundantAllowlist: boolean; // allow-listed but now byte-identical (entry stale)
  leftSha256: string | null;
  rightSha256: string | null;
  allowReason: string | null;
}

export interface MirrorDriftResult {
  evaluated: boolean;
  totalPairs: number;
  consistentPairs: number;
  driftedPairs: number;
  allowedDrifts: number;
  redundantAllowlist: number;
  pairs: PairResult[];
}

export function sha256Of(abs: string): string | null {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}

/** Parse the allow-list. Throws on invalid JSON / wrong shape (caller fails closed). */
export function parseAllowlist(text: string): Record<string, AllowlistEntry> {
  const obj = JSON.parse(text);
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error("allow-list must be a JSON object");
  }
  const pairs = (obj as { pairs?: unknown }).pairs;
  if (typeof pairs !== "object" || pairs === null || Array.isArray(pairs)) {
    throw new Error('allow-list must carry a "pairs" object');
  }
  const out: Record<string, AllowlistEntry> = {};
  for (const [name, entry] of Object.entries(pairs as Record<string, unknown>)) {
    const e = entry as Partial<AllowlistEntry>;
    if (typeof e?.reason !== "string" || typeof e?.pluginSha256 !== "string" || typeof e?.experimentsSha256 !== "string") {
      throw new Error(`allow-list entry "${name}" must carry string reason/pluginSha256/experimentsSha256`);
    }
    out[name] = { reason: e.reason, pluginSha256: e.pluginSha256, experimentsSha256: e.experimentsSha256 };
  }
  return out;
}

/** Enumerate same-basename REGULAR-file pairs between the two mirror dirs (derived, not pinned). */
export function discoverPairs(leftAbs: string, rightAbs: string): string[] {
  if (!fs.existsSync(leftAbs) || !fs.existsSync(rightAbs)) return [];
  const rightFiles = new Set(
    fs.readdirSync(rightAbs, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name),
  );
  const names: string[] = [];
  for (const d of fs.readdirSync(leftAbs, { withFileTypes: true })) {
    if (!d.isFile()) continue;
    if (rightFiles.has(d.name)) names.push(d.name);
  }
  return names.sort();
}

export function runMirrorPairDriftCheck(root: string): MirrorDriftResult {
  const leftAbs = path.join(root, LEFT_DIR_REL);
  const rightAbs = path.join(root, RIGHT_DIR_REL);
  if (!fs.existsSync(leftAbs)) {
    throw new Error(`left mirror dir not found: ${leftAbs}`);
  }
  if (!fs.existsSync(rightAbs)) {
    // NOT-EVALUATED: the experiments mirror is absent — the check has no right half to compare.
    return {
      evaluated: false, totalPairs: 0, consistentPairs: 0, driftedPairs: 0,
      allowedDrifts: 0, redundantAllowlist: 0, pairs: [],
    };
  }
  // A MISSING allow-list file = no exemptions (fail-closed on any drift); a CORRUPT one throws.
  let allowlist: Record<string, AllowlistEntry> = {};
  const allowlistPath = path.join(root, ALLOWLIST_REL);
  if (fs.existsSync(allowlistPath)) {
    allowlist = parseAllowlist(fs.readFileSync(allowlistPath, "utf8"));
  }
  const names = discoverPairs(leftAbs, rightAbs);
  const pairs: PairResult[] = [];
  for (const name of names) {
    const leftContent = fs.readFileSync(path.join(leftAbs, name), "utf8");
    const rightContent = fs.readFileSync(path.join(rightAbs, name), "utf8");
    const consistent = leftContent === rightContent;
    const entry = allowlist[name];
    const leftSha256 = sha256Of(path.join(leftAbs, name));
    const rightSha256 = sha256Of(path.join(rightAbs, name));
    let allowed = false;
    let driftExpanded = false;
    let redundantAllowlist = false;
    let allowReason: string | null = null;
    if (entry) {
      allowReason = entry.reason;
      if (consistent) {
        redundantAllowlist = true; // drift was resolved — the entry is now stale
      } else if (leftSha256 === entry.pluginSha256 && rightSha256 === entry.experimentsSha256) {
        allowed = true; // known drift, unchanged since allow-listing
      } else {
        driftExpanded = true; // either side changed — the exemption must be re-reviewed
      }
    }
    pairs.push({
      name, left: `${LEFT_DIR_REL}/${name}`, right: `${RIGHT_DIR_REL}/${name}`,
      consistent, allowed, driftExpanded, redundantAllowlist, leftSha256, rightSha256, allowReason,
    });
  }
  const consistentPairs = pairs.filter((p) => p.consistent).length;
  const driftedPairs = pairs.filter((p) => !p.consistent).length;
  const allowedDrifts = pairs.filter((p) => p.allowed).length;
  const redundantAllowlist = pairs.filter((p) => p.redundantAllowlist).length;
  return {
    evaluated: true, totalPairs: pairs.length, consistentPairs, driftedPairs,
    allowedDrifts, redundantAllowlist, pairs,
  };
}

/** A pair is a RED gate violation when: drifted and NOT allowed (unexempted) OR drift expanded. */
export function redPairs(res: MirrorDriftResult): PairResult[] {
  return res.pairs.filter((p) => !p.consistent && !p.allowed);
}

function printReport(res: MirrorDriftResult): string[] {
  const out: string[] = [];
  for (const p of res.pairs) {
    if (p.consistent) {
      if (p.redundantAllowlist) {
        out.push(`  resolved: ${p.left} == ${p.right} (allow-list entry now redundant — remove it)`);
      } else {
        out.push(`  ok: ${p.left} == ${p.right}`);
      }
    } else if (p.allowed) {
      out.push(`  allowed drift: ${p.left} vs ${p.right} (reason: ${p.allowReason})`);
    } else if (p.driftExpanded) {
      out.push(`  DRIFT EXPANDED: ${p.left} vs ${p.right} — allow-listed pair changed since recording (reason was: ${p.allowReason})`);
    } else {
      out.push(`  DRIFT: ${p.left} vs ${p.right} — not allow-listed`);
    }
  }
  return out;
}

const usage = `mirror-pair-drift-check.ts — is every same-name mirror pair between ${LEFT_DIR_REL}/ and ${RIGHT_DIR_REL}/ byte-identical (or allow-listed with an unchanged drift signature)?

Usage:
  node --experimental-strip-types mirror-pair-drift-check.ts [--root <dir>] [--json]
Exit: 0 = every pair consistent-or-allowed; 1 = >=1 unexempted/expanded drift; 2 = usage/env error; 3 = NOT-EVALUATED.`;

export function main(argv: string[]): number {
  const args = argv.slice(2);
  // --help first, exit 0, no side effect (gap-help-contract-incompatible-behaviors).
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const asJson = args.includes("--json");
  const root = path.resolve(flagValue(args, "--root") ?? repoRoot());

  let res: MirrorDriftResult;
  try {
    res = runMirrorPairDriftCheck(root);
  } catch (err) {
    process.stderr.write(`mirror-pair-drift-check: ERROR — ${(err as Error).message}\n`);
    return 2;
  }

  if (!res.evaluated) {
    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`mirror-pair-drift-check: NOT-EVALUATED — mirror dir ${RIGHT_DIR_REL} absent; no right half to compare (never conflated with '0 drift')`);
    }
    return 3;
  }

  const red = redPairs(res);
  if (asJson) {
    console.log(JSON.stringify({ ...res, ok: red.length === 0 }, null, 2));
  } else {
    console.log(
      `mirror-pair-drift-check: ${res.totalPairs} pairs, ${res.consistentPairs} consistent / ` +
      `${res.driftedPairs} drifted (${res.allowedDrifts} allowed)`,
    );
    for (const l of printReport(res)) console.log(l);
    if (red.length === 0) {
      console.log(`mirror-pair-drift-check: PASS — every mirror pair matches or is allow-listed with an unchanged signature.`);
    } else {
      console.log(`mirror-pair-drift-check: RED — ${red.length} mirror pair(s) drifted (unexempted or expanded).`);
    }
  }
  return red.length === 0 ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "mirror-pair-drift-check")) {
  process.exitCode = main(process.argv);
}
