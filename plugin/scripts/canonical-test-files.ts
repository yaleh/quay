// canonical-test-files.ts — the SINGLE source for the canonical test glob (ADR-004) + realpath dedup.
// gap-canonical-test-files-glob-vs-realpath-divergence: `canonicalTestFiles` /
// `parseCanonicalGlobs` / `expandGlob` were copied into three checkers
// (test-group-downgrade-check.ts / test-framework-policy-check.ts / test-impl-census-check.ts),
// and two of the three copies drifted from the shell source's realpath semantics —
// scripts/test.sh build_deduped_files dedups by realpath (its AC3 comment: "deduped by realpath"),
// but the drifted copies pushed the glob-matched path instead of the realpath. The outputs only
// agreed by accident of glob order (plugin/test/ sorts before experiments/…/test/, so the 10
// symlink copies that point back into plugin/test/ were always skipped as duplicates). This module
// is that code, exactly once, with the realpath semantics.
//
// SEMANTICS (must stay byte-compatible with scripts/test.sh build_deduped_files):
//   - parseCanonicalGlobs reads scripts/test.sh's own `glob=(...)` line (never re-typed).
//   - expandGlob expands each `/`-segment wildcard against the repo root.
//   - canonicalTestFiles dedups by REALPATH (fs.realpathSync) and returns the REALPATH's
//     repo-relative path — so an experiments/ symlink copy that points back into plugin/test/
//     collapses to its target and never runs (or is judged) twice, regardless of glob order.

import fs from "node:fs";
import path from "node:path";
import { readFileSafe } from "./gate-script-base.ts";
// The ONE whole-segment wildcard expander — shared with scripts/test-coverage-check.ts
// (task gap-three-pure-judges-kernel-single-def, AC-909). It ships self-contained through
// build-plugin-dist's `coreSrcAliasPlugin` (the same inlining precedent as ready-pool-check.ts
// statically importing kernel/task-shape-artifacts.ts).
import { expandGlob } from "../../packages/quay/src/kernel/glob-expand.ts";

// Kept as a re-export so the historical import surface of THIS module does not break.
export { expandGlob } from "../../packages/quay/src/kernel/glob-expand.ts";

/** Parse the space-separated glob patterns out of `scripts/test.sh`'s `glob=(...)` line. */
export function parseCanonicalGlobs(repoRoot: string): string[] {
  const src = readFileSafe(path.join(repoRoot, "scripts", "test.sh"));
  const m = src.match(/glob=\(([^)]*)\)/);
  if (!m) return [];
  return m[1]
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The working-tree test files covered by scripts/test.sh's canonical glob, repo-relative, deduped
 * by realpath (matching build_deduped_files in scripts/test.sh). Returns the realpath's
 * repo-relative path, so a symlink globbed BEFORE its target collapses to the target. */
export function canonicalTestFiles(repoRoot: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pattern of parseCanonicalGlobs(repoRoot)) {
    for (const abs of expandGlob(pattern, repoRoot)) {
      let rp = abs;
      try {
        rp = fs.realpathSync(abs);
      } catch {
        rp = abs;
      }
      if (seen.has(rp)) continue;
      seen.add(rp);
      out.push(path.relative(repoRoot, rp).split(path.sep).join("/"));
    }
  }
  return out.sort();
}
