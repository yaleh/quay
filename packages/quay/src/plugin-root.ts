// plugin-root.ts — the SINGLE resolver for locating the quay `plugin/` tree from a non-skill
// entry point (CLI / cron / OS anchor / precommit hook — anything that is NOT loaded through
// Claude Code's skill mechanism, so ${CLAUDE_PLUGIN_ROOT} text expansion never applies).
// (tasks/gap-plugin-root-resolution-non-skill-entrypoints — SPEC §6b's three constraints.)
//
// WHY this module exists: `cli/driver.ts` used to resolve its kernel as
// `path.join(<workspace root>, "plugin/scripts/driver-runtime.ts")`. That only works while
// quay-init copies 117–131 scripts into the consumer workspace. SPEC AC168 removes that copy
// (install = write config only), so the workspace root will have no `plugin/` — and every
// downstream `quay driver start` would die with "kernel not found".
//
// The three constraints (SPEC §6b, one is disqualifying if any fails):
//   ① from a worktree, NEVER hit that worktree's `plugin/` copy — AC139-4's original
//      constraint, backed by one real carrier-death (2026-08-23 resident supervisor hanging
//      on a short-lived worktree). Resolved by mainCheckoutRoot() + early relocation below.
//   ② MUST NOT require the target project to have a local `plugin/` copy — otherwise the
//      install copy was never really abolished. Resolved by walking up from THIS module's
//      own install location (import.meta.url), never from process.cwd() / the workspace root.
//   ③ MUST resolve under BOTH install paths — npm-global (packages/quay/package.json `files`
//      ships `plugin`, so it lands at <pkg>/plugin/) and plugin marketplace (the plugin root
//      IS the dir that directly contains `scripts/`). Resolved by probing both rel shapes
//      `plugin/scripts/…` and `scripts/…` at each walk-up level.
//
// ⛔ This module ships under packages/quay (Core), so it MUST stay dependency-free on the
// plugin layer (engine.ts rule) — it only probes the filesystem and `git worktree list`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/** This module's own directory — the anchor for the walk-up (never process.cwd()). */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The kernel script that anchors "this dir is the plugin root" (the load-bearing non-skill
 *  consumer is cli/driver.ts). A candidate root must contain `scripts/` with the kernel in EITHER
 *  raw form (`driver-runtime.ts`, the dev tree) or bundled form (`dist/driver-runtime.js` — the
 *  shipped artifact DELETES raw .ts, so an installed package only has the bundle;
 *  gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs). */
const KERNEL_RELS = [
  path.join("scripts", "driver-runtime.ts"),
  path.join("scripts", "dist", "driver-runtime.js"),
];

/** True when `root` directly contains `scripts/` with the kernel in either raw or bundled form. */
function kernelAnchorExists(root: string): boolean {
  return KERNEL_RELS.some((rel) => fs.existsSync(path.join(root, rel)));
}

/**
 * If `dir` is inside a NON-main linked git worktree (the literal `git worktree add` kind),
 * return the MAIN checkout's root; otherwise null. Constraint ①: a resolver that walks up
 * from a worktree-loaded module would land on the worktree's `plugin/` copy — this is the
 * single point that redirects to the main checkout instead.
 */
export function mainCheckoutRoot(dir: string): string | null {
  try {
    const out = execFileSync("git", ["-C", dir, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const worktrees = out
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => path.resolve(l.slice("worktree ".length).trim()));
    if (worktrees.length < 2) return null; // no linked worktrees → not a worktree context
    const main = worktrees[0]; // git always lists the main worktree first
    const real = path.resolve(dir);
    for (const w of worktrees.slice(1)) {
      if (real === w || real.startsWith(w + path.sep)) return main;
    }
    return null;
  } catch {
    return null; // git unavailable / not a repo → no linked-worktree relocation applies
  }
}

/**
 * Resolve the plugin ROOT — the directory that directly contains `scripts/driver-runtime.ts`.
 * Returns null when no plugin can be located (the caller decides whether to fail closed).
 *
 * Resolution order:
 *   1. `QUAY_PLUGIN_ROOT` env — explicit pointer (hermetic tests / operator override).
 *   2. If this module was loaded from a linked worktree → the MAIN checkout's `plugin/`
 *      (constraint ①). Fail-closed (null) rather than ever falling back to the worktree copy.
 *   3. Walk up from this module's own location (constraints ②③): probe `plugin/scripts/…`
 *      then `scripts/…` at each level.
 */
export function resolvePluginRoot(): string | null {
  if (process.env.QUAY_PLUGIN_ROOT) return process.env.QUAY_PLUGIN_ROOT;

  const main = mainCheckoutRoot(MODULE_DIR);
  if (main) {
    const cand = path.join(main, "plugin");
    return kernelAnchorExists(cand) ? cand : null;
  }

  return resolvePluginRootFrom(MODULE_DIR);
}

/**
 * Walk-up probe from a start dir (test seam for the installed-artifact layout, where MODULE_DIR is
 * not the source repo). Two install layouts per level: npm-global (`<dir>/plugin` IS the root) and
 * marketplace / vendored (`<dir>` itself is the root) — the kernel anchor matches raw source AND the
 * bundled dist form (installed packages delete raw .ts).
 */
export function resolvePluginRootFrom(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const pluginSubdir = path.join(dir, "plugin");
    if (kernelAnchorExists(pluginSubdir)) return pluginSubdir;
    if (kernelAnchorExists(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve an absolute path to a script under the plugin root (rel is e.g. `scripts/foo.sh`),
 * or null when the plugin root can't be resolved or the script is absent.
 */
export function resolvePluginScript(rel: string): string | null {
  const root = resolvePluginRoot();
  if (!root) return null;
  const abs = path.resolve(root, rel);
  return fs.existsSync(abs) ? abs : null;
}

/**
 * Resolve a plugin script to its RUNNABLE form: the raw source (run with
 * `--experimental-strip-types`) or the shipped dist bundle (a plain ESM `.js`, run without the
 * flag). `gap-shipped-ts-files-are-not-bundled`: the npm-pack artifact carries consumer-referenced
 * plugin `.ts` ONLY as bundled `dist/*.js` (no raw `.ts`), so a `.ts` rel must fall back to the
 * dist bundle — the same dev/dist fallback the pre-migration callsites hand-rolled
 * (`mcp-server.ts`'s `resolvePluginExecutable`, `observation.ts`'s `readBoardLanding`,
 * `serve-send.ts`'s `resolveTranscriptChecker`). Returns null when neither form resolves; the
 * caller decides whether to fail closed. `.sh` rels never fall back (shell scripts ship raw).
 */
export function resolvePluginScriptExec(rel: string): { path: string; stripTypes: boolean } | null {
  const raw = resolvePluginScript(rel);
  if (raw) return { path: raw, stripTypes: rel.endsWith(".ts") };
  if (rel.endsWith(".ts")) {
    // rel is plugin-root-relative (`scripts/…` or `gate-scripts/…`), so the bundled form is
    // `scripts/dist/….js` (NOT `plugin/scripts/dist/…` — that prefix was stripped by the caller).
    const bundledRel = rel.replace(/\.ts$/, ".js").replace(/^(scripts|gate-scripts)\//, "$1/dist/");
    const bundled = resolvePluginScript(bundledRel);
    if (bundled) return { path: bundled, stripTypes: false };
  }
  return null;
}
