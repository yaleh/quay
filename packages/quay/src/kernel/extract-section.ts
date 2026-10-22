// extract-section.ts — the ONE depth-aware `## Heading` → body slicer, a kernel leaf.
//
// ── THE DEFECT THIS CLOSES (task gap-routine-semantic-dedup-scan-extract-section-byte-identical) ──
// `extractSection` existed as TWO byte-identical definitions that shared no import edge:
//   · `packages/quay/src/task-parsing.ts` — the product-side copy (native store / MCP `task_check`)
//   · `plugin/scripts/task-schema.ts`     — the mechanism-side copy (parseTask / readDependsOn /
//     task-status-drift-check / it0-dod-check / select-tests-for-touches / regenerate-backlog-view)
// A routine `semantic-dedup-scan` finding (`extract-section-byte-identical`, runId
// `semantic-dedup-scan-1792647604889`) reported the pair as `real-duplication`: same
// `escapeRegExp` call, same `stopRe` logic different only in indentation/comment prose. They were
// pinned together only BEHAVIORALLY (`plugin/test/task-parsing-parity.test.mjs`), so the structural
// root cause — two bodies to edit — survived a semantics change landing on one side only. This
// module removes it, following the identical reduction that `kernel/ac-checkbox-count.ts` performed
// for the sibling judge (task gap-three-pure-judges-kernel-single-def, AC-909).
//
// ── WHY IT LIVES IN `kernel/` (the reachability argument, both sides) ────────────────────────────
// The product layer may NOT import the mechanism layer (`packages/**` → `plugin/**` is the reverse
// edge `plugin/scripts/import-graph-check.ts` ratchets at 0). The kernel is the one location BOTH
// layers can legally import: a kernel file may import nothing outside `kernel/` except bare
// specifiers (`node:*`, npm), so this module has no back-edge and cannot create a cycle. It ships
// self-contained — `packages/quay/scripts/build-plugin-dist.mjs`'s `coreSrcAliasPlugin` re-points
// every `packages/quay/src/**` specifier onto the real Core source tree and INLINES it into
// `dist/*.js` (the SAME route the sibling `kernel/ac-checkbox-count.ts` already takes through
// `plugin/scripts/task-schema.ts`).
//
// PURE LOGIC — imports one kernel leaf (`regex-escape.ts`), no fs, no node builtins, no side
// effects. Both the product bundle and the methodology layer run the SAME function object.

import { escapeRegExp } from "./regex-escape.ts";

/**
 * Depth-aware section extractor. Match the heading line, capture
 * its `#` depth, stop the body at the next line whose heading is at the SAME OR SHALLOWER depth (so a
 * `## X` section extends through its nested `### ` subheadings and stops only at the next `## ` or
 * shallower — never silently truncated).
 *
 * `heading` is matched LITERALLY: it is escaped through the kernel's `escapeRegExp` before it is
 * interpolated into the heading regex. Without that, a heading carrying a regex metacharacter would be
 * read as a pattern — `Plan (draft)` would become the capture group `Plan draft` and never match the
 * literal `## Plan (draft)` line, and an unbalanced `(` would throw at `new RegExp`. Escaping is a
 * no-op for the plain section names most callers pass, so their behavior is unchanged; the
 * metacharacter-heading case is pinned by plugin/test/task-parsing-parity.test.mjs. (Task
 * gap-extract-section-heading-interpolated-unescaped-into-regexp.)
 */
export function extractSection(fullText, heading) {
  const headingLineRe = new RegExp(`^(##+)\\s*${escapeRegExp(heading)}\\s*$`, "im");
  const headingMatch = fullText.match(headingLineRe);
  if (!headingMatch) return null;
  const depth = headingMatch[1].length;
  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = fullText.slice(startIdx);
  const stopRe = new RegExp(`^#{1,${depth}}\\s`, "m");
  const stopMatch = rest.match(stopRe);
  return stopMatch ? rest.slice(0, stopMatch.index) : rest;
}
