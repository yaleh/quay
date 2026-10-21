// ac-checkbox-count.ts — the ONE AC/DoD GFM checkbox counter, a kernel leaf.
//
// ── THE DEFECT THIS CLOSES (task gap-three-pure-judges-kernel-single-def, AC-909) ───────────────
// `countAcCheckboxes` existed as TWO byte-identical definitions that shared no import edge:
//   · `packages/quay/src/task-parsing.ts`   — the product-side copy (native store / MCP task_check)
//   · `plugin/scripts/task-schema.ts`       — the mechanism-side copy (re-exported by
//     task-status-drift-check.ts and consumed by stale-ready-audit / worker-driver / slot-refill /
//     task-ac-carryover-check / ready-pool-check)
// They were pinned together only BEHAVIORALLY (`plugin/test/task-parsing-parity.test.mjs`), so a
// semantics change landed on one side only would have been caught by that test — but the structural
// root cause (two bodies to edit) survived. This module removes it.
//
// ── WHY IT LIVES IN `kernel/` (the reachability argument, both sides) ────────────────────────────
// The product layer may NOT import the mechanism layer (`packages/**` → `plugin/**` is the reverse
// edge `plugin/scripts/import-graph-check.ts` ratchets at 0), and the mechanism layer previously
// could not statically import `packages/quay/src/**` — the claim that it could not is STALE:
// `packages/quay/scripts/build-plugin-dist.mjs`'s `coreSrcAliasPlugin` re-points every
// `packages/quay/src/**` specifier onto the real Core source tree and INLINES it into `dist/*.js`
// (precedent: `plugin/scripts/ready-pool-check.ts` statically imports
// `../../packages/quay/src/kernel/task-shape-artifacts.ts` and ships). `kernel/` is the one
// location BOTH layers can legally import: a kernel file may import nothing outside `kernel/` except
// bare specifiers (`node:*`, npm), so this module has no back-edge and cannot create a cycle.
//
// PURE LOGIC — no imports at all. Side-effect-free by contract.

/**
 * Count GFM checkboxes (`- [ ]` / `- [x]` / `- [X]` / `- [~]`) in an AC/DoD section body.
 *
 * `[~]` (partial) counts in `total` but as UNCHECKED — the semantics the four historical counters
 * disagreed on (gap-ac-checkbox-counting-four-counters-drifted). ZERO checked could NOT have passed
 * the gate as written.
 *
 * FAIL-CLOSED (gap-ac47-completion-predicate-consumer-fail-closed, AC1): an ABSENT / UNREADABLE
 * section (null) must NOT read as `{ unchecked: 0 }`. `sectionFound:false` is the distinguishable
 * state for readers that check it; `total: NaN` is the STRUCTURAL guarantee that OLD destructuring
 * read-patterns (`const { total, checked } = …`) cannot obtain a pass (`total === 0` and
 * `checked === total` are both FALSE for NaN), so every pre-existing consumer fails CLOSED without
 * being edited.
 */
export function countAcCheckboxes(acSection) {
  if (acSection == null) {
    return { total: NaN, checked: NaN, unchecked: NaN, sectionFound: false };
  }
  const boxes = acSection.match(/^\s*-\s+\[(.)\]/gm) ?? [];
  let checked = 0;
  for (const b of boxes) if (/\[[xX]\]/.test(b)) checked++;
  return { total: boxes.length, checked, unchecked: boxes.length - checked, sectionFound: true };
}
