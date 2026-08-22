// suite-bucket-hub-list.ts — gap-ac122-suite-bucket-hub-list-full-suite: the EXPLICIT hub-file list
// for the "suite 三桶划分" phase (orchestration/manager-phase-goal.md AC122).
//
// A HUB file is a file whose change fans out to (nearly) the whole suite. A change that touches ANY
// hub file must fall back to the FULL suite UNCONDITIONALLY — never a precise fan-out calculation
// (⛔ the AC122 judgment: "无条件全量，⛔ 不试图精算扇出"). This module answers ONLY the hub question:
// which files are hubs, and "does this change touch a hub?". The bucket fan-out execution that
// consumes this answer is a LATER concern (AC124 enables it) — this module deliberately never computes
// a bucket subset.
//
// The list is EXPLICIT (a data array), not a heuristic (the AC122 "非启发式" judgment; hard rule 3b —
// an unreadable/degenerate list must not look like a qualified one). Members are anchored to the
// phase-goal's "至少含" (at-least) list:
//
//   scripts/test.sh                              — the suite entry; 220+ tests invoke it as a shell.
//   plugin/scripts/full-suite-runner.ts          — the suite orchestrator; the most-declared hub (50+).
//   plugin/scripts/runner-grouping*              — the --group / __GROUP__ grouping mechanism (glob).
//   plugin/scripts/select-tests-for-touches.ts   — the file-level scoped selector.
//
// `runner-grouping*` is a GLOB (not a concrete path): the grouping mechanism (group_of / select_files /
// list_groups / ...) was extracted from scripts/test.sh to plugin/scripts/runner-grouping.ts
// (gap-suite-hub-file-responsibility-strip) — the glob now matches a real file, and the grouping stays
// a hub (it decides WHICH tests run, so its change still forces the full suite).
//
// NON-hubs (deliberately NOT listed, gap-suite-hub-file-responsibility-strip AC4): the accounting
// family extracted to plugin/scripts/suite-accounting.ts and the overhead-timing family extracted to
// plugin/scripts/overhead-instrument.sh are PURE TELEMETRY — changing them never flips pass/fail — so a
// change touching either takes the bucket path (suite-bucket-select.ts), never the full suite. Do NOT
// add them here: that would re-couple pure telemetry to the full-suite blast radius.
//
// Run:
//   node --experimental-strip-types suite-bucket-hub-list.ts --task <task-id>   # replay a task's Touches
//   node --experimental-strip-types suite-bucket-hub-list.ts <path>...          # check raw paths
// Output: `full` (unconditional full suite) or `bucket` (proceed to fan-out — a later concern).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import { extractTouchesSection, parseTouchEntries } from "./touches-parser.ts";

/**
 * Find the workspace root by walking up from `startDir` (`.quay/config.yml` marker), with a git
 * top-level fallback — the same convention as `suite-bucket-attribution.ts` / `select-tests-for-touches.ts`.
 * @param {string} [startDir]
 * @returns {string}
 */
export function findRepoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

/** The explicit hub-file list (data, not a heuristic). `*` is the only glob metacharacter. */
export const HUB_FILES: readonly string[] = [
  "scripts/test.sh",
  "plugin/scripts/full-suite-runner.ts",
  "plugin/scripts/runner-grouping*",
  "plugin/scripts/select-tests-for-touches.ts",
];

/**
 * Compile one hub entry (exact path, or a `*` glob) to an anchored RegExp. `*` → `.*`; every other
 * character is regex-escaped so a path cannot spoof a pattern via metacharacters.
 * @param {string} entry
 * @returns {RegExp}
 */
export function hubEntryToRegExp(entry: string): RegExp {
  const escaped = String(entry)
    .split("*")
    .map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

// Pre-compiled once (the list is small and static).
const HUB_PATTERNS: readonly RegExp[] = HUB_FILES.map(hubEntryToRegExp);

/** Normalize a touched-path string to repo-relative (forward slashes, no leading `./`, trimmed). */
function normalizeTouched(p: string): string {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/** True when a repo-relative path IS a hub file (exact or `*` glob match). */
export function isHubFile(relPath: string): boolean {
  const p = normalizeTouched(relPath);
  if (!p) return false;
  return HUB_PATTERNS.some((re) => re.test(p));
}

export interface HubDecision {
  /** true = run the FULL suite unconditionally (no precise fan-out). */
  fullSuite: boolean;
  /** which of the touched paths are hubs (the reason for the fallback). */
  hubMatches: string[];
}

/**
 * Decide whether a change (the set of touched paths) must run the FULL suite.
 *
 * Touching ANY hub file ⇒ `fullSuite: true`, and NO precise fan-out is attempted — the fan-out
 * calculation is a later concern (AC124). This is the AC2 "无条件全量" judgment; the returned
 * `hubMatches` is the reason, never a computed test subset.
 *
 * @param {readonly string[]} touchedPaths — repo-relative touched file paths.
 * @returns {HubDecision}
 */
export function hubDecision(touchedPaths: readonly string[]): HubDecision {
  const hubMatches = (touchedPaths ?? []).filter(isHubFile);
  return { fullSuite: hubMatches.length > 0, hubMatches };
}

/** Convenience predicate: does this change touch a hub file (⇒ full suite)? */
export function touchesHub(touchedPaths: readonly string[]): boolean {
  return hubDecision(touchedPaths).fullSuite;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

const usage = `suite-bucket-hub-list.ts — explicit hub-file list + full-suite fallback (gap-ac122)

Usage:
  node --experimental-strip-types suite-bucket-hub-list.ts --task <task-id> [--root <dir>] [--json]
  node --experimental-strip-types suite-bucket-hub-list.ts <path>... [--json]

Output: full (unconditional full suite) | bucket (proceed to fan-out — a later concern)`;

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

/** Read one task's parsed ## Touches entries. Returns [] when the file/section is absent. */
export function taskTouchEntries(taskId: string, root: string): string[] {
  const file = path.join(root, "tasks", `${taskId}.md`);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  return parseTouchEntries(extractTouchesSection(text).section);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const asJson = args.includes("--json");
  const rootArg = getArgValue(args, "--root");
  const root = path.resolve(rootArg ?? findRepoRoot());
  const positional = args.filter((a) => !a.startsWith("--") && !["--root", "--task", "--json"].includes(a));

  let touched: string[] = [];
  let label = "paths";
  const taskId = getArgValue(args, "--task");
  if (taskId) {
    touched = taskTouchEntries(taskId, root);
    label = `task ${taskId}`;
    if (touched.length === 0) {
      process.stderr.write(`suite-bucket-hub-list: no ## Touches for task ${taskId} (or file absent)\n`);
      return 2;
    }
  } else if (positional.length === 0) {
    process.stderr.write(`${usage}\n`);
    return 2;
  } else {
    touched = positional.map(normalizeTouched).filter(Boolean);
  }

  const d = hubDecision(touched);
  if (asJson) {
    process.stdout.write(JSON.stringify({ input: label, fullSuite: d.fullSuite, hubMatches: d.hubMatches }, null, 2) + "\n");
  } else {
    process.stdout.write(`${d.fullSuite ? "full" : "bucket"}\n`);
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "suite-bucket-hub-list")) {
  process.exitCode = main(process.argv);
}
