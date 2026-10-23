// routine-engine-module-loader.ts — ONE implementation of "find a `docs/analysis/*.mjs` engine module on
// disk, import it lazily, memoise it by RESOLVED path, and record a NAMED reason when it cannot be had",
// shared by the two sibling routines that drive that engine.
//
// THE DEFECT THIS CLOSES (routine `architecture-analysis`, finding `dup-discovery-module-loader`,
// runId `architecture-analysis-1792752934532`, archguard dup hash d5a5945972ad7036 — 177 tokens / 17
// lines): the `load` arrow below, its `unresolved.push` wording and its cache semantics were
// BYTE-IDENTICAL in `discovery-method-routine.ts` and `open-semantic-discovery-routine.ts` — two files
// of 2,241 and 5,682 lines. The consequence is the one this repo keeps paying for (硬规则 5b): a future
// fix to the refusal wording or to the cache rule would have had to find and edit the same mechanism
// twice, and the second copy would silently keep the old behaviour if it were missed.
//
// ⛔ WHY THIS IS A RUNTIME `import()` AND NOT A STATIC ONE (the invariant this module carries forward):
// both routines are SHIPPED (`plugin/scripts/*.ts`), and `docs/analysis/` is NOT part of the shipped
// artifact. A static `from "../../docs/analysis/x.mjs"` specifier would (a) make the bundle unresolvable
// when `plugin/` is staged as the artifact root, and (b) let esbuild INLINE those modules, whose own
// direct-entry guards would then hijack the driver bundles' mains. See the `case (i)` / `case (8)`
// static controls in `plugin/test/open-semantic-discovery-routine.test.mjs` and
// `plugin/test/discovery-method-routine.test.mjs` — they read THIS file for the runtime-resolution form.
//
// ⛔ WHY `unresolved[]` IS AN OUT-PARAMETER AND THE LOADER NEVER THROWS: both callers accumulate over
// SEVERAL modules and then throw ONE refusal naming every one that could not be resolved. A loader that
// threw on the first miss would hide the rest, and a loader that returned a silent `null` with no
// recorded reason would make "could not resolve the engine" indistinguishable from "the engine found
// nothing" (硬规则 3b). The reason strings are part of that refusal, so they live here, once.
//
// ⛔ THE CACHE IS PASSED IN, NOT MODULE-GLOBAL: each routine owns its own map and may share it with its
// other single-module loaders (open-semantic-discovery-routine's `loadStreamDiagnostics` does), so the
// memoisation is keyed by the whole caller's view of "the engine", never by a process-wide accident.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The repo this FILE lives in (…/plugin/scripts/<this> → repo root). Used only to BUILD a candidate
 *  path — nothing is resolved through it until the runtime `import()` above. Because every engine-loading
 *  routine lives beside this file, the value is the same one they each computed before this extraction. */
export const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface EngineModuleResolution {
  /** Absolute path of the first candidate that exists, or null when none does. */
  path: string | null;
  /** Every candidate tried, in order. The refusal names them, so a missing engine is diagnosable. */
  tried: string[];
}

/** Resolve one engine module under `dirRel` to an absolute path, trying the SCRIPT's own repo first and
 *  the observed workspace `root` second. Returns the candidates it TRIED so the refusal can name them.
 *
 *  WHY TWO ROOTS, IN THIS ORDER: code belongs with the code — the engine lives in THIS repo's
 *  `docs/analysis`, not in the workspace being observed — and the workspace candidate is what lets a
 *  checkout whose script is somewhere else (a task worktree running against the main checkout) or a
 *  workspace vendoring its own copy still run. Both candidates absent ⇒ the caller records a `failed`
 *  round naming BOTH paths (硬规则 3b). */
export function resolveEngineModuleIn(root: string, file: string, dirRel: string): EngineModuleResolution {
  const tried = [
    path.join(SCRIPT_REPO_ROOT, dirRel, file),
    path.join(root, dirRel, file),
  ];
  for (const candidate of tried) {
    if (fs.existsSync(candidate)) return { path: candidate, tried };
  }
  return { path: null, tried };
}

/** The ONE runtime-import rule: import a module by its ALREADY-RESOLVED absolute path, memoised in the
 *  caller's cache. Every engine load in the routine track goes through this — the two multi-module
 *  loaders, open-semantic-discovery's single-module `loadStreamDiagnostics`, and cross-project-dogfood's
 *  throw-style loader — so "a resolved path, never a static specifier" and "one import per resolved
 *  path per process" are single facts rather than four agreements (硬规则 5b).
 *
 *  ⛔ The caller has already decided the path exists; this function does not re-check it. A failed
 *  import propagates to the caller, which owns the wording of its own refusal (the loaders above record
 *  it in `unresolved[]`; the throw-style callers wrap it). */
export async function importEngineModuleAt(absPath: string, cache: Map<string, unknown>): Promise<unknown> {
  const cached = cache.get(absPath);
  if (cached !== undefined) return cached;
  const mod = (await import(/* @vite-ignore */ pathToFileURL(absPath).href)) as unknown;
  cache.set(absPath, mod);
  return mod;
}

/** Build the per-round `load(file)` both engine-module sets use.
 *
 *  @param root       the observed workspace root (candidate 2 of the resolution)
 *  @param cache      the CALLER's memo map, keyed by RESOLVED path — two rounds (and two tests) that
 *                    resolve the same file load it once. Node's own module cache would do this anyway;
 *                    the map is what lets the resolver stay synchronous and cheap while the import stays
 *                    lazy.
 *  @param unresolved out-parameter: one NAMED reason is pushed per module that could not be resolved or
 *                    imported, so the caller's single thrown refusal can list every one.
 *  @param dirRel     the engine directory, relative to a repository root (`docs/analysis` today; the
 *                    parameter is what keeps this one loader usable by BOTH routines without either
 *                    inheriting the other's constant).
 *  @returns          an async loader that resolves to the module namespace, or to `null` after recording
 *                    WHY in `unresolved`. It NEVER throws — see the header. */
export function makeEngineModuleLoader(
  root: string,
  cache: Map<string, unknown>,
  unresolved: string[],
  dirRel: string,
): (file: string) => Promise<unknown> {
  return async (file: string): Promise<unknown> => {
    const r = resolveEngineModuleIn(root, file, dirRel);
    if (r.path === null) {
      unresolved.push(`${file} — not found at ${r.tried.join(" or ")}`);
      return null;
    }
    try {
      return await importEngineModuleAt(r.path, cache);
    } catch (e) {
      unresolved.push(`${file} — import failed: ${(e as Error).message}`);
      return null;
    }
  };
}
