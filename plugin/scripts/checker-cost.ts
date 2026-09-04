// checker-cost.ts — the criterion-cost RECORDING mechanism (pure-append, zero-judgment).
// Task: gap-no-criterion-records-its-own-cost-checker-cost-jsonl
//
// PROBLEM IT FIXES: no standing criterion records its OWN cost. The generator's "what range does
// this criterion quantify" is a point-in-time axis, but nobody measures how EXPENSIVE a criterion
// is to CHECK — all 16 static checkers + 14 gates persist ZERO execution time
// (full-suite-state.json durationMs is the single exception, and suite-level only). The
// ready-pool-check slope 35.8s→91.2s→157.0s in one hour was ONLY visible because the manager
// hand-timed it twice.
//
// THIS FILE: the TS-side writer. Each criterion appends ONE line `{name, ms, n, load, at}` to
// `<root>/.quay/checker-cost.jsonl` on exit — PURE APPEND, ZERO JUDGMENT (no thresholds, no
// flags — that is the trend-criterion's job, gap-quality-criteria-are-point-in-time-no-trend-
// criteria). The trend grows itself; a reader (a future trend criterion) consumes the history.
//
//   - `load` = /proc/loadavg 1-min value — the ONLY field that splits "the criterion got slower"
//     into "n got bigger" vs "the machine got busier" (attribution correction, proposal point 5:
//     the pool-same two points 91.2s→157.0s with load 30.91 proved load is the dominant variable,
//     not n).
//   - `n`   = the criterion's input size. For most checkers an external wrapper records n=1 (one
//     criterion run); ready-pool-check self-records its REAL pool size as n (the exemplar dual-
//     dimension case, AC2).
//
// The bash-side writer lives in plugin/scripts/checker-cost-lib.sh (same JSONL shape, near-zero
// overhead for the static-check wrapper — no node spawn per checker). The gate-side writer is
// inlined in packages/quay/src/gate/engine.ts (the Core stays dependency-free). The SHAPE is
// pinned by plugin/test/checker-cost.test.mjs.
//
// Usage (CLI — used by bash wrappers and the AC2 fixture):
//   node --no-warnings --experimental-strip-types plugin/scripts/checker-cost.ts \
//     --root <workspace-root> --name <criterion> --ms <millis> [--n <n>] [--load <load>]
//
// Env overrides (deterministic test seams):
//   CHECKER_COST_LOAD_OVERRIDE — a load value to record instead of reading /proc/loadavg
//     (lets a fixture reproduce the "pool-same, load-different" attribution case).
//   CHECKER_COST_FILE         — override the .quay/checker-cost.jsonl path (hermetic tests).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CHECKER_COST_FILENAME = "checker-cost.jsonl";

/** /proc/loadavg 1-min load, or the CHECKER_COST_LOAD_OVERRIDE test seam. 0 on any failure (fail-open). */
export function getLoad1(): number {
  const override = process.env.CHECKER_COST_LOAD_OVERRIDE;
  if (override !== undefined) {
    const v = Number(override);
    return Number.isFinite(v) ? v : 0;
  }
  try {
    const s = fs.readFileSync("/proc/loadavg", "utf8");
    const v = Number(s.trim().split(/\s+/)[0]);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function checkerCostFile(root: string): string {
  return process.env.CHECKER_COST_FILE ?? path.join(root, ".quay", CHECKER_COST_FILENAME);
}

export interface CheckerCostRecord {
  name: string;
  ms: number;
  n: number;
  load: number;
  at: string;
}

/**
 * Append one `{name, ms, n, load, at}` line to `<root>/.quay/checker-cost.jsonl`.
 * PURE APPEND — never truncates, never overwrites, never judges (no threshold, no flag).
 * `n` defaults to 1 (one criterion run) when the caller has no real input-size signal.
 * Returns the file path written.
 */
export function recordCheckerCost(opts: { root: string; name: string; ms: number; n?: number; load?: number }): string {
  const rec: CheckerCostRecord = {
    name: opts.name,
    ms: opts.ms,
    n: opts.n ?? 1,
    load: opts.load ?? getLoad1(),
    at: new Date().toISOString(),
  };
  const file = checkerCostFile(opts.root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(rec)}\n`, "utf8");
  return file;
}

/** Read every parsed record from a checker-cost.jsonl file (skips malformed lines fail-open). */
export function readCheckerCost(file: string): CheckerCostRecord[] {
  if (!fs.existsSync(file)) return [];
  const out: CheckerCostRecord[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r.name === "string") out.push(r);
    } catch {
      // malformed line — skip fail-open (pure-append store must never break readers)
    }
  }
  return out;
}

function main(argv: string[]): number {
  let root: string | undefined;
  let name: string | undefined;
  let ms = 0;
  let n: number | undefined;
  let load: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--name") name = argv[++i];
    else if (argv[i] === "--ms") ms = Number(argv[++i]);
    else if (argv[i] === "--n") n = Number(argv[++i]);
    else if (argv[i] === "--load") load = Number(argv[++i]);
  }
  if (!root || !name || !Number.isFinite(ms)) {
    process.stderr.write(
      "usage: checker-cost.ts --root <dir> --name <criterion> --ms <millis> [--n <n>] [--load <load>]\n",
    );
    return 2;
  }
  recordCheckerCost({ root, name, ms, n, load });
  return 0;
}

// Bundler-friendly direct-entry guard (gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-
// artifact): when checker-cost is BUNDLED into another tool (e.g. ready-pool-check), the inlined
// module shares the bundle's import.meta.url, so URL equality would falsely fire. Basename match
// distinguishes running checker-cost itself from being inlined into another entry.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "checker-cost"
) {
  process.exitCode = main(process.argv.slice(2));
}
