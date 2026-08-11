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
// UNIFIED FORK SOURCE (gap-task-file-develop-integration-drift-fan-in-conflicts, AC2): the
// task-file-drift ruling says the task worktree fork source is the EFFECTIVE LINE — the
// integration ref (`--integration`), matching the fan-in target — NOT the develop-vs-integration
// dependency decision. `--force-integration` makes the CLI output the integration ref
// unconditionally (reason: "fork 源统一 = integration HEAD"). The dependency decision remains the
// DEFAULT (backward compatible for single-line downstreams and the branch-model tests); the
// tick docs pass `--force-integration` so quay's own dispatch forks every task worktree from
// integration HEAD, eliminating the "fork 落后 integration" drift that made task-file evidence
// segments rebase-conflict. Contract invariant: fork_source_integration = 1.
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
       [--force-integration]

  --task                candidate task file (required)
  --root                repo root (default: auto-detected from the task file)
  --develop             develop ref (default: develop) — independent line's fork baseline
  --integration         integration ref (default: integration) — dependency line's fork baseline
  --unverified          explicit comma-separated unverified task ids on integration (testability override)
  --force-integration   UNIFIED FORK SOURCE (gap-task-file-develop-integration-drift-fan-in-conflicts
                        AC2): output the integration ref unconditionally — the task worktree always
                        forks from integration HEAD (the effective line, matching the fan-in target),
                        eliminating the "fork 落后 integration" task-file drift.

stdout: one line — the CONFIGURED fork baseline (the --develop ref for independent, the --integration
ref for dependency; both default develop/integration). With --force-integration, always the
--integration ref. Exit 0 on success.
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
  const forceIntegration = args.includes("--force-integration");

  if (!taskFile) {
    usage();
    return 2;
  }
  if (!fs.existsSync(taskFile)) {
    process.stderr.write(`fork-baseline: task file not found: ${taskFile}\n`);
    return 2;
  }

  // UNIFIED FORK SOURCE (AC2, gap-task-file-develop-integration-drift-fan-in-conflicts): the
  // task-file-drift ruling — every task worktree forks from integration HEAD (the effective line,
  // matching the fan-in target). No dependency decision; no unverified-overlap scan needed.
  if (forceIntegration) {
    process.stdout.write(`${integrationRef}\n`);
    process.stderr.write(`fork-baseline: fork 源统一 = integration HEAD (${integrationRef}) — task worktree always forks from the fan-in target\n`);
    return 0;
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

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
