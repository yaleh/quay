// worktree-namespace.ts — THE SINGLE resolution of "where do THIS workspace's task worktrees live".
//
// gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root.
//
// WHY THIS MODULE EXISTS (the defect it closes): the worktree namespace was derived IN PLACE, from
// `path.dirname(root)` + a hardcoded 「quay-worktrees」 segment, at three independent read sites
// (`observation.ts taskWorktreeOpen`, `fast-mode-telemetry.ts isQuayWorktreePath`,
// `measure-trend-check.ts normalizePerFileKey`). The WRITE side already honours the per-workspace
// `loop.worktree_root` from `.quay/config.yml` (quay-init.sh writes it; inner-blocked-signal.ts and
// test-isolation-check.ts read it) — so the read side and the write side disagreed.
//
// CONSEQUENCE (measured 2026-09-13 on the real third-party project /home/yale/work/quay-fleet):
// quay-fleet and the quay checkout are siblings under /home/yale/work, so `dirname(root)` + the
// 「quay-worktrees」 segment resolved to /home/yale/work/quay-worktrees — ANOTHER PROJECT's namespace, 14
// worktrees deep, all of them quay's own tasks. The fail-closed design of the old readers (「namespace
// absent ⇒ null, never a positive reading from an unobservable source」) is right; what broke was its
// PREMISE — that `<parent-of-root>/quay-worktrees` is either this project's or non-existent. With two
// projects sharing a parent the premise is false, and the reader answered THIS project's question with
// ANOTHER project's directory.
//
// RESOLUTION ORDER (single source of truth):
//   1. `.quay/config.yml` → `loop.worktree_root` (absolute or relative to the workspace root;
//      normalized so a config value carrying `..` segments — quay-init writes
//      `<parent>/../<project>-worktrees` — resolves to the same path the write side creates).
//   2. FALLBACK, only when the key is absent/unreadable: `<parent-of-root>/quay-worktrees`, the
//      historical convention. The fallback is NEVER silent — `source`/`diagnostic` carry the fact out
//      to the caller (hard rule ③b: a degraded read must be distinguishable from a configured one).
//
// Core (packages/quay/src) cannot import plugin/, and plugin/scripts/*.ts may import Core modules
// relatively (`../../packages/quay/src/...` — the established shared-logic direction, e.g.
// goal-driver.ts → goal-store.ts). This module is therefore the shared home for BOTH sides, and is
// deliberately dependency-light (`node:fs`, `node:path`, `yaml`).

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

/**
 * The worktree-namespace directory NAME the fallback branch uses — the historical convention
 * `<parent-of-root>/quay-worktrees` (CLAUDE.md 正本 inner-brief:104). THIS constant is the single
 * remaining home of that literal: every reader resolves through `resolveWorktreeNamespace()`, and a
 * root-free caller (a pure path transform with no workspace root in scope) uses this name as the
 * segment it strips. Anything else spelling the literal is drift — `worktree-namespace-literal-check.ts`
 * enforces that mechanically.
 */
export const DEFAULT_WORKTREE_NAMESPACE_NAME = "quay-worktrees";

/** Which branch produced a namespace, and — for the fallback — a human reason (never silent). */
export interface WorktreeNamespace {
  /** Absolute, normalized worktree-namespace directory for this workspace. */
  dir: string;
  /** `"config"` = `loop.worktree_root` resolved; `"fallback"` = the convention default was used. */
  source: "config" | "fallback";
  /** Non-null exactly when `source === "fallback"`: WHY the config value was not used. */
  diagnostic: string | null;
}

/** The workspace's `.quay/config.yml`, or null when absent/unreadable (never throws). */
function readUnifiedConfig(rootAbs: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(path.join(rootAbs, ".quay", "config.yml"), "utf8");
    const parsed = YAML.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the worktree namespace for `root`. NEVER throws (the display/observation degradation
 * contract): a missing/malformed config degrades to the historical convention AND says so.
 *
 * `root` may be relative — it is resolved against `process.cwd()` first, exactly as the previous
 * in-place derivations did.
 */
export function resolveWorktreeNamespace(root: string): WorktreeNamespace {
  const rootAbs = path.resolve(root);
  const fallbackDir = path.join(path.dirname(rootAbs), DEFAULT_WORKTREE_NAMESPACE_NAME);

  let config: Record<string, unknown> | null = null;
  let configExists = false;
  try {
    configExists = fs.existsSync(path.join(rootAbs, ".quay", "config.yml"));
  } catch {
    configExists = false;
  }
  if (configExists) config = readUnifiedConfig(rootAbs);

  const loop = config?.loop;
  const raw =
    loop && typeof loop === "object" && !Array.isArray(loop)
      ? (loop as Record<string, unknown>).worktree_root
      : undefined;

  if (typeof raw === "string" && raw.trim()) {
    return { dir: path.resolve(rootAbs, raw.trim()), source: "config", diagnostic: null };
  }

  // Fallback — observable, never silent.
  const why = !configExists
    ? `no ${".quay/config.yml"} in ${rootAbs}`
    : config == null
      ? `${".quay/config.yml"} is unreadable or not a YAML mapping`
      : raw === undefined
        ? `${".quay/config.yml"} has no loop.worktree_root`
        : `loop.worktree_root is not a non-empty string (${JSON.stringify(raw)})`;
  return {
    dir: fallbackDir,
    source: "fallback",
    diagnostic: `${why} — falling back to <parent-of-root>/${DEFAULT_WORKTREE_NAMESPACE_NAME} (${fallbackDir})`,
  };
}
