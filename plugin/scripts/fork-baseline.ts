// fork-baseline.ts — determine a task's FORK BASELINE under the two-line branch model
// (gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point, AC2).
//
// The branching model splits master's two colliding roles — "fork baseline" and "merge point" —
// onto two lines:
//   develop     = VERIFIED baseline (only work that passed the outer verification-round)
//   integration = PENDING-VERIFICATION merge point (task branches land here; the red-window
//                 can keep receiving merges; the outer verification-round batch-merges
//                 integration→develop as a fast-forward)
// master's release role is EMPTY (quay has no release flow; ruling ① — add master when a real
// release authorization exists, only then is its semantics real).
//
// AC2: "分叉基线即依赖声明" — a task's fork baseline IS its dependency declaration, with NO new
// dependency field. The mechanical rule:
//   * touches DISJOINT from every unverified task on integration  ⇒ INDEPENDENT  ⇒ fork from develop
//   * touches OVERLAP an unverified task on integration          ⇒ declared dependency ⇒ fork from integration
// (reusing the single-source checkTouchesPair — the same conservative gate that serializes
// overlapping tasks; the constraint "baseline staleness only matters for touch-intersecting tasks"
// is exactly why the two rules are the same constraint, SPEC §3.)
//
// Unverified tasks on integration = task branches merged into integration but NOT yet batch-merged
// to develop. The CLI derives them from `git log --format=%s <develop>..<integration>` (merge
// commit subjects `Merge branch 'task/<id>'`); `--unverified` overrides for testability.
//
// Invariant (Contract): fork_baseline_is_dependency = 1 — the decision is mechanical, never a
// judgment call.
//
// RETIRED UNIFIED FORK SOURCE (gap-worktree-fork-baseline-always-integration): the previous
// `--force-integration` mode (gap-task-file-develop-integration-drift-fan-in-conflicts, AC2) made
// the CLI output the integration ref unconditionally — quay's own dispatch forked every task
// worktree from integration HEAD to match the fan-in target. Under the per-task-suite-verification
// model (human directive ② + orchestration/SPEC-per-task-suite-verification-2026-08-13.md §14/§15.4)
// the worktree fork baseline is develop again: 建立基线 = `$FORK_BASELINE`, dependencies are
// serialized by the dispatch gate (A15② PARENT-DONE-IFF-CHILDREN — B waits for A to land on
// develop, so B forks develop already containing A), and task-file drift is absorbed by the A6
// rebase-rerun loop (先 rebase 再 merge, 重跑套件 — 人 2026-08-13 裁定④ bought the rerun cost).
// The dependency-decision default below is retained for single-line downstreams and the
// branch-model tests; quay's own dispatch no longer passes --force-integration.
//
// REF-AWARE OUTPUT (gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model,
// AC6): the decision LABEL is "develop" (independent line) vs "integration" (dependency line), but
// the CLI maps the label onto the CONFIGURED ref names before writing stdout. With the defaults
// (--develop develop --integration integration) the output is unchanged; a single-line downstream
// that passes `--develop master --integration master` gets `master` (never the literal "develop"),
// so the shared tick doc's configurable fork-baseline stays safe for projects that only have master.
//
// Usage:
//   node --experimental-strip-types fork-baseline.ts --task <tasks/<id>.md>
//        [--root <repo>] [--develop <ref>] [--integration <ref>] [--unverified <id1,id2,...>]
//   stdout: one line — the configured fork baseline (`--develop` ref for independent, `--integration`
//   ref for dependency; default `develop` / `integration`). Exit 0 on success.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import { parseTouches, checkTouchesPair } from "./touches-orthogonality-check.ts";
import { expandDeclaredTouches } from "./concurrent-batch-scheduler.ts";

// ── Pure decision (unit-tested) ──────────────────────────────────────────────────────────────────────

/**
 * Decide the fork baseline for a candidate task against the unverified tasks on integration.
 *
 * @param {{hasSection: boolean, globs: string[]}} candidate — `parseTouches(candidateBody)`
 * @param {Array<{hasSection: boolean, globs: string[]}>} unverified — parsed touches of every task
 *        merged into integration but not yet batch-merged to develop.
 * @param {(globs: string[]) => Set<string>} expand — declared-path expander (injected for testability;
 *        production passes `(globs) => expandDeclaredTouches(globs, root)`).
 * @returns {{ baseline: "develop" | "integration", reason: string, overlaps?: string[] }}
 *   `develop` only when the candidate is PROVABLY disjoint from every unverified task (same
 *   conservative fail-closed shape as checkTouchesPair: an empty/ill-declared side ⇒ overlap ⇒
 *   integration, because we cannot prove independence).
 */
export function decideForkBaseline(candidate, unverified, expand) {
  // A candidate with no `## Touches` cannot be proven independent — conservative: integration.
  if (!candidate.hasSection || candidate.globs.length === 0) {
    return { baseline: "integration", reason: "candidate declares no/empty ## Touches — cannot prove independence" };
  }
  for (const uv of unverified) {
    const r = checkTouchesPair(candidate, uv, expand);
    if (!r.disjoint) {
      return {
        baseline: "integration",
        reason: `touches overlap an unverified task on integration: ${r.reason}`,
        overlaps: r.overlaps.length ? r.overlaps : undefined,
      };
    }
  }
  return { baseline: "develop", reason: "touches disjoint from every unverified task on integration" };
}

// ── Git derivation of the unverified set ────────────────────────────────────────────────────────────

// A merge commit subject produced by `git merge --no-ff task/<id>` / `git merge task/<id>`.
const MERGE_SUBJECT_RE = /Merge (?:branch |remote-tracking branch )?['"]?task\/([A-Za-z0-9][A-Za-z0-9._-]*)/;

/**
 * Derive the unverified task ids on integration from git: merge commit subjects in
 * `develop..integration` that name a `task/<id>` branch.
 * @param {string} root
 * @param {string} develop
 * @param {string} integration
 * @returns {string[]} task ids, de-duplicated, in git-log order.
 */
export function deriveUnverifiedTaskIds(root, develop, integration) {
  const out = [];
  const seen = new Set();
  let log;
  try {
    log = execFileSync("git", ["-C", root, "log", "--format=%s", `${develop}..${integration}`], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // develop..integration is empty or refs missing — no unverified tasks.
    return out;
  }
  for (const line of log.split("\n")) {
    const m = MERGE_SUBJECT_RE.exec(line);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function usage() {
  process.stderr.write(`fork-baseline.ts — decide a task's fork baseline (develop | integration)

Usage:
  node --experimental-strip-types fork-baseline.ts --task <tasks/<id>.md>
       [--root <repo>] [--develop <ref>] [--integration <ref>] [--unverified <id1,id2,...>]

  --task                candidate task file (required)
  --root                repo root (default: auto-detected from the task file)
  --develop             develop ref (default: develop) — independent line's fork baseline
  --integration         integration ref (default: integration) — dependency line's fork baseline
  --unverified          explicit comma-separated unverified task ids on integration (testability override)

stdout: one line — the CONFIGURED fork baseline (the --develop ref for independent, the --integration
ref for dependency; both default develop/integration). Exit 0 on success.

NOTE (gap-worktree-fork-baseline-always-integration): --force-integration is RETIRED (exit 2). Under
the per-task-suite-verification model quay's own dispatch forks every task worktree from $FORK_BASELINE
(develop); dependencies are serialized by the dispatch gate (A15②) and task-file drift is absorbed by
the A6 rebase-rerun loop. The dependency-decision default below remains for single-line downstreams
and the branch-model tests.
`);
}

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

/**
 * CLI main. @param {string[]} argv — process.argv @returns {number} exit code
 */
export function main(argv) {
  const args = argv.slice(2);
  const taskFile = getArgValue(args, "--task");
  const rootArg = getArgValue(args, "--root");
  const developRef = getArgValue(args, "--develop") ?? "develop";
  const integrationRef = getArgValue(args, "--integration") ?? "integration";
  const unverifiedCsv = getArgValue(args, "--unverified");

  // RETIRED flag (gap-worktree-fork-baseline-always-integration): fail loud rather than silently
  // ignore a stale call site that still passes --force-integration.
  if (args.includes("--force-integration")) {
    process.stderr.write(
      "fork-baseline: --force-integration is RETIRED (gap-worktree-fork-baseline-always-integration). " +
      "quay's dispatch now forks from --develop ($FORK_BASELINE); dependencies are serialized by the " +
      "dispatch gate A15② and task-file drift is absorbed by the A6 rebase-rerun loop.\n",
    );
    return 2;
  }

  if (!taskFile) {
    usage();
    return 2;
  }
  if (!fs.existsSync(taskFile)) {
    process.stderr.write(`fork-baseline: task file not found: ${taskFile}\n`);
    return 2;
  }

  const root = rootArg
    ? path.resolve(rootArg)
    : path.resolve(path.dirname(taskFile), "..");
  const expand = (globs) => expandDeclaredTouches(globs, root);

  const candidateBody = fs.readFileSync(taskFile, "utf8");
  const candidate = parseTouches(candidateBody);

  let unverifiedBodies = [];
  if (unverifiedCsv) {
    for (const id of unverifiedCsv.split(",").map((s) => s.trim()).filter(Boolean)) {
      const f = path.join(root, "tasks", `${id}.md`);
      if (!fs.existsSync(f)) {
        process.stderr.write(`fork-baseline: --unverified task file not found: ${f}\n`);
        return 2;
      }
      unverifiedBodies.push(fs.readFileSync(f, "utf8"));
    }
  } else {
    for (const id of deriveUnverifiedTaskIds(root, developRef, integrationRef)) {
      const f = path.join(root, "tasks", `${id}.md`);
      if (!fs.existsSync(f)) continue;
      unverifiedBodies.push(fs.readFileSync(f, "utf8"));
    }
  }
  const unverified = unverifiedBodies.map(parseTouches);

  const decision = decideForkBaseline(candidate, unverified, expand);
  // Ref-aware output (AC6): map the line label onto the configured ref names. With
  // --develop master --integration master (single-line downstream default), an independent
  // decision ("develop") writes "master", a dependency decision ("integration") writes "master" too.
  const baselineRef = decision.baseline === "integration" ? integrationRef : developRef;
  process.stdout.write(`${baselineRef}\n`);
  process.stderr.write(`fork-baseline: ${decision.reason}\n`);
  if (decision.overlaps?.length) {
    process.stderr.write(`fork-baseline: overlap(s): ${decision.overlaps.join(", ")}\n`);
  }
  process.stderr.write(`fork-baseline: unverified-on-integration count = ${unverified.length}\n`);
  return 0;
}

if (isDirectEntry(import.meta, undefined, "fork-baseline")) {
  process.exitCode = main(process.argv);
}
