// runtime-artifacts.ts — THE reader of quay's runtime-artifact manifest, and the ONE implementation of
// "is this path a quay runtime artifact?".
// (tasks/gap-quay-init-gitignore-misses-quay-runtime-artifacts-outside-dot-quay)
//
// WHY THIS MODULE EXISTS: quay writes runtime state into a workspace it is installed in. The state under
// `<workspace>/.quay/` is covered by the `.quay/*` rule quay-init writes, but quay ALSO writes state
// OUTSIDE `.quay/` — the native store's parse cache lands at `<tasksDir>/.quay-parse-cache.json`
// (written on the READ path: `task_list` / `task_get`, and the fan-in's own `ac-precheck` / `anti-drift`
// steps), fast-mode telemetry under `milestones/`, the tick ledgers under `orchestration/`, per-run event
// logs under `.workflow-events/`. Untracked and un-ignored, those paths dirty the checkout merely as a
// side effect of reading the task store, and the mechanical fan-in's `ff` then refuses EVERY task —
// measured on a real third-party project (quay-fleet, 2026-09-13): a task whose suite was 55/55 green
// could not land, and the refusal reason did not say quay was the author.
//
// THE MANIFEST IS THE SINGLE SOURCE: `plugin/scripts/quay-runtime-artifacts.txt`, read here. Consumers:
//   ① `plugin/scripts/quay-init.sh`   — writes its patterns into a consumer project's `.gitignore`;
//   ② `fan-in/ff-merge.ts`            — benign runtime-dirty pass-through + authorship attribution;
//   ③ `touches-orthogonality-check.ts`— the `--runtime-dirty` judge the ff calls;
//   ④ `gitignore-runtime-coverage-check.ts` — binds it to quay's own marked `.gitignore` entries.
// ⛔ There is NO second list anywhere: `runtimeArtifactPatternRe` / `isRuntimeArtifactPath` live here so
// the two dirty-tree judges cannot drift into two口径 (硬规则 5b — the miss that produced TWO copies of
// the `.quay/`-only rule, one in the ff and one in the touches judge).
//
// FAIL-CLOSED ON AN UNREADABLE MANIFEST (硬规则 3b): `patterns === null` means the manifest could not be
// resolved or read, and every consumer must then keep its HISTORICAL extent — never widen, never
// attribute. A readable-but-empty manifest is also treated as "no extension".
//
// Core-layer discipline (engine.ts rule): node builtins only — no plugin-layer import.

import fs from "node:fs";
import path from "node:path";

const RUNTIME_ARTIFACT_MANIFEST_BASENAME = "quay-runtime-artifacts.txt";

/** Resolve the runtime-artifact manifest under a plugin scripts dir. The shipped kernel's dir may BE the
 *  `dist/` subdir (worker-driver passes `resolveKernelScriptsDir()`), so the parent is probed too — the
 *  same dual-form resolution `siblingScriptArgv` uses. null ⇒ not found. */
export function runtimeArtifactManifestPath(scriptsDir: string | null): string | null {
  if (!scriptsDir) return null;
  const candidates = [path.join(scriptsDir, RUNTIME_ARTIFACT_MANIFEST_BASENAME)];
  if (path.basename(scriptsDir) === "dist") {
    candidates.push(path.join(path.dirname(scriptsDir), RUNTIME_ARTIFACT_MANIFEST_BASENAME));
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/** Read the manifest's patterns (comments/blank lines dropped). null ⇒ unreadable/absent — the caller
 *  must distinguish that from an empty list (硬规则 3b). */
export function loadRuntimeArtifactPatterns(scriptsDir: string | null): string[] | null {
  const p = runtimeArtifactManifestPath(scriptsDir);
  if (!p) return null;
  try {
    return fs
      .readFileSync(p, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
  } catch {
    return null;
  }
}

/** Compile ONE gitignore pattern to an anchored RegExp: `**` crosses path separators, `*`/`?` stay
 *  within one segment, a trailing `/` denotes a directory (whose CONTENTS are matched by the same
 *  rule — the trailing `(?:/.*)?`), and a matched directory's contents are matched by every pattern.
 *  Pure — exported for the unit tests. */
export function runtimeArtifactPatternRe(pattern: string): RegExp {
  let p = pattern.trim();
  if (p.endsWith("/")) p = p.replace(/\/+$/, "");
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          out += "(?:.*/)?"; // `**/x` also matches a top-level `x`
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}(?:/.*)?$`);
}

/** True iff the workspace-relative path IS a runtime artifact per the manifest. A git porcelain path for
 *  an untracked directory carries a trailing `/` (e.g. `?? .workflow-events/`) — stripped before match. */
export function isRuntimeArtifactPath(relPath: string, patterns: readonly string[]): boolean {
  const p = relPath.replace(/\/+$/, "");
  return patterns.some((pat) => runtimeArtifactPatternRe(pat).test(p));
}

/** The manifest pattern whose STATIC directory prefix contains `relPath` — i.e. quay writes runtime state
 *  somewhere under this dirty path, though the path itself is not a manifest entry (the `?? milestones/`
 *  residue shape: git collapses the untracked dir; only `milestones/fast-mode-telemetry/*.json` is listed).
 *  null ⇒ no such relation. Pure. */
export function runtimeArtifactAreaPattern(relPath: string, patterns: readonly string[]): string | null {
  const p = relPath.replace(/\/+$/, "");
  if (p === "") return null;
  for (const pat of patterns) {
    const staticPrefix = pat.split("*")[0].replace(/\/+$/, "");
    if (staticPrefix === "") continue;
    if (staticPrefix === p || staticPrefix.startsWith(p + "/")) return pat;
  }
  return null;
}

export interface RuntimeArtifactDirty {
  /** the workspace-relative dirty path (trailing `/` stripped). */
  path: string;
  /** the manifest pattern this path matches — the path IS a quay runtime artifact. */
  pattern: string | null;
  /** the manifest pattern whose static prefix contains this path — quay writes runtime state under it. */
  area: string | null;
}

/** Classify dirty paths against the manifest. `patterns === null` (unreadable manifest) ⇒ an EMPTY list
 *  (nothing may be attributed). Only paths with a pattern or an area relation are returned. Pure. */
export function classifyRuntimeArtifactDirty(
  dirtyPaths: readonly string[],
  patterns: readonly string[] | null,
): RuntimeArtifactDirty[] {
  if (!patterns || patterns.length === 0) return [];
  const hits: RuntimeArtifactDirty[] = [];
  for (const raw of dirtyPaths) {
    const p = raw.replace(/\/+$/, "");
    if (p === "") continue;
    const pattern = patterns.find((pat) => runtimeArtifactPatternRe(pat).test(p)) ?? null;
    const area = pattern ? null : runtimeArtifactAreaPattern(p, patterns);
    if (pattern || area) hits.push({ path: p, pattern, area });
  }
  return hits;
}

