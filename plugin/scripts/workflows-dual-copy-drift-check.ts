#!/usr/bin/env node
// workflows-dual-copy-drift-check.ts — .claude/workflows/ vs plugin/workflows/ 双副本漂移检查
// (tasks/gap-workflows-dual-copy-drift-unchecked)
// @judges .claude/workflows/* plugin/workflows/*
//
// WHY IT EXISTS: three workflow files live in BOTH `.claude/workflows/` (what THIS workspace's
// workflow dispatcher actually executes) and `plugin/workflows/` (the source that quay-init
// `--workflows` ships to installed targets → `<workspace>/.claude/workflows/`). The repo's default
// discipline for "one file in two places" is 双副本同改 + a drift check (the execution-core
// precedent: orchestration/*-tick-core.md vs plugin/loop/*-tick-core.md, guarded by
// tick-core-static-check --check-drift). BEFORE this checker there was NO mechanism: a one-sided
// edit (change only .claude/ or only plugin/) had no consumer that went red — a fixed 正本 with a
// stale landing copy means the shipped workflow script is old (the A6/fan-in-execute.js class of
// bug). 判据1 = drift check lands (漂移 ⇒ 红); 判据2 能取假 = one-sided edit replays RED,
// current byte-identical replays GREEN; 判据3 = aligned with the AC73 判据4 boundary (execution-core
// dual-copy visibility extends to the workflows dual-copy).
//
// THE SET IS PINNED, NOT DERIVED (硬规则 3a 枚举不布尔): the three files that are dual-copy TODAY
// are declared explicitly. A file missing from ONE side is a DRIFT state (RED) — if a dual-copy
// file is deleted from one directory the check must not silently stop covering it. The set does
// NOT include the four single-copy workflow files (execute-suite-fix / manager-tick-core /
// pool-quality-judge / select-preflight — legitimately .claude/-only); the task deliberately does
// NOT prescribe which files should be dual-copy (现结构推定).
//
// Drift gate: exit 1 when ANY pair differs OR any expected side is missing; prints BOTH sides'
// line counts + a diff summary (not a "drift/consistent" boolean). --no-block = report-only
// (print the full RED readout but exit 0) — the same seam tick-core-static-check --check-drift
// --no-block uses to make a pre-existing drift VISIBLE without halting unrelated commits until a
// follow-up reconciles the pairs.
//
// Run:
//   node --experimental-strip-types workflows-dual-copy-drift-check.ts [--root <dir>]
//       [--json] [--no-block]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// ── The three dual-copy workflow files (pinned set — see header). ────────────────────────────────
const DUAL_COPY_FILES = [
  "drain-directives.js",
  "fan-in-execute.js",
  "run-routines.js",
];

/** The pairs: landed (.claude/workflows/, what runs HERE) vs shipped (plugin/workflows/, what
 *  quay-init ships to installed targets). Both paths are repo-root-relative. */
export const WORKFLOW_DRIFT_PAIRS = DUAL_COPY_FILES.map((base) => ({
  landed: `.claude/workflows/${base}`,
  shipped: `plugin/workflows/${base}`,
}));

export interface DriftPair {
  landed: string;          // .claude/workflows/<name>
  shipped: string;         // plugin/workflows/<name>
  consistent: boolean;
  landedLines: number;     // -1 when the file is missing
  shippedLines: number;    // -1 when the file is missing
  diffStat: string;        // unified-diff summary: hunks + +N/-M lines + hunk headers ("" when consistent)
}

export interface DriftResult {
  ok: boolean;
  pairs: DriftPair[];
}

/** Line count of a file, or -1 when it does not exist. */
function lineCountOrMinusOne(abs: string): number {
  if (!fs.existsSync(abs)) return -1;
  return fs.readFileSync(abs, "utf8").split("\n").length;
}

/** Summarize a 0-context unified diff: the +N/-M change counts + the hunk location headers. */
function summarizeDiff(u: string): string {
  if (!u) return "";
  const lines = u.split("\n");
  const hunks = lines.filter((l) => l.startsWith("@@"));
  const added = lines.filter((l) => /^\+[^+]/.test(l)).length;
  const removed = lines.filter((l) => /^-[^-]/.test(l)).length;
  const head = `unified diff: ${hunks.length} hunk${hunks.length === 1 ? "" : "s"}, +${added}/-${removed} lines`;
  const hunkHead = hunks.slice(0, 5).join(" ; ");
  return hunkHead ? `${head}\n    ${hunkHead}` : head;
}

/** A diff SUMMARY between two files (a magnitude/character readout, not a boolean). GNU
 *  `diff --stat` is missing on some builds, so compute the summary from a 0-context unified diff
 *  (same helper as tick-core-static-check's drift mode). diff exits 1 on difference, so the stdout
 *  is read off the thrown error; on any failure a fallback "files differ" is returned so the drift
 *  gate never hangs on diff. */
function diffStat(a: string, b: string): string {
  try {
    return summarizeDiff(execFileSync("diff", ["-U0", a, b], { encoding: "utf8", timeout: 5_000 }).trim());
  } catch (err) {
    const stdout = (err as { stdout?: string | Buffer }).stdout;
    if (typeof stdout === "string" && stdout.trim()) return summarizeDiff(stdout.trim());
    return "files differ";
  }
}

export function runWorkflowsDriftCheck(root: string): DriftResult {
  const pairs = WORKFLOW_DRIFT_PAIRS.map(({ landed, shipped }) => {
    const landedAbs = path.join(root, landed);
    const shippedAbs = path.join(root, shipped);
    const landedLines = lineCountOrMinusOne(landedAbs);
    const shippedLines = lineCountOrMinusOne(shippedAbs);
    const bothExist = landedLines >= 0 && shippedLines >= 0;
    const consistent = bothExist
      && fs.readFileSync(landedAbs, "utf8") === fs.readFileSync(shippedAbs, "utf8");
    return {
      landed, shipped, consistent, landedLines, shippedLines,
      diffStat: consistent ? "" : diffStat(landedAbs, shippedAbs),
    };
  });
  return { ok: pairs.every((p) => p.consistent), pairs };
}

function printDriftReport(res: DriftResult): string[] {
  const out: string[] = [];
  for (const p of res.pairs) {
    if (p.consistent) {
      out.push(`  ok: ${p.landed} (${p.landedLines} lines) == ${p.shipped} (${p.shippedLines} lines)`);
      continue;
    }
    const landedLines = p.landedLines >= 0 ? `${p.landedLines}` : "MISSING";
    const shippedLines = p.shippedLines >= 0 ? `${p.shippedLines}` : "MISSING";
    out.push(`  DRIFT: ${p.landed} (${landedLines} lines) vs ${p.shipped} (${shippedLines} lines)`);
    if (p.diffStat) for (const l of p.diffStat.split("\n")) out.push(`    ${l}`);
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
interface CliResult { code: number; json: unknown; }

function usage(): CliResult {
  process.stderr.write(
    "usage: workflows-dual-copy-drift-check.ts [--root <dir>] [--json] [--no-block]\n",
  );
  return { code: 2, json: { error: "usage" } };
}

export function main(argv: string[]): CliResult {
  let root = process.cwd();
  let json = false;
  let noBlock = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = argv[++i];
      if (root === undefined) return usage();
    } else if (a === "--json") {
      json = true;
    } else if (a === "--no-block") {
      // Report-only drift check: print the full RED/consistent readout but exit 0. The same seam
      // tick-core-static-check --check-drift --no-block uses for PRE-EXISTING drift: the current
      // drift is VISIBLE at every run without halting unrelated commits until a follow-up
      // reconciles the pairs.
      noBlock = true;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "workflows-dual-copy-drift-check.ts — are the three dual-copy workflow files (drain-directives / fan-in-execute / run-routines) byte-identical between .claude/workflows/ (what runs here) and plugin/workflows/ (what quay-init ships)? Drift ⇒ exit 1.\n",
      );
      return { code: 0, json: { help: true } };
    } else {
      return usage();
    }
  }

  let driftRes: DriftResult;
  try {
    driftRes = runWorkflowsDriftCheck(root);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return { code: 1, json: { error: (err as Error).message } };
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(driftRes, null, 2)}\n`);
    return { code: driftRes.ok || noBlock ? 0 : 1, json: driftRes };
  }
  process.stdout.write(
    `workflows-dual-copy-drift-check: drift check — ${WORKFLOW_DRIFT_PAIRS.length} pairs, ` +
    `${driftRes.pairs.filter((p) => p.consistent).length} consistent / ${driftRes.pairs.filter((p) => !p.consistent).length} drifted\n`,
  );
  for (const l of printDriftReport(driftRes)) process.stdout.write(`${l}\n`);
  if (!driftRes.ok) process.stdout.write(`workflows-dual-copy-drift-check: RED — workflows dual-copy drift gate violated (.claude/workflows/* vs plugin/workflows/*).\n`);
  else process.stdout.write(`workflows-dual-copy-drift-check: PASS — every dual-copy workflow matches its other copy.\n`);
  return { code: driftRes.ok || noBlock ? 0 : 1, json: driftRes };
}

// Direct `node plugin/scripts/workflows-dual-copy-drift-check.ts` (with --experimental-strip-types)
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = main(process.argv.slice(2));
  if (res.code !== 0) process.exitCode = res.code;
}
