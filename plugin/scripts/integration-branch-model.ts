// integration-branch-model.ts — the two-line branch model core.
//
// RETIRED (AC48 判据2, 2026-08-13 — tasks/gap-ac48-code-retirement-pool-filter-and-scripts; catalog
// note per AC52): the two-line integration-branch model is retired. The branch itself was deleted and
// config merge_target → develop by the outer (d41feba6/fc39e997); under the new model every task forks
// from develop (`$FORK_BASELINE`, all tasks from develop) — `forkBaseline()` has ZERO production
// callers (confirmed 2026-08-13). This file is KEPT AS THE REASON ARCHIVE (not deleted): it and
// integration-batch-merge.sh + SPEC-branching-model-integration-branch-2026-08-05.md document the
// two-line model's design, its empirical negation, and the reverse-edge ruling. No production path
// should call it; the exported functions remain unit-tested for the archive only.
//
// SPEC-branching-model-integration-branch-2026-08-05 (引用:
// orchestration/SPEC-branching-model-integration-branch-2026-08-05.md): split the "fork baseline"
// from the "merge point". Today a single ref (master) bears BOTH roles, which is WHY the red-window
// must stop dispatch — a task would otherwise fork from an unverified tree. The structural fix is a
// two-line model:
//
//   develop      — the VERIFIED baseline (green). Independent tasks fork from here.
//   integration  — the PENDING-VERIFICATION merge point. Declared-dependency tasks fork from here
//                  (the fork baseline IS the dependency declaration), and ALL task merges land here.
//                  It keeps receiving merges even during the red-window — the stop-dispatch is
//                  structurally eliminated because develop never forks from an unverified tree.
//
// The outer verification-round batch-merges integration → develop; because integration only ever
// grows from develop and only ever merges back into it, the batch merge is always a fast-forward
// (`git merge --ff-only integration`, Contract `integration_ff_merges`). The residual task→integration
// conflict cost is bounded by touch-declaration precision (SPEC §4): two concurrent tasks whose
// declared `## Touches` overlap are exactly the imprecision this model turns from sporadic into
// continuous exposure — forcing the real defect to be fixed.
//
// Pure functions are exported and unit-tested (plugin/test/integration-branch-model.test.mjs, AC7);
// `main()` is a thin CLI the dispatch / verification-round can invoke mechanically.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type ForkBaseline = "develop" | "integration";

export interface ForkBaselineInput {
  /** the task declares a dependency on a prior task (explicit dependency, not mere touch overlap) */
  declaredDependency: boolean;
  /** the task's declared touches overlap an unverified task already merged to integration */
  overlapsUnverifiedIntegration: boolean;
}

/**
 * AC2 — fork baseline IS the dependency declaration (SPEC §6). Independent tasks (default) fork
 * from `develop` (verified, green); a task that declares a dependency on a prior task, OR whose
 * touches overlap an unverified task on integration, forks from `integration` (which carries the
 * unverified prior work). No new dependency field is needed — the mechanical check is the touch
 * intersection against integration's unverified tasks.
 */
export function forkBaseline(input: ForkBaselineInput): ForkBaseline {
  if (input.declaredDependency || input.overlapsUnverifiedIntegration) return "integration";
  return "develop";
}

export interface MergeDecision {
  ok: boolean;
  mode: "fast-forward" | "blocked";
  reason: string;
}

/**
 * AC3 — the integration → develop batch-merge decision. The two-line invariant is that integration
 * is always a DESCENDANT of develop (it only forks from develop and only merges back via
 * fast-forward), i.e. `develop` is an ancestor of `integration`. When that holds, the outer
 * verification-round batch merge is a pure fast-forward with no conflict
 * (`git merge-base --is-ancestor develop integration` exit 0 → `git branch -f develop integration`).
 * If the invariant is broken (the two lines diverged) the merge MUST NOT proceed — report
 * needs-human.
 */
export function decideIntegrationToDevelopMerge(
  developIsAncestorOfIntegration: boolean,
  source = "integration",
  target = "develop",
): MergeDecision {
  if (developIsAncestorOfIntegration) {
    return {
      ok: true,
      mode: "fast-forward",
      reason: `${target} is an ancestor of ${source} (${source} is a descendant) — fast-forward, no conflict`,
    };
  }
  return {
    ok: false,
    mode: "blocked",
    reason: `${source} diverged from ${target} — two-line invariant broken; do NOT auto-merge`,
  };
}

/**
 * AC3 — the task→integration conflict source (SPEC §4): two tasks whose DECLARED touches overlap.
 * Concurrent tasks were pre-screened disjoint by checkTouchesPair, so an overlap here is exactly the
 * touch-declaration imprecision this model turns into continuous exposure. Returns the overlapping
 * files (empty array = disjoint).
 */
export function touchesOverlap(a: string[], b: string[]): string[] {
  const setB = new Set(b.map((x) => String(x).trim()).filter(Boolean));
  return [...new Set(a.map((x) => String(x).trim()).filter(Boolean))].filter((x) => setB.has(x));
}

/**
 * AC2 — parse the `## Touches` list items out of a task body, for the mechanical fork-baseline check
 * (touch intersection against integration's unverified tasks). `(new)` markers are stripped (the file
 * does not need to exist yet to be a declared touch). Stops at the next `## ` heading.
 */
export function declaredTouches(body: string): string[] {
  const out: string[] = [];
  let inTouches = false;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (/^##\s+Touches\s*$/i.test(t)) {
      inTouches = true;
      continue;
    }
    if (inTouches && /^##\s+/.test(t)) {
      inTouches = false;
    }
    if (inTouches) {
      const m = t.match(/^[-*]\s+(.+)$/);
      if (m) out.push(m[1].replace(/\s*\(new\)\s*$/i, "").trim());
    }
  }
  return out.filter(Boolean);
}

// ── git-backed (the Contract's measure / invoke surfaces) ───────────────────────────────────────

/**
 * Contract `measure integration_ff_merges`: exit 0 of `git merge-base --is-ancestor <integration>
 * <develop>` — 0 = integration is an ancestor of develop ⇒ the batch merge is a fast-forward.
 */
export function gitIsAncestor(repoRoot: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["-C", repoRoot, "merge-base", "--is-ancestor", ancestor, descendant], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Contract `invoke`: `git log --oneline develop..integration` — the pending-verification task
 * merges on integration that the next verification-round will batch fast-forward into develop.
 * Non-empty during the red-window is EXPECTED (integration keeps receiving merges while develop is
 * frozen — that is the structural elimination of stop-dispatch).
 */
export function pendingIntegrationMerges(
  repoRoot: string,
  base = "develop",
  tip = "integration",
): string[] {
  const out = execFileSync(
    "git",
    ["-C", repoRoot, "log", "--oneline", `${base}..${tip}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
function usage(): string {
  return [
    "usage:",
    "  integration-branch-model.ts --fork-baseline <taskfile> [--overlaps-unverified <id,...>] [--root <root>]",
    "      prints develop|integration (AC2: fork baseline = dependency declaration)",
    "  integration-branch-model.ts --is-ancestor <ancestor> <descendant> [--root <root>]",
    "      prints ancestor|NOT-ancestor; exit 0|1. ff-safety direction: --is-ancestor develop integration",
    "      (integration a descendant of develop ⇒ batch merge is a fast-forward)",
    "  integration-branch-model.ts --pending [<base> <tip>] [--root <root>]",
    "      prints `git log --oneline <base>..<tip>` (default develop..integration) — Contract invoke",
  ].join("\n");
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  const rootIdx = args.indexOf("--root");
  const root = rootIdx >= 0 && args[rootIdx + 1] ? args[rootIdx + 1] : process.cwd();
  const sub = args[0];

  if (sub === "--fork-baseline") {
    const file = args[1];
    if (!file) {
      process.stderr.write(`${usage()}\n`);
      return 2;
    }
    let body: string;
    try {
      body = fs.readFileSync(file, "utf8");
    } catch (err) {
      process.stderr.write(`cannot read task file ${file}: ${(err as Error).message}\n`);
      return 2;
    }
    // declaredDependency: a dependency declaration in the body (frontmatter depends_on, or a
    // 依赖/前序/先决 claim in the plan/proposal prose).
    const declaredDependency =
      /depends_on|声明依赖|依赖前序|前序任务|先决/i.test(body);
    // overlapsUnverifiedIntegration: touch intersection with the given unverified integration tasks.
    let overlapsUnverifiedIntegration = false;
    const oi = args.indexOf("--overlaps-unverified");
    if (oi >= 0 && args[oi + 1]) {
      const mine = declaredTouches(body);
      overlapsUnverifiedIntegration = args[oi + 1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .some((id) => {
          const p = path.join(root, "tasks", `${id}.md`);
          if (!fs.existsSync(p)) return false;
          return touchesOverlap(mine, declaredTouches(fs.readFileSync(p, "utf8"))).length > 0;
        });
    }
    process.stdout.write(`${forkBaseline({ declaredDependency, overlapsUnverifiedIntegration })}\n`);
    return 0;
  }

  if (sub === "--is-ancestor") {
    const ancestor = args[1];
    const descendant = args[2];
    if (!ancestor || !descendant) {
      process.stderr.write(`${usage()}\n`);
      return 2;
    }
    const ok = gitIsAncestor(root, ancestor, descendant);
    process.stdout.write(`${ok ? "ancestor" : "NOT-ancestor"}\n`);
    return ok ? 0 : 1;
  }

  if (sub === "--pending") {
    const base = args[1] || "develop";
    const tip = args[2] || "integration";
    const merges = pendingIntegrationMerges(root, base, tip);
    if (merges.length === 0) {
      process.stdout.write("(none)\n");
    } else {
      for (const m of merges) process.stdout.write(`${m}\n`);
    }
    return 0;
  }

  process.stderr.write(`${usage()}\n`);
  return 2;
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
