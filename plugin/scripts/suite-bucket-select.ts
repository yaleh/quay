// suite-bucket-select.ts — gap-ac124-suite-bucket-production-carrier-benefit: bucket-level test
// SELECTION (the fan-out the phase has been building toward). AC120 attributed each test to a bucket
// set; AC121 re-attributed the 230 "test.sh-as-shell" tests; AC122 gave the hub-file list; AC123
// proved cross-bucket both-sides is inherent. THIS module is the consumer that turns a CHANGE into a
// runnable test subset:
//
//   change (touched paths) ──► full suite   (a hub file is touched — AC122, unconditional, no fan-out)
//                            └► bucket run  (P-only change ⇒ P bucket; M-only ⇒ M bucket; P+M ⇒ both)
//
// SELECTION RULE (the same "triggered-bucket ∩ test-bucket-set" rule AC125 replayed 3/3):
//   triggered buckets  = the buckets the CHANGE's source files live in (P = packages/*/(src|bin|dist),
//                        M = plugin/scripts, S = scripts/test.sh — reuse AC120's classifyPath, plus the
//                        experiments/…/scripts mirror fold).
//   test bucket set    = AC121 reattribution judgment when present (a singleton S|M — the manual
//                        override for the 133 "test.sh-as-shell" tests), else AC120 bucketSetOf.
//   selected           = every test whose bucket set ∩ triggered ≠ ∅ (AC123 both-sides is INHERENT —
//                        a cross-bucket {P,M} test is selected when EITHER bucket is triggered).
//
// SAFE SIDE (AC123 安全侧不做减法): a test whose subject cannot be statically located (AC120
// UNRESOLVED — empty bucket set) can NOT be proven safe to skip, so it is ALWAYS selected in every
// bucket run. A change that triggers NO bucket (e.g. touches only test files / unclassifiable code)
// falls back to the FULL suite (fail-closed — hard rule 3b: an unreadable change must not look like
// "nothing to run").
//
// Run:
//   node --experimental-strip-types suite-bucket-select.ts --task <task-id> [--root <dir>] [--json|--paths-only|--summary]
//   node --experimental-strip-types suite-bucket-select.ts <path>... [--root <dir>] [--json|--paths-only|--summary]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import {
  classifyPath,
  canonicalBuckets,
  bucketSetOf,
  extractRelativeSpecifiers,
  resolveRelative,
  findRepoRoot,
  type Bucket,
} from "./suite-bucket-attribution.ts";
import { hubDecision, taskTouchEntries } from "./suite-bucket-hub-list.ts";

// The reattribution record (AC121): file (repo-relative) → judgment ("S" | "M").
const REATTRIBUTION_PATH = ".quay/suite-bucket-reattribution.jsonl";

// The shallow test-file glob test.sh runs (build_deduped_files in scripts/test.sh) — the SAME
// universe the full suite executes. NOT the recursive indexTestFiles (which also picks up the 3
// nested runner-fixtures/*.test.mjs that test.sh never runs). One `*` per segment is the only glob
// metacharacter supported — the same shape as test.sh's literal glob.
const SUITE_GLOBS: readonly string[] = [
  "packages/*/test/*.test.mjs",
  "plugin/test/*.test.mjs",
  "experiments/quay-perpetual-stream/test/*.test.mjs",
];

/** The experiments→plugin scripts mirror prefix (single-source mirror convention). */
const EXP_SCRIPTS_PREFIX = "experiments/quay-perpetual-stream/scripts/";
const PLUGIN_SCRIPTS_PREFIX = "plugin/scripts/";

export interface BucketSelection {
  /** true ⇒ run the FULL suite unconditionally (hub touched, or the change triggers no bucket). */
  fullSuite: boolean;
  /** "P" | "M" | "P+M" | "full" — which buckets ran (S never stands alone: it is always a hub). */
  buckets: string;
  /** repo-relative test files to run (the FULL list when fullSuite). */
  selectedFiles: string[];
  /** number of test files in the selected set. */
  fileCount: number;
  /** which touched paths are hubs (the reason for a full-suite fallback). */
  hubMatches: string[];
  /** the triggered source buckets (P/M/S) of the change — empty ⇒ no bucket triggerable. */
  triggered: string[];
}

/** Normalize a path to repo-relative (forward slashes, strip `./`, collapse `..`). */
function normalizeTouched(p: string): string {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * Expand one shallow glob (a single `*` per segment) under `root` to existing file paths, then
 * realpath-dedup — the same enumeration contract as scripts/test.sh's build_deduped_files.
 * Returns repo-relative paths.
 * @param {string} root
 * @returns {string[]}
 */
export function listSuiteFiles(root: string): string[] {
  const seen = new Map<string, string>(); // realpath -> repo-relative
  const expand = (glob: string): string[] => {
    const segs = glob.split("/");
    let cur = [root];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const next: string[] = [];
      for (const dir of cur) {
        if (seg.includes("*")) {
          let entries: fs.Dirent[];
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            continue;
          }
          const re = new RegExp(`^${seg.replace(/\*/g, ".*")}$`);
          for (const e of entries) {
            if (re.test(e.name)) next.push(path.join(dir, e.name));
          }
        } else {
          next.push(path.join(dir, seg));
        }
      }
      cur = next;
    }
    return cur.filter((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
  };
  for (const glob of SUITE_GLOBS) {
    for (const abs of expand(glob)) {
      let rp: string;
      try {
        rp = fs.realpathSync(abs);
      } catch {
        rp = abs;
      }
      if (!seen.has(rp)) seen.set(rp, path.relative(root, rp));
    }
  }
  return [...seen.values()].sort();
}

/**
 * Load the AC121 reattribution map (file → judgment). Absent/unreadable ⇒ empty map (the AC120
 * attribution alone still works — a missing override degrades to the raw mechanism, never a crash).
 * @param {string} root
 * @returns {Map<string, string>}
 */
export function loadReattribution(root: string): Map<string, string> {
  const map = new Map<string, string>();
  const file = path.join(root, REATTRIBUTION_PATH);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line) as { file?: string; judgment?: string };
      if (typeof d.file === "string" && typeof d.judgment === "string") map.set(d.file, d.judgment);
    } catch {
      // malformed line — skip (the reattribution is a data file; one bad line must not kill selection)
    }
  }
  return map;
}

/**
 * Fold the experiments→plugin scripts MIRROR prefix to its canonical plugin/scripts form (the
 * single-source mirror convention: `experiments/quay-perpetual-stream/scripts/X` ↔ `plugin/scripts/X`
 * are byte-identical). AC120's classifyPath only knows `plugin/scripts`, so a reference resolved to
 * the experiments mirror path would otherwise classify to nothing.
 * @param {string} rel — repo-relative path.
 * @returns {string}
 */
export function mirrorFold(rel: string): string {
  return rel.startsWith(EXP_SCRIPTS_PREFIX) ? PLUGIN_SCRIPTS_PREFIX + rel.slice(EXP_SCRIPTS_PREFIX.length) : rel;
}

/**
 * The effective bucket set of one test file: the AC121 reattribution judgment (a singleton S|M — the
 * manual override) when present, else the AC120 bucketSetOf (a static-reference-closure set), with the
 * experiments mirror folded for the UNRESOLVED fallback. Returns an empty set for UNRESOLVED (the
 * caller must NOT default it to a bucket).
 * @param {string} fileRel — repo-relative test file path.
 * @param {Map<string, string>} reattr
 * @param {string} root
 * @returns {Set<Bucket>}
 */
export function effectiveBucketSet(fileRel: string, reattr: Map<string, string>, root: string): Set<Bucket> {
  const j = reattr.get(fileRel);
  if (j === "S" || j === "M" || j === "P") return new Set<Bucket>([j as Bucket]);
  const raw = bucketSetOf(fileRel, root);
  if (raw.size > 0) return raw;
  // Mirror fold (UNRESOLVED fallback): AC120's static closure resolves a test's `../scripts/X.ts` to
  // the EXPERIMENTS mirror path, which classifyPath does not recognize — so a test importing the
  // experiments mirror of plugin/scripts would be wrongly UNRESOLVED. Re-resolve the relative
  // specifiers with the mirror folded (a mirror-importing test IS an M test), plus any mirror path
  // LITERAL in the raw text.
  const text = fs.readFileSync(path.join(root, fileRel), "utf8");
  const out = new Set<Bucket>();
  for (const spec of extractRelativeSpecifiers(text)) {
    const b = classifyPath(mirrorFold(resolveRelative(fileRel, spec)));
    if (b) out.add(b);
  }
  for (const m of text.matchAll(/experiments\/quay-perpetual-stream\/scripts\//g)) out.add("M");
  return out;
}

/**
 * The buckets a CHANGE triggers — the buckets its touched SOURCE files live in. Reuse AC120's
 * classifyPath (the single reference-prefix classifier), with the experiments→plugin scripts mirror
 * folded so a mirror-path touch triggers the same bucket as its canonical path.
 * @param {readonly string[]} touchedPaths — repo-relative touched paths.
 * @returns {Set<Bucket>}
 */
export function triggeredBuckets(touchedPaths: readonly string[]): Set<Bucket> {
  const out = new Set<Bucket>();
  for (const raw of touchedPaths ?? []) {
    let p = normalizeTouched(raw);
    if (!p) continue;
    if (p.startsWith(EXP_SCRIPTS_PREFIX)) p = PLUGIN_SCRIPTS_PREFIX + p.slice(EXP_SCRIPTS_PREFIX.length);
    const b = classifyPath(p);
    if (b) out.add(b);
  }
  return out;
}

/**
 * Select the test subset for a change. The single entry point: hub ⇒ full; else triggered-bucket ∩
 * test-bucket-set, with UNRESOLVED always selected (safe side) and no-bucket ⇒ full (fail-closed).
 * @param {readonly string[]} touchedPaths — repo-relative touched paths (or [] for a task with none).
 * @param {string} [root]
 * @returns {BucketSelection}
 */
export function selectBucketsForTouches(touchedPaths: readonly string[], root = findRepoRoot()): BucketSelection {
  const files = listSuiteFiles(root);
  const reattr = loadReattribution(root);
  const hub = hubDecision(touchedPaths ?? []);
  const triggered = triggeredBuckets(touchedPaths ?? []);

  if (hub.fullSuite || triggered.size === 0) {
    return {
      fullSuite: true,
      buckets: "full",
      selectedFiles: files,
      fileCount: files.length,
      hubMatches: hub.hubMatches,
      triggered: [...triggered].sort(),
    };
  }

  const selected: string[] = [];
  for (const f of files) {
    const eff = effectiveBucketSet(f, reattr, root);
    if (eff.size === 0) {
      // UNRESOLVED — cannot be proven safe to skip (AC123 安全侧不做减法): always selected.
      selected.push(f);
      continue;
    }
    for (const b of eff) {
      if (triggered.has(b)) {
        selected.push(f);
        break;
      }
    }
  }

  return {
    fullSuite: false,
    buckets: canonicalBuckets(triggered),
    selectedFiles: selected,
    fileCount: selected.length,
    hubMatches: hub.hubMatches,
    triggered: [...triggered].sort(),
  };
}

/** Select for one task's `## Touches` (reads tasks/<id>.md; [] when absent). */
export function selectBucketsForTask(taskId: string, root = findRepoRoot()): BucketSelection {
  return selectBucketsForTouches(taskTouchEntries(taskId, root), root);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

const usage = `suite-bucket-select.ts — bucket-level test selection (gap-ac124)

Usage:
  node --experimental-strip-types suite-bucket-select.ts --task <task-id> [--root <dir>] [--json|--paths-only|--summary]
  node --experimental-strip-types suite-bucket-select.ts <path>... [--root <dir>] [--json|--paths-only|--summary]

Output modes:
  (default)      human-readable summary
  --json         { fullSuite, buckets, selectedFiles, fileCount, hubMatches, triggered }
  --paths-only   the selected test files, one per line (the FULL list when fullSuite)
  --summary      one machine line: full=0|1 buckets=<csv> files=<n>`;

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const rootArg = getArgValue(args, "--root");
  const root = path.resolve(rootArg ?? findRepoRoot());
  const taskId = getArgValue(args, "--task");
  const asJson = args.includes("--json");
  const pathsOnly = args.includes("--paths-only");
  const summary = args.includes("--summary");

  const positional = args.filter((a) => !a.startsWith("--") && !["--root", "--task"].includes(a));

  let sel: BucketSelection;
  if (taskId) {
    sel = selectBucketsForTask(taskId, root);
  } else if (positional.length === 0) {
    process.stderr.write(`${usage}\n`);
    return 2;
  } else {
    sel = selectBucketsForTouches(positional.map(normalizeTouched).filter(Boolean), root);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(sel, null, 2) + "\n");
  } else if (pathsOnly) {
    for (const f of sel.selectedFiles) process.stdout.write(`${f}\n`);
  } else if (summary) {
    process.stdout.write(`full=${sel.fullSuite ? 1 : 0} buckets=${sel.buckets} files=${sel.fileCount}\n`);
  } else {
    process.stdout.write(
      `buckets=${sel.buckets} full=${sel.fullSuite ? "yes" : "no"} files=${sel.fileCount}` +
        (sel.hubMatches.length > 0 ? ` hub=${sel.hubMatches.join(",")}` : "") +
        (sel.triggered.length > 0 ? ` triggered=${sel.triggered.join("+")}` : "") +
        "\n",
    );
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "suite-bucket-select")) {
  process.exitCode = main(process.argv);
}
