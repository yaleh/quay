// carrier-dirs — where quay-native's four "carrier" stores live: tasks/ and its
// sibling directories adr/ goals/ meta/ docs-managed/.
//
// WHY THIS IS A MODULE, NOT PRIVATE BIN HELPERS (gap-quay-init-omits-adr-goal-meta-dir-env-
// third-party-leak): the resolution used to be five local functions inside bin/quay-native.ts,
// which made them unreachable from a test (the bin calls main() unconditionally at import) — so
// the resolution that decides WHICH WORKSPACE'S adr/goal/meta store you read and write had no
// direct unit test, and a wrong answer was only observable as "the other repo's records showed
// up". The invariant is worth an importable, testable single source of truth.
//
// THE INVARIANT: tasks/ and its siblings share a common parent BY CONSTRUCTION. Core's own MCP
// defaults say so directly (src/mcp-server.ts: `path.join(path.dirname(tasksDir), "adr" | "goals"
// | "meta")`), and `.quay/config.yml`'s env block pins each carrier independently
// (QUAY_NATIVE_{TASKS,ADR,GOAL,META,DOCS}_DIR). So a sibling must be derived from the RESOLVED
// tasks dir — never by re-walking the cwd for a workspace marker.
//
// WHY RE-WALKING THE CWD IS WRONG (the defect this module exists to prevent): the provider MCP
// process is spawned with `cwd = <workspaceRoot>/<provider.path>` (Core: src/mcp-server.ts and
// src/serve.ts both pass `cwd: providerDir`). quay-init's upgrade channel binds provider.path to
// the PLUGIN's vendored runtime (`$PLUGIN_ROOT/vendor/quay-native`), so for any third-party
// project installed that way the process cwd sits INSIDE THE QUAY REPO — and the first
// `.quay/config.yml` found upward belongs to quay itself, not to the target project. Deriving
// siblings from the cwd therefore silently bound every third-party project's adr/goal/meta stores
// to quay's own (measured 2026-09-13 in /home/yale/work/quay-fleet: `goal list` returned quay's
// AC-143…AC-157 and `adr list` quay's ADR-001…ADR-011). tasks/ escaped only because quay-init
// happened to write QUAY_NATIVE_TASKS_DIR explicitly — an asymmetry, not a design.
//
// (Prior, DISTINCT defect worth not re-conflating: gap-quay-init-env-only-tasks-dir-goals-adr-meta-
// land-inside-npm-package covered the branch where findRepoRoot finds NOTHING upward — the carrier
// then landed inside the installed npm package. That fix kept a cwd-relative fallback and added a
// stderr line saying where it landed. This module keeps that property on the same condition.)
//
// RESOLUTION PRIORITY (each carrier): env override → sibling of the RESOLVED tasks dir.
// `resolveTasksDir()` itself keeps its own three-step priority (env → repo root from cwd → cwd),
// unchanged — this module changes only how the SIBLINGS are derived.

import fs from "node:fs";
import path from "node:path";

/** True when `dir` holds the workspace marker (`.quay/config.yml`). */
export function isWorkspaceRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".quay", "config.yml"));
}

/**
 * Walk upward looking for the workspace marker (`.quay/config.yml`) so the default tasks dir
 * resolves to the repo root's `tasks/`, not to whatever directory `quay-native` happened to be
 * invoked from. This fixes the CWD-resolution footgun flagged by the independent audit in
 * iteration 2 and reconfirmed in iteration 3 (experiments/quay-native-bootstrap/audits/
 * iteration-3-independent-adjudicate.md "New bugs found" #1): omitting QUAY_NATIVE_TASKS_DIR while
 * running from packages/quay-native/ silently resolved tasks from packages/quay-native/tasks/ (a
 * near-empty stray directory) instead of the real repo-root tasks/, producing confusing "not
 * found" gate failures.
 *
 * ⛔ Only `resolveTasksDir()` may use this. The sibling carriers must NOT: see the module header.
 */
export function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (isWorkspaceRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** How `resolveTasksDir()` arrived at its answer — the sibling carriers report the fallback case. */
export type TasksDirSource = "env" | "repo-root" | "cwd-fallback";

/**
 * Resolve the tasks dir AND say how: env override → workspace root found upward from cwd →
 * cwd-relative fallback. `source` is what lets a sibling carrier distinguish "resolved correctly"
 * from "could not be determined" without re-deriving it (hard rule 3b: the two must not be
 * indistinguishable in the output).
 *
 * v0: resolve relative to CWD's .quay/config.yml if present, else ./tasks (kept minimal per G5 — a
 * real config loader is `quay` Core's job, not quay-native's; quay-native itself just needs *a*
 * tasks dir).
 */
export function resolveTasksDirWithSource(): { dir: string; source: TasksDirSource } {
  const envDir = process.env.QUAY_NATIVE_TASKS_DIR;
  if (envDir) return { dir: path.resolve(envDir), source: "env" };
  const repoRoot = findRepoRoot(process.cwd());
  if (repoRoot) return { dir: path.resolve(repoRoot, "tasks"), source: "repo-root" };
  return { dir: path.resolve(process.cwd(), "tasks"), source: "cwd-fallback" };
}

export function resolveTasksDir(): string {
  return resolveTasksDirWithSource().dir;
}

/**
 * The directory that CONTAINS this workspace's tasks/ — and therefore its adr/ goals/ meta/
 * docs-managed/ siblings. Derived from the already-resolved tasks dir, never from the cwd
 * (module header: the cwd is the provider package dir, which for the upgrade channel lives inside
 * the quay repo).
 */
export function resolveWorkspaceBaseDir(): string {
  return path.dirname(resolveTasksDirWithSource().dir);
}

/**
 * resolveSiblingDir — resolve a provider-carrier directory (adr/goals/meta/docs-managed) that
 * SHARES a common parent with tasks/. Priority: env override → sibling of the resolved tasks dir.
 *
 * When the tasks dir itself could only be resolved by the cwd-relative fallback (no env, no
 * workspace marker upward), the sibling inherits that uncertainty, so we PRINT where it landed —
 * same fail-open-with-a-voice discipline as gap-quay-init-env-only-tasks-dir-goals-adr-meta-land-
 * inside-npm-package (kept: a bare quay-native invocation has always resolved cwd-relative and a
 * hard failure would break existing callers; but a value that "could not be determined correctly"
 * must not look identical to "resolved correctly").
 */
export function resolveSiblingDir(envName: string, kind: string): string {
  const envDir = process.env[envName];
  if (envDir) return path.resolve(envDir);
  const { dir, source } = resolveTasksDirWithSource();
  const resolved = path.join(path.dirname(dir), kind);
  if (source === "cwd-fallback") {
    console.error(
      `quay-native: ${envName} not set and no .quay/config.yml found upward — defaulting ${kind} to ${resolved} (cwd-relative fallback; set ${envName} to point it inside the project)`,
    );
  }
  return resolved;
}

/** ADRs (a SEPARATE kind, stored in a sibling dir of tasks/). Env override QUAY_NATIVE_ADR_DIR. */
export function resolveAdrDir(): string {
  return resolveSiblingDir("QUAY_NATIVE_ADR_DIR", "adr");
}

/**
 * D1 (exp5-M-CRYST-D1): managed documents, a sibling of tasks/ and adr/ — same resolution shape
 * as resolveAdrDir(). Env override QUAY_NATIVE_DOCS_DIR. (Routed through resolveSiblingDir rather
 * than carrying its own copy of the walk: it had the identical cwd-binding defect, which is the
 * same one-line fix in the same file — hard rule 5b.)
 */
export function resolveDocsDir(): string {
  return resolveSiblingDir("QUAY_NATIVE_DOCS_DIR", "docs-managed");
}

/**
 * Goals (SPEC-goal-mechanism-2026-09-06.md §5.2) are provider-backed: a sibling of tasks/, like
 * adr/. Env override QUAY_NATIVE_GOAL_DIR.
 */
export function resolveGoalDir(): string {
  return resolveSiblingDir("QUAY_NATIVE_GOAL_DIR", "goals");
}

/**
 * Meta records (gap-meta-records-should-be-a-first-class-store-kind-not-a-task-label) are
 * provider-backed like goals: a sibling of tasks/ (default ./meta). Env override
 * QUAY_NATIVE_META_DIR.
 */
export function resolveMetaDir(): string {
  return resolveSiblingDir("QUAY_NATIVE_META_DIR", "meta");
}
