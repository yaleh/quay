// suite-bucket-drift-check.ts — the static-vs-dynamic-truth drift detector for
// gap-suite-bucket-dynamic-truth-drift-detector (phase B).
//
// THE DEFECT THIS CLOSES (the silent half): suite-bucket-attribution's STATIC reference closure is a
// proxy — a subject reached through a VARIABLE path segment (path.join(pluginDir, "scripts",
// "quay-init.sh")) is invisible to it, so the test is mis-attributed (worktree-root-fs-check.test.mjs
// → static S, while its runtime subject is plugin/scripts/quay-init.sh → M). That mis-attribution is
// SILENT: a bucket run that should select the test as an M test instead skips it (or selects it for
// the wrong reason), and nothing reports the discrepancy. THIS checker makes the discrepancy loud.
//
// TWO COMPARISONS:
//   1. static-vs-truth-drift  — a test whose STATIC bucket set is non-empty (so it was attributed,
//      not left UNRESOLVED) but whose DYNAMIC truth touches a file classified into a bucket NOT in
//      the static set ⇒ RED. (The S-singleton-but-dynamic-M case: M ∉ {S}.) An UNRESOLVED static
//      (empty) is NOT this drift — it is already "always selected" (safe side) elsewhere; flagging it
//      here would double-report a different failure. Dynamic ⊆ static is the SAFE direction (runtime
//      exercises a subset) and is never drift.
//   2. truth-selection-drift  — given a change's touched files, a cached test whose DYNAMIC truth
//      includes a touched file but which the bucket selection did NOT select ⇒ RED (the漏选 detector:
//      the static selection missed a test that dynamically covers the changed file). Needs the touch
//      context, so it runs only in --touches/--task mode, never in the whole-store --gate.
//
// NOT-EVALUATED (hard rule 3b): with NO trace cache (`.quay/suite-fs-trace.jsonl` absent/empty) the
// dynamic half has no input — the checker reports NOT-EVALUATED (evaluated:false, exit 0 with a
// DISTINCT line), never a green "0 drift". A green "0 drift" is only truthful when the comparison
// actually ran against a real trace cache.
//
// MODES:
//   --gate [--root <dir>] [--json]      gate mode (wired into run_static_checks). Exit 1 iff any
//                                       static-vs-truth drift is RED.
//   --touches <csv> / --task <id>       add the truth-selection comparison (needs the change context).
//   --scan                              measure mode — print every comparison's verdict, exit 0.
// Exit codes: 0 PASS/measure/NOT-EVALUATED · 1 gate FAIL (>=1 RED) · 2 usage/env error.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry, helpExit } from "./gate-script-base.ts";
import {
  bucketSetOf,
  canonicalBuckets,
  bucketsFromPaths,
  findRepoRoot,
  type Bucket,
} from "./suite-bucket-attribution.ts";
import { loadTraceCache } from "./suite-fs-trace.ts";
import { listSuiteFiles, selectBucketsForTouches } from "./suite-bucket-select.ts";
import { taskTouchEntries } from "./suite-bucket-hub-list.ts";

export interface StaticVsTruthDrift {
  file: string;
  staticBuckets: Bucket[];
  dynamicBuckets: Bucket[];
  /** the dynamic-truth paths that classified into a bucket the static set missed (the evidence). */
  evidence: string[];
}

export interface StaticVsTruthReport {
  evaluated: boolean;
  cacheCount: number;
  coveredCount: number;
  uncoveredCount: number;
  drifts: StaticVsTruthDrift[];
}

/** Buckets present in `dynamic` but absent from `static` (the漏选 direction — dynamic ⊄ static). */
export function missingDynamicBuckets(staticBuckets: Set<Bucket>, dynamicBuckets: Set<Bucket>): Set<Bucket> {
  const out = new Set<Bucket>();
  for (const b of dynamicBuckets) if (!staticBuckets.has(b)) out.add(b);
  return out;
}

/**
 * The static-vs-truth comparison over every suite test file that has a trace-cache entry. A test
 * whose static set is non-empty but whose dynamic truth reaches a bucket the static set missed is a
 * `static-vs-truth-drift` (the evidence names the exact runtime paths that classified there).
 * `evaluated` is false when the trace cache is absent/empty (NOT-EVALUATED — never conflated with
 * "0 drift", hard rule 3b).
 */
export function checkStaticVsTruth(root: string): StaticVsTruthReport {
  const cache = loadTraceCache(root);
  if (cache.size === 0) {
    return { evaluated: false, cacheCount: 0, coveredCount: 0, uncoveredCount: listSuiteFiles(root).length, drifts: [] };
  }
  const suite = new Set(listSuiteFiles(root));
  const drifts: StaticVsTruthDrift[] = [];
  let covered = 0;
  let uncovered = 0;
  for (const [rel, entry] of cache) {
    if (!suite.has(rel)) continue; // a stale cache entry for a now-removed test is not judged
    const staticSet = bucketSetOf(rel, root);
    const dynamicSet = bucketsFromPaths([...entry.reads, ...entry.writes]);
    covered += 1;
    const missing = missingDynamicBuckets(staticSet, dynamicSet);
    if (staticSet.size > 0 && missing.size > 0) {
      const evidence = [...entry.reads, ...entry.writes].filter((p) => {
        const b = bucketsFromPaths([p]);
        return b.size > 0 && missing.has([...b][0] as Bucket);
      });
      drifts.push({
        file: rel,
        staticBuckets: [...staticSet].sort(),
        dynamicBuckets: [...dynamicSet].sort(),
        evidence,
      });
    }
  }
  uncovered = suite.size - covered;
  return { evaluated: true, cacheCount: cache.size, coveredCount: covered, uncoveredCount: uncovered, drifts };
}

export interface TruthSelectionDrift {
  file: string;
  touched: string[];
}

export interface TruthSelectionReport {
  evaluated: boolean;
  selectedCount: number;
  drifts: TruthSelectionDrift[];
}

/**
 * The truth-selection comparison: a cached test whose dynamic truth includes a touched file but which
 * the bucket selection (selectBucketsForTouches) did NOT select ⇒ the static selection missed a test
 * that dynamically covers the change. Only literal touched file paths are matched (a glob entry has
 * no single runtime path to intersect). `evaluated` is false with no trace cache.
 */
export function checkTruthSelection(root: string, touchedPaths: readonly string[]): TruthSelectionReport {
  const cache = loadTraceCache(root);
  if (cache.size === 0) {
    return { evaluated: false, selectedCount: 0, drifts: [] };
  }
  const literals = new Set((touchedPaths ?? []).map((t) => String(t).replace(/\\/g, "/").replace(/^\.\//, "").trim()).filter((t) => t && !/[?*]/.test(t)));
  if (literals.size === 0) {
    return { evaluated: false, selectedCount: 0, drifts: [] };
  }
  const selected = new Set(selectBucketsForTouches([...literals], root).selectedFiles);
  const drifts: TruthSelectionDrift[] = [];
  for (const [rel, entry] of cache) {
    if (selected.has(rel)) continue;
    const truth = new Set([...entry.reads, ...entry.writes]);
    const hit = [...literals].filter((t) => truth.has(t));
    if (hit.length > 0) drifts.push({ file: rel, touched: hit });
  }
  return { evaluated: true, selectedCount: selected.size, drifts };
}

const usage = `suite-bucket-drift-check.ts — static-vs-dynamic-truth drift detector (gap-suite-bucket-dynamic-truth-drift-detector)

Usage:
  node --experimental-strip-types suite-bucket-drift-check.ts --gate [--root <dir>] [--json]
      gate mode — exit 1 iff any static-vs-truth drift is RED.
  node --experimental-strip-types suite-bucket-drift-check.ts --touches <csv> [--root <dir>] [--json]
  node --experimental-strip-types suite-bucket-drift-check.ts --task <id> [--root <dir>] [--json]
      gate + truth-selection (needs the change context).
  node --experimental-strip-types suite-bucket-drift-check.ts --scan [--root <dir>] [--json]
      measure mode — print every comparison, exit 0 always.`;

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  // --help is the shared checker contract (gap-help-contract-incompatible-behaviors): usage FIRST,
  // exit 0, NO side effect — evaluated BEFORE root resolution, never as a usage error (exit 2).
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const root = path.resolve(getArgValue(args, "--root") ?? findRepoRoot());
  const asJson = args.includes("--json");
  const gate = args.includes("--gate") || args.includes("--touches") || args.includes("--task");
  const scan = args.includes("--scan");

  if (!gate && !scan) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }

  const staticReport = checkStaticVsTruth(root);
  let truthReport: TruthSelectionReport | null = null;
  if (args.includes("--touches")) {
    truthReport = checkTruthSelection(root, (getArgValue(args, "--touches") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  } else if (args.includes("--task")) {
    const id = getArgValue(args, "--task") ?? "";
    truthReport = checkTruthSelection(root, taskTouchEntries(id, root));
  }

  if (asJson) {
    console.log(JSON.stringify({ staticVsTruth: staticReport, truthSelection: truthReport }, null, 2));
  } else {
    if (!staticReport.evaluated) {
      console.log("suite-bucket-drift-check: NOT-EVALUATED — no trace cache (.quay/suite-fs-trace.jsonl); run `suite-fs-trace.ts --update` to produce the dynamic truth (never conflated with '0 drift')");
    } else if (staticReport.drifts.length === 0) {
      console.log(`PASS — static-vs-truth: 0 drift over ${staticReport.coveredCount} covered test(s) (${staticReport.uncoveredCount} uncovered — no cache entry)`);
    } else {
      console.log(`FAIL — ${staticReport.drifts.length} static-vs-truth drift(s):`);
      for (const d of staticReport.drifts) {
        console.log(`  - ${d.file}: static=${canonicalBuckets(new Set(d.staticBuckets))} but dynamic truth reaches ${canonicalBuckets(new Set(d.dynamicBuckets))} via: ${d.evidence.join(", ")}`);
      }
    }
    if (truthReport) {
      if (!truthReport.evaluated) {
        console.log("suite-bucket-drift-check: truth-selection NOT-EVALUATED (no trace cache / no literal touched file)");
      } else if (truthReport.drifts.length === 0) {
        console.log(`PASS — truth-selection: 0 drift (every dynamic-truth-covering test is in the ${truthReport.selectedCount}-file selection)`);
      } else {
        console.log(`FAIL — ${truthReport.drifts.length} truth-selection drift(s):`);
        for (const d of truthReport.drifts) {
          console.log(`  - ${d.file}: dynamic truth covers ${d.touched.join(", ")} but the bucket selection did NOT select it`);
        }
      }
    }
  }

  const red = staticReport.drifts.length + (truthReport?.drifts.length ?? 0);
  if (scan) return 0;
  return red > 0 ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "suite-bucket-drift-check")) {
  process.exitCode = main(process.argv);
}
