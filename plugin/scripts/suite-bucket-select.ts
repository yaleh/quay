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
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import {
  classifyPath,
  canonicalBuckets,
  bucketSetOf,
  extractRelativeSpecifiers,
  resolveRelative,
  type Bucket,
} from "./suite-bucket-attribution.ts";
import { hubDecision, taskTouchEntries } from "./suite-bucket-hub-list.ts";

// The reattribution record (AC121): file (repo-relative) → judgment ("S" | "M").
const REATTRIBUTION_PATH = ".quay/suite-bucket-reattribution.jsonl";

// The effective bucket-attribution artifact (gap-bucket-second-truth-source-page-recompute): one JSON
// line per suite test file — {file, buckets, source} — written by the DISPATCH side (this module) as the
// SINGLE truth source for file→bucket membership (reattribution override → static closure → mirror fold,
// with the winning path recorded as `source`). The web page (packages/quay/src/serve-tests.ts) READS this
// artifact instead of re-deriving the judgment (Core cannot import plugin/). Recomputed on every bucket
// dispatch; a runtime derived product (gitignored, never committed).
const EFFECTIVE_PATH = ".quay/suite-bucket-effective.jsonl";

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

/** Which path produced a file's effective bucket set (the artifact's provenance field). */
export type BucketSource = "reattr" | "static" | "mirror-fold" | "unresolved";

/** The effective bucket attribution of one test file, with the winning path recorded. */
export interface EffectiveAttribution {
  buckets: Set<Bucket>;
  source: BucketSource;
}

/** Normalize a path to repo-relative (forward slashes, strip `./`, collapse `..`). */
function normalizeTouched(p: string): string {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/** A suite test-file suffix (`.test.mjs` / `.test.ts` — the shallow-glob universe test.sh runs). */
const TEST_FILE_SUFFIXES = [".test.mjs", ".test.ts"] as const;

/** True when a normalized repo-relative path is a suite test file (by suffix). */
function isTestFile(p: string): boolean {
  return TEST_FILE_SUFFIXES.some((s) => p.endsWith(s));
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
 * The effective bucket attribution of one test file: the AC121 reattribution judgment (a singleton
 * S|M|P — the manual override) when present, else the AC120 bucketSetOf (a static-reference-closure
 * set), else the experiments mirror fold for the UNRESOLVED fallback. Records which path won as
 * `source` (reattr | static | mirror-fold | unresolved) — the provenance the artifact carries for the
 * page and for the next task's 「经哪条路径进入本轮」 reading. An empty set with source "unresolved"
 * means the subject cannot be statically located (the caller must NOT default it to a bucket).
 * @param {string} fileRel — repo-relative test file path.
 * @param {Map<string, string>} reattr
 * @param {string} root
 * @returns {EffectiveAttribution}
 */
export function effectiveBucketAttribution(fileRel: string, reattr: Map<string, string>, root: string): EffectiveAttribution {
  const j = reattr.get(fileRel);
  if (j === "S" || j === "M" || j === "P") return { buckets: new Set<Bucket>([j as Bucket]), source: "reattr" };
  const raw = bucketSetOf(fileRel, root);
  if (raw.size > 0) return { buckets: raw, source: "static" };
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
  return { buckets: out, source: out.size > 0 ? "mirror-fold" : "unresolved" };
}

/**
 * The effective bucket set of one test file (the buckets half of `effectiveBucketAttribution`).
 * @param {string} fileRel — repo-relative test file path.
 * @param {Map<string, string>} reattr
 * @param {string} root
 * @returns {Set<Bucket>}
 */
export function effectiveBucketSet(fileRel: string, reattr: Map<string, string>, root: string): Set<Bucket> {
  return effectiveBucketAttribution(fileRel, reattr, root).buckets;
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

/** Canonical P,S,M order for the artifact's buckets array (same order as attribution's BUCKET_ORDER). */
const BUCKET_ARTIFACT_ORDER: readonly Bucket[] = ["P", "S", "M"];

/**
 * Compute the effective attribution for EVERY suite test file (the full file→{buckets, source} map).
 * This is the single truth source the page reads — computed once, persisted by writeBucketAttribution,
 * and reused by the selection loop (no double enumeration).
 * @param {readonly string[]} files — repo-relative suite files (listSuiteFiles).
 * @param {Map<string, string>} reattr
 * @param {string} root
 * @returns {Map<string, EffectiveAttribution>}
 */
export function computeEffectiveAttribution(files: readonly string[], reattr: Map<string, string>, root: string): Map<string, EffectiveAttribution> {
  const map = new Map<string, EffectiveAttribution>();
  for (const f of files) map.set(f, effectiveBucketAttribution(f, reattr, root));
  return map;
}

/**
 * Persist the effective attribution map to `.quay/suite-bucket-effective.jsonl` — one JSON line per
 * file: {file, buckets:[…in P,S,M order], source}. Best-effort: a write failure (read-only FS, missing
 * .quay) must NOT fail the selection (the artifact is a cache the page degrades without).
 * @param {string} root
 * @param {Map<string, EffectiveAttribution>} attribution
 */
export function writeBucketAttribution(root: string, attribution: Map<string, EffectiveAttribution>): void {
  const lines: string[] = [];
  for (const [file, { buckets, source }] of attribution) {
    const ordered = BUCKET_ARTIFACT_ORDER.filter((b) => buckets.has(b));
    lines.push(JSON.stringify({ file, buckets: ordered, source }));
  }
  try {
    fs.writeFileSync(path.join(root, EFFECTIVE_PATH), lines.join("\n") + "\n", "utf8");
  } catch {
    // best-effort cache — never throw (the dispatch must proceed even if the artifact can't be written)
  }
}

/**
 * Select the test subset for a change. The single entry point: hub ⇒ full; else triggered-bucket ∩
 * test-bucket-set, with UNRESOLVED always selected (safe side) and no-bucket ⇒ full (fail-closed).
 * @param {readonly string[]} touchedPaths — repo-relative touched paths (or [] for a task with none).
 * @param {string} [root]
 * @returns {BucketSelection}
 */
export function selectBucketsForTouches(touchedPaths: readonly string[], root = repoRoot()): BucketSelection {
  const files = listSuiteFiles(root);
  const reattr = loadReattribution(root);
  const hub = hubDecision(touchedPaths ?? []);
  const triggered = triggeredBuckets(touchedPaths ?? []);

  // Single truth source (gap-bucket-second-truth-source-page-recompute): compute + persist the
  // effective attribution for EVERY suite file, then reuse it in the selection loop. The page reads
  // this artifact; the write is best-effort (never fails the dispatch).
  const attribution = computeEffectiveAttribution(files, reattr, root);
  writeBucketAttribution(root, attribution);

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

  const selected = new Set<string>();
  for (const f of files) {
    const eff = attribution.get(f)?.buckets ?? new Set<Bucket>();
    if (eff.size === 0) {
      // UNRESOLVED — cannot be proven safe to skip (AC123 安全侧不做减法): always selected.
      selected.add(f);
      continue;
    }
    for (const b of eff) {
      if (triggered.has(b)) {
        selected.add(f);
        break;
      }
    }
  }

  // gap-suite-bucket-touches-inclusive-floor: the task's `## Touches` is the DIRECT declaration of
  // "what this task changed" — a changed TEST file must be run regardless of where the attribution
  // (a static proxy with blind spots) placed it. Union the Touches-listed test files into the
  // selection (restricted to the suite universe so we never emit a phantom path; non-test Touches
  // entries — sources/scripts/self — are NOT unioned: the selected set is a TEST-file set).
  const suiteFiles = new Set(files);
  for (const raw of touchedPaths ?? []) {
    const p = normalizeTouched(raw);
    if (isTestFile(p) && suiteFiles.has(p)) selected.add(p);
  }

  return {
    fullSuite: false,
    buckets: canonicalBuckets(triggered),
    selectedFiles: [...selected].sort(),
    fileCount: selected.size,
    hubMatches: hub.hubMatches,
    triggered: [...triggered].sort(),
  };
}

/** Select for one task's `## Touches` (reads tasks/<id>.md; [] when absent). */
export function selectBucketsForTask(taskId: string, root = repoRoot()): BucketSelection {
  return selectBucketsForTouches(taskTouchEntries(taskId, root), root);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

const usage = `suite-bucket-select.ts — bucket-level test selection (gap-ac124)

Usage:
  node --experimental-strip-types suite-bucket-select.ts --task <task-id> [--root <dir>] [--json|--paths-only|--summary]
  node --experimental-strip-types suite-bucket-select.ts <path>... [--root <dir>] [--json|--paths-only|--summary]
  node --experimental-strip-types suite-bucket-select.ts --write-effective [--root <dir>]

Output modes:
  (default)      human-readable summary
  --json         { fullSuite, buckets, selectedFiles, fileCount, hubMatches, triggered }
  --paths-only   the selected test files, one per line (the FULL list when fullSuite)
  --summary      one machine line: full=0|1 buckets=<csv> files=<n>
  --write-effective  write .quay/suite-bucket-effective.jsonl (the single-truth-source artifact the
                     page reads) and exit — the standalone bootstrap for the dispatch-side write`;

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const rootArg = getArgValue(args, "--root");
  const root = path.resolve(rootArg ?? repoRoot());
  const taskId = getArgValue(args, "--task");
  const asJson = args.includes("--json");
  const pathsOnly = args.includes("--paths-only");
  const summary = args.includes("--summary");
  const writeEffective = args.includes("--write-effective");

  const positional = args.filter((a) => !a.startsWith("--") && !["--root", "--task"].includes(a));

  if (writeEffective) {
    const files = listSuiteFiles(root);
    const reattr = loadReattribution(root);
    const attribution = computeEffectiveAttribution(files, reattr, root);
    writeBucketAttribution(root, attribution);
    process.stdout.write(`wrote ${attribution.size} effective bucket attributions to ${path.join(root, EFFECTIVE_PATH)}\n`);
    return 0;
  }

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
