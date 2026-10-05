// worktree-deps.ts — the SINGLE package-manager-aware decision (and, for the task path, the
// provisioning) for a freshly created worktree's `node_modules`. Shared by BOTH worktree-assembly
// paths so they can never diverge:
//   · the TASK path  — `plugin/scripts/dispatch-worktree-setup.sh`, via the thin-plugin CLI pair
//                      `plugin/scripts/worktree-deps-provision.{sh,ts}` (this module is imported);
//   · the GOAL path  — `goal-preview.ts` `ensureWorktreeNodeModules` (the criterion worktree AND
//                      the merge-verification temp worktree both call it; this module is imported).
// ⛔ ONE implementation, two callers — never a copy per caller
//    (task gap-dispatch-worktree-setup-links-node-modules-for-pnpm-projects).
//
// WHY (the defect this closes): `dispatch-worktree-setup.sh`'s deps step knew only two moves —
// symlink the main checkout's `node_modules`, or run `npm install`. A pnpm project (cantus) refuses
// a symlinked `node_modules`, so every freshly dispatched task worktree's suite step died in
// ~6ms/166ms with an empty log, and the driver filed it needs-human as "cannot attribute". This
// module adds the missing arm: when the project DECLARES its worktree install command
// (`.quay/config.yml` `loop.worktree_deps_install`) or is DETECTED as pnpm (`pnpm-lock.yaml`, or
// `package.json` `packageManager: pnpm@…`), dependencies are INSTALLED inside the worktree instead
// of linked.
//
// FAIL-CLOSED (matching the .sh's pre-existing npm branch): an install that exits non-zero, or
// exits 0 without producing `node_modules`, is reported `failed` with a readable reason — ⛔ never a
// silent fallback to a symlink that lets the suite die in milliseconds (hard rule 3b).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readLoopParams } from "./loop-params.ts";

/** The pnpm lockfile that marks a project as pnpm — the primary auto-detect marker. */
export const WORKTREE_DEPS_PNPM_LOCKFILE = "pnpm-lock.yaml";
/** The install command used when a project is detected as pnpm and declares no explicit command.
 *  pnpm's content-addressed store makes `--offline` cheap when the packages are already cached. */
export const WORKTREE_DEPS_PNPM_COMMAND = "pnpm install --frozen-lockfile --offline";
/** The fallback install command for a bare clone (main checkout has NO `node_modules` and the
 *  project declares no command and is not detected as pnpm) — the .sh's pre-existing behavior. */
export const WORKTREE_DEPS_NPM_COMMAND = "npm install";

/** WHY an install command was chosen. `null` on the symlink/present paths (⛔ not "none detected",
 *  which would be the same shape — hard rule 3b). */
export type WorktreeDepsDecision = "config" | "pnpm-lockfile" | "packageManager" | null;

/** True for ANY directory entry (file, dir, symlink — including a dangling symlink): `existsSync`
 *  follows symlinks and would read a broken link as "absent", re-linking over it. */
function entryExists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory(); // follows a symlinked main's node_modules too
  } catch {
    return false;
  }
}

/** Detect a pnpm project from the MAIN checkout's markers. Returns the marker that matched, or
 *  `{ pnpm: false, decision: null }` — ⛔ the two are distinct shapes (hard rule 3b). */
export function detectPnpmProject(mainRoot: string): { pnpm: boolean; decision: "pnpm-lockfile" | "packageManager" | null } {
  if (entryExists(path.join(mainRoot, WORKTREE_DEPS_PNPM_LOCKFILE))) {
    return { pnpm: true, decision: "pnpm-lockfile" };
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(mainRoot, "package.json"), "utf8")) as { packageManager?: unknown };
    if (typeof pkg?.packageManager === "string" && /^pnpm@/.test(pkg.packageManager)) {
      return { pnpm: true, decision: "packageManager" };
    }
  } catch {
    /* no package.json / unparseable — not a pnpm marker */
  }
  return { pnpm: false, decision: null };
}

/**
 * The project's DECLARED worktree install command — `.quay/config.yml` `loop.worktree_deps_install`
 * (declared + validated in `loop-params.ts`), or null when absent/blank. A malformed/absent config
 * is read as "no declaration", never as a thrown error (the deps step must not be blocked by an
 * unrelated config problem — the pre-existing symlink/npm arms still apply).
 */
export function readDeclaredWorktreeDepsInstall(workspaceRoot: string): string | null {
  try {
    const p = readLoopParams(workspaceRoot);
    return typeof p.worktreeDepsInstall === "string" && p.worktreeDepsInstall.trim() ? p.worktreeDepsInstall.trim() : null;
  } catch {
    return null;
  }
}

/**
 * THE SHARED JUDGMENT. Given the main checkout and the project's declared install command, answer
 * the ONE question both worktree-assembly paths ask: *is there a package-manager-specific install
 * command for this project, and what is it?*  Returns `{ command: null }` when the project has no
 * such marker (⇒ the caller uses its own symlink/fallback policy). Priority: an explicit
 * declaration wins over auto-detection.
 */
export function worktreeDepsInstallCommand(opts: { mainRoot: string; declaredInstall?: string | null }): { command: string | null; decision: WorktreeDepsDecision } {
  const declared = opts.declaredInstall && opts.declaredInstall.trim() ? opts.declaredInstall.trim() : null;
  if (declared) return { command: declared, decision: "config" };
  const detected = detectPnpmProject(opts.mainRoot);
  if (detected.pnpm) return { command: WORKTREE_DEPS_PNPM_COMMAND, decision: detected.decision };
  return { command: null, decision: null };
}

// ── the TASK path's provisioning (present / install / symlink / npm fallback) ─────────────────────

/** The enumerated outcome of the task worktree's `node_modules` step. `dry-run` = planned, nothing
 *  created. `failed` = an install command ran and did not yield `node_modules`. */
export type WorktreeDepsState = "present" | "linked" | "installed" | "failed" | "dry-run";

export interface WorktreeDepsReading {
  state: WorktreeDepsState;
  /** `<worktreeRoot>/node_modules` — where the entry lives (or would live). */
  nodeModulesPath: string;
  /** The main checkout's `node_modules` the symlink points at; null unless `linked`. */
  target: string | null;
  /** The install command run (or planned); null on the present/linked paths. */
  command: string | null;
  /** WHY the command was chosen; null on the present/linked paths. */
  decision: WorktreeDepsDecision;
  /** The planned action on `dry-run` / the readable cause on `failed`; null otherwise. */
  reason: string | null;
}

export interface WorktreeDepsOptions {
  mainRoot: string;
  worktreeRoot: string;
  /** `.quay/config.yml` `loop.worktree_deps_install` (see `readDeclaredWorktreeDepsInstall`). */
  declaredInstall?: string | null;
  /** Plan only — create/run nothing. */
  dryRun?: boolean;
}

/**
 * Run an install command in `cwd`. `inherit` relays the child's stdout/stderr to this process
 * (the TASK path's behavior — the existing .sh ran the install in the foreground); otherwise the
 * output is captured and returned (the GOAL path — the driver's stdout stays clean). Never throws.
 */
export function runWorktreeDepsInstall(command: string, cwd: string, opts: { inherit?: boolean } = {}): { ok: boolean; output: string } {
  if (opts.inherit) {
    const r = spawnSync("sh", ["-c", command], { cwd, stdio: "inherit" });
    if (r.error) return { ok: false, output: r.error.message };
    return { ok: r.status === 0, output: "" };
  }
  const r = spawnSync("sh", ["-c", command], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.error) return { ok: false, output: r.error.message };
  return { ok: r.status === 0, output };
}

/**
 * Provision `worktreeRoot/node_modules` for the TASK path. Order:
 *   1. an existing entry is kept (idempotent);
 *   2. a package-manager install command (declared, else pnpm-detected);
 *   3. the main checkout's `node_modules` symlinked in (the zero-copy precedent);
 *   4. a bare clone with neither ⇒ `npm install` inside the worktree (the pre-existing fallback).
 * Never throws; every outcome is an enumerated reading.
 */
export function provisionWorktreeDeps(opts: WorktreeDepsOptions): WorktreeDepsReading {
  const nmPath = path.join(opts.worktreeRoot, "node_modules");
  if (entryExists(nmPath)) {
    return { state: "present", nodeModulesPath: nmPath, target: null, command: null, decision: null, reason: null };
  }

  const judged = worktreeDepsInstallCommand(opts);
  const mainNm = path.join(opts.mainRoot, "node_modules");
  const hasMainNm = isDirectory(mainNm);

  if (judged.command !== null) {
    if (opts.dryRun) {
      return { state: "dry-run", nodeModulesPath: nmPath, target: null, command: judged.command, decision: judged.decision, reason: `would run '${judged.command}' in ${opts.worktreeRoot} (${judged.decision})` };
    }
    const r = runWorktreeDepsInstall(judged.command, opts.worktreeRoot, { inherit: true });
    if (!r.ok) {
      return { state: "failed", nodeModulesPath: nmPath, target: null, command: judged.command, decision: judged.decision, reason: `'${judged.command}' exited non-zero in ${opts.worktreeRoot}` };
    }
    if (!isDirectory(nmPath)) {
      return { state: "failed", nodeModulesPath: nmPath, target: null, command: judged.command, decision: judged.decision, reason: `'${judged.command}' did not produce ${nmPath}` };
    }
    return { state: "installed", nodeModulesPath: nmPath, target: null, command: judged.command, decision: judged.decision, reason: null };
  }

  if (hasMainNm) {
    if (opts.dryRun) {
      return { state: "dry-run", nodeModulesPath: nmPath, target: mainNm, command: null, decision: null, reason: `would link ${mainNm} -> ${nmPath}` };
    }
    try {
      fs.symlinkSync(mainNm, nmPath, "dir");
    } catch (err) {
      return { state: "failed", nodeModulesPath: nmPath, target: mainNm, command: null, decision: null, reason: String((err as Error)?.message ?? err) };
    }
    return { state: "linked", nodeModulesPath: nmPath, target: mainNm, command: null, decision: null, reason: null };
  }

  // Bare clone: no package-manager marker and no main node_modules ⇒ the pre-existing npm fallback.
  if (opts.dryRun) {
    return { state: "dry-run", nodeModulesPath: nmPath, target: null, command: WORKTREE_DEPS_NPM_COMMAND, decision: null, reason: `would run '${WORKTREE_DEPS_NPM_COMMAND}' in ${opts.worktreeRoot} (main has no node_modules)` };
  }
  const r = runWorktreeDepsInstall(WORKTREE_DEPS_NPM_COMMAND, opts.worktreeRoot, { inherit: true });
  if (!r.ok) {
    return { state: "failed", nodeModulesPath: nmPath, target: null, command: WORKTREE_DEPS_NPM_COMMAND, decision: null, reason: `'${WORKTREE_DEPS_NPM_COMMAND}' exited non-zero in ${opts.worktreeRoot}` };
  }
  if (!isDirectory(nmPath)) {
    return { state: "failed", nodeModulesPath: nmPath, target: null, command: WORKTREE_DEPS_NPM_COMMAND, decision: null, reason: `'${WORKTREE_DEPS_NPM_COMMAND}' did not produce ${nmPath}` };
  }
  return { state: "installed", nodeModulesPath: nmPath, target: null, command: WORKTREE_DEPS_NPM_COMMAND, decision: null, reason: null };
}
