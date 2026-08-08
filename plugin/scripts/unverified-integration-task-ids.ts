// unverified-integration-task-ids.ts — extract the UNVERIFIED task ids pending on integration
// (gap-ac19-two-line-model-actually-runs, AC3 — fix the half-dead `--overlaps-unverified` path).
//
// The two-line model's fork-baseline determination
// (plugin/scripts/integration-branch-model.ts --fork-baseline) has TWO determination paths:
//   * declaredDependency            — prose declaration of a dependency on a prior task
//   * overlapsUnverifiedIntegration — the candidate's `## Touches` intersect an UNVERIFIED task
//     already merged to integration
// The second path is fed by the dispatch caller's `--overlaps-unverified <id,...>` argument. The
// defect (AC3, 2026-08-08 09:3x): the dispatch always passed the EMPTY string, so the overlap path
// could never fire — the mechanism was called but one of its two determination paths was permanently
// dead ("机制半死：被调用但参数使一条路径恒假").
//
// The single source for the unverified set is `git log --oneline develop..integration`
// (integration-branch-model.ts:139 `pendingIntegrationMerges` — the Contract invoke). This script
// runs that command and extracts task ids from the fan-in merge-commit messages:
//   * "merge: fan-in task/gap-<id>...→integration"  → task/gap-<id>  → gap-<id>
//   * "inner fan-in: gap-<id> (...)"                → gap-<id>
//   * "Merge branch 'task/<id>'"                    → task/<id>      → <id>
// Only ids whose `tasks/<id>.md` exists (relative to --root) are emitted. Output is comma-separated
// (empty stdout when there are none) so the dispatch step can pipe it straight into
// `integration-branch-model.ts --fork-baseline --overlaps-unverified "$UNVERIFIED_IDS"` — the inner
// dispatch never has to remember the source; it is mechanical.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/unverified-integration-task-ids.ts [--root <repo>]
//        [--base <ref>] [--tip <ref>] [--help]
//   stdout: comma-separated unverified task ids on <tip> not yet on <base> (empty when none). Exit 0.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Match `task/<id>` in a merge-commit subject (fan-in merges); captures the id. */
const TASK_SLASH_RE = /\btask\/([A-Za-z0-9][A-Za-z0-9._-]*)\b/g;
/** Match a bare `gap-<id>` mention (inner fan-in subjects like "inner fan-in: gap-<id> (...)"). */
const GAP_ID_RE = /\bgap-[A-Za-z0-9][A-Za-z0-9._-]*\b/g;

/**
 * Extract task ids from fan-in merge-commit messages (`task/<id>` and `gap-<id>` patterns),
 * de-duplicated, in first-seen order. Pure — no git, no filesystem.
 */
export function extractTaskIds(messages: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const msg of messages) {
    for (const m of msg.matchAll(TASK_SLASH_RE)) {
      const id = m[1];
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    for (const m of msg.matchAll(GAP_ID_RE)) {
      const id = m[0];
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * The unverified task ids pending on integration: `git log --oneline <base>..<tip>` (the Contract
 * invoke surface — integration-branch-model.ts:139), extracted and filtered to ids whose
 * `tasks/<id>.md` exists under `root`. Empty when the range is empty or the refs are missing.
 */
export function unverifiedIntegrationTaskIds(root: string, base = "develop", tip = "integration"): string[] {
  let log: string;
  try {
    log = execFileSync("git", ["-C", root, "log", "--oneline", `${base}..${tip}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // Refs missing or the range is empty — no unverified tasks.
    return [];
  }
  const messages = log
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return extractTaskIds(messages).filter((id) => fs.existsSync(path.join(root, "tasks", `${id}.md`)));
}

function usage(): string {
  return [
    "usage:",
    "  unverified-integration-task-ids.ts [--root <root>] [--base <ref>] [--tip <ref>]",
    "      prints the comma-separated UNVERIFIED task ids on <tip> (default integration) that are not",
    "      yet on <base> (default develop) — extracted from `git log --oneline <base>..<tip>` fan-in",
    "      merge-commit messages (task/<id> / gap-<id> patterns; deduped; only ids whose tasks/<id>.md",
    "      exists); empty stdout when there are none. Feeds",
    "      `integration-branch-model.ts --fork-baseline --overlaps-unverified \"$UNVERIFIED_IDS\"`.",
    "  --help  show this usage",
  ].join("\n");
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const rootIdx = args.indexOf("--root");
  const root = rootIdx >= 0 && args[rootIdx + 1] ? args[rootIdx + 1] : process.cwd();
  const baseIdx = args.indexOf("--base");
  const base = baseIdx >= 0 && args[baseIdx + 1] ? args[baseIdx + 1] : "develop";
  const tipIdx = args.indexOf("--tip");
  const tip = tipIdx >= 0 && args[tipIdx + 1] ? args[tipIdx + 1] : "integration";
  const ids = unverifiedIntegrationTaskIds(root, base, tip);
  process.stdout.write(`${ids.join(",")}\n`);
  return 0;
}

function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  process.exitCode = main(process.argv);
}
