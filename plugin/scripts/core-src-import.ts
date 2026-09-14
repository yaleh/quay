// core-src-import.ts — the ONE layout-independent way a plugin script acquires a Core
// (`packages/quay/src/…`) module when it runs RAW (`node --experimental-strip-types`), i.e. as a
// source file rather than as a bundled `dist/*.js`.
//
// WHY THIS EXISTS (gap-touches-orthogonality-check-relative-import-breaks-in-staged-plugin-copy,
// 2026-09-14 — reproduced on this machine, not constructed): a bare
// `import … from "../../packages/quay/src/<rel>"` hard-codes the repo-top layout
// (`<repo>/plugin/scripts/x.ts` → `<repo>/packages/quay/src/<rel>`). The SAME source file also
// exists in the STAGED copy `package.sh` builds (`plugin/` → `packages/quay/plugin/`,
// the npm-pack snapshot `build-plugin-dist.mjs` compiles its dist bundles from — see
// packages/quay/scripts/package.sh), where the same literal resolves to
// `packages/quay/packages/quay/src/<rel>` — a path that does not exist. Raw execution under that
// layout died with ERR_MODULE_NOT_FOUND while the staged snapshot was freshly refreshed, and took
// the whole `quay driver` verb with it: the kernel's own import graph reaches it
// (driver-runtime.ts → driver-filters.ts → touches-orthogonality-check.ts), so `quay driver status`
// / `restart` failed BEFORE touching any supervisor state — reported to the operator as if the
// driver command itself were broken.
//
// ⛔ WHY NOT a computed specifier ALONE: esbuild must be able to resolve and INLINE the specifier so
// the shipped `dist/*.js` bundle stays self-contained. A runtime-computed path lands the shipped
// artifact on a `.ts` under node_modules, which Node ≥23.7 refuses to strip
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) — the ruling written at worker-driver.ts:3900 for
// gap-resolve-kernel-src-module-strip-types-node-modules.
// ⛔ WHY NOT a static literal ALONE: correct in the repo tree and in every shipped bundle, and wrong
// the moment the file runs raw from the staged layout.
//
// So: a STATIC LITERAL primary (build-time inlined — correct in the repo tree AND in the bundle),
// with a walk-up fallback reached ONLY when the primary cannot be resolved. The fallback anchors on
// THIS module's own directory (never process.cwd()) and probes the two Core-src shapes at each
// level up — the same module-location anchoring plugin-root.ts uses for the plugin root:
//   <dir>/packages/quay/src/<rel>   — repo tree      (<repo>/plugin/scripts/…)
//   <dir>/src/<rel>                 — staged package (<pkg>/plugin/scripts/… → <pkg>/src/…)
// ⛔ The fallback is NEVER the primary: in a shipped bundle the primary is inlined and cannot throw,
// so the fallback stays dead code there — the node_modules `.ts` hazard above cannot be reached.
//
// FAIL-CLOSED (硬规则 3b): when neither shape resolves, the ORIGINAL resolution error is rethrown.
// "I could not find the module" must never be laundered into a different, quieter failure.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** This module's own directory — the anchor for the walk-up (never process.cwd()). */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Max upward steps before giving up (mirrors repo-root.ts's MAX_DEPTH). */
const MAX_DEPTH = 8;

/**
 * Absolute path of the first EXISTING Core-src file named `rel` (a path under
 * `packages/quay/src/`, e.g. `runtime-artifacts.ts`, `gate/gate-event-store.ts`), by walking up
 * from `startDir` (default: this module's directory) and probing both layout shapes per level.
 * Returns null when neither shape resolves — the caller decides (see acquireCoreSrc).
 */
export function resolveCoreSrcFile(rel: string, startDir: string = HERE): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const repoTree = path.join(dir, "packages", "quay", "src", rel);
    if (fs.existsSync(repoTree)) return repoTree;
    const staged = path.join(dir, "src", rel);
    if (fs.existsSync(staged)) return staged;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Acquire a Core-src module. `primary` MUST be a thunk wrapping a STATIC LITERAL `import("…")`
 * (esbuild resolves and inlines literals — a computed specifier here would defeat the inlining this
 * whole shape exists to preserve); `rel` is the same target as a Core-src-relative path, used to
 * re-resolve it when the literal cannot be resolved in the running layout.
 *
 * The fallback fires ONLY on ERR_MODULE_NOT_FOUND — the one failure that means "the literal's layout
 * assumption is wrong". Every other failure (a module whose own INIT throws, a syntax error) is a
 * real defect in the target module and propagates unchanged: falling back there would (a) report a
 * different error than the true one and (b) risk a second, divergently-initialized instance of the
 * same module. When the fallback itself fails, the ORIGINAL error is rethrown for the same reason —
 * "I could not resolve it" must never be laundered into a quieter, unrelated failure.
 */
export async function acquireCoreSrc<T>(primary: () => Promise<T>, rel: string): Promise<T> {
  try {
    return await primary();
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    const fallback = resolveCoreSrcFile(rel);
    if (!fallback) throw err;
    try {
      return (await import(pathToFileURL(fallback).href)) as T;
    } catch {
      throw err;
    }
  }
}
