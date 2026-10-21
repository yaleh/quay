// glob-expand.ts — the ONE whole-segment wildcard glob expander, a kernel leaf.
//
// ── THE DEFECT THIS CLOSES (task gap-three-pure-judges-kernel-single-def, AC-909) ───────────────
// `expandGlob` (and its private helper `globSegmentToRegex`) existed as TWO byte-identical
// definitions that shared no import edge:
//   · `plugin/scripts/canonical-test-files.ts` — the canonical-test-file resolver
//   · `scripts/test-coverage-check.ts`         — the DIR-110 orphan detector
// Each was correct on its own; the cost was two bodies to keep in step. `kernel/` is the one
// location both sides reach without a `packages/**` → `plugin/**` reverse edge, and a kernel file
// may import nothing outside `kernel/` except bare specifiers (`node:*`, npm), so this leaf cannot
// create a cycle. The plugin side's static import ships self-contained: build-plugin-dist's
// `coreSrcAliasPlugin` re-points `packages/quay/src/**` specifiers onto the real Core source tree
// and INLINES them into `dist/*.js` (precedent: `plugin/scripts/ready-pool-check.ts`).
//
// SEMANTICS (must stay byte-compatible with `scripts/test.sh` build_deduped_files):
//   - expand each `/`-segment wildcard (`*`) against the repo root;
//   - a non-wildcard segment is joined and kept only if it EXISTS;
//   - the result is filtered to regular files.
// Only whole-segment wildcards are supported — exactly the shape `scripts/test.sh` uses
// (`packages/*/test/*.test.mjs`, `plugin/test/*.test.mjs`).

import fs from "node:fs";
import path from "node:path";

/** Compile one `/`-segment `*` wildcard to an anchored regex (`*` never crosses `/`). */
function globSegmentToRegex(seg: string): RegExp {
  const escaped = seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

/** Expand one glob pattern (each `/`-segment MAY contain `*`) against `root`, returning absolute
 * paths. Supports exactly the whole-segment-wildcard shape scripts/test.sh uses. */
export function expandGlob(pattern: string, root: string): string[] {
  const segments = pattern.split("/");
  let current = [root];
  for (const seg of segments) {
    if (!seg.includes("*")) {
      current = current.map((dir) => path.join(dir, seg)).filter((p) => fs.existsSync(p));
      continue;
    }
    const re = globSegmentToRegex(seg);
    const next: string[] = [];
    for (const dir of current) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        entries = [];
      }
      for (const e of entries) {
        if (re.test(e)) next.push(path.join(dir, e));
      }
    }
    current = next;
  }
  return current.filter((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}
