// path-ref.ts — SINGLE SOURCE of the "path reference → repo-relative key" step: forward-slash the
// separators and drop a leading `./`. Routine `semantic-dedup-scan` finding `normalize-touched`
// (runId `semantic-dedup-scan-1793051606259`), task
// gap-routine-semantic-dedup-scan-normalize-touched.
//
// The finding's three instances were the SAME body under two names, re-declared across the
// layer boundary:
//   · `plugin/scripts/suite-bucket-hub-list.ts`      `normalizeTouched`  — + `.trim()`
//   · `plugin/scripts/suite-bucket-select.ts`        `normalizeTouched`  — + `.trim()`
//   · `packages/quay/src/serve/feat/serve-tests.ts`  `normalizeFileRef`  — no trim
// The rename is what hid the pair from name-based scans; only a body digest could see it.
//
// ── WHY IT LIVES IN `kernel/` (the reachability argument, both sides) ────────────────────────────
// The direction must be `plugin → kernel`. The same implementation CANNOT live in
// `plugin/scripts/**` and be imported by the product side: `packages/**` importing `plugin/**` is the
// REVERSE EDGE that `plugin/scripts/import-graph-check.ts`'s `reverseEdges` ratchet (baselined at 0)
// forbids. So the kernel leaf is the one placement both layers reach: the product side imports it
// in-package (`../../kernel/path-ref.ts`), the mechanism side imports it across the tree
// (`../../packages/quay/src/kernel/path-ref.ts`). Same shape as `kernel/load-avg.ts`,
// `kernel/env-merge.ts` and `kernel/regex-escape.ts`.
//
// ── WHY THERE IS NO `trim()` HERE (the "explicit per caller" half of the finding's action) ───────
// The two plugin copies trimmed; the serve copy did not. Folding `.trim()` into the leaf would
// SILENTLY change the product-side key (a file ref carrying surrounding whitespace would start
// matching an artifact row it does not name), and dropping it would silently change the two
// plugin-side judgments. Trim is therefore the CALLER's decision and is written at the call site:
//
//   normalizePathRef(x).trim()   ← suite-bucket-hub-list.ts / suite-bucket-select.ts
//   normalizePathRef(x)          ← serve/feat/serve-tests.ts
//
// ⛔ NOT UNIFIED HERE (硬规则 5b: after fixing one instance, enumerate the OTHER sites carrying the
// same principle and dispose of each, rather than silently leaving them). Measured on develop
// 2026-10-27: 18 hits for `replace(/\\/g, "/")` across plugin/packages/scripts (excluded: `dist/`,
// `node_modules/`, `*.test.*`). Dispositions:
//   · UNIFIED — the three finding instances above, plus two more carrying the byte-identical
//     predicate: `plugin/scripts/deletion-closure-check.ts` (`aliasesOf`) and
//     `plugin/scripts/suite-bucket-drift-check.ts` (`checkTruthSelection`). 5 sites → 1.
//   · DIFFERENT PREDICATE, deliberately kept: `plugin/scripts/gate-script-base.ts` `normalizeRel`
//     (also drops empty/`.` segments, resolves `..`, strips a trailing `/`) — it is the STRICTER
//     normalizer and lives in `plugin/`, so Core cannot reach it at all; this leaf must not merge
//     with it without changing what "repo-relative" means for either caller.
//   · DIFFERENT PREDICATE, deliberately kept: `plugin/scripts/driver-filters.ts` (`isDiscardableSurfacePath`)
//     and `plugin/scripts/select-static-checks-for-touches.ts` (`isDocPath`) — they form the
//     leaf's key and THEN strip a trailing `/`; that extra rule is theirs, not the leaf's.
//   · BACKSLASH-ONLY (no `./` rule, so not this predicate): `known-load-sensitive.ts`,
//     `fan-in-workflow-retirement-check.ts`, `main-thread-edit-check.ts`, `precommit-guard.ts`,
//     `state-worded-clause-check.ts`, `tick-core-static-check.ts`, `worker-fan-in.ts`,
//     `plugin/test/helpers/fan-in-execute-paths-harness.mjs`.
//
// KERNEL BOUNDARY (import-graph-check 第四规则): this file imports NOTHING — it is a leaf, so it can
// never participate in a value or type cycle. In the SHIPPED artifact the plugin bundler
// (`packages/quay/scripts/build-plugin-dist.mjs`, `coreSrcAliasPlugin`) re-points the plugin-side
// specifier onto the real Core source and INLINES this file into each consumer's bundle.

/**
 * Normalize a path reference to its repo-relative key form: `\` → `/` and a leading `./` removed.
 *
 * ⛔ Deliberately does NOT trim, collapse `..`, or strip a trailing `/` — callers that need any of
 * those apply it explicitly (see the header). `String(p)` is kept from the former copies so a
 * non-string reference degrades the same way it always did rather than throwing.
 */
export function normalizePathRef(p: string): string {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}
