// shape-sections.ts — SINGLE SOURCE of the shape section-heading lists (which headings count as
// proposal / plan / ac / dod per task shape). Imported by BOTH packages/quay-native/src/store.ts
// (the product judge, `SHAPE_REGISTRY[shape].sections`) and plugin/scripts/ready-pool-check.ts
// (the methodology judge, `SHAPE_SECTIONS[shape]`) — gap-shape-section-tables-dual-copy-no-
// single-source.
//
// ── WHY IT LIVES IN `kernel/` (the reachability argument, both sides) ────────────────────────────
// This file used to live at `plugin/scripts/shape-sections.ts`, and the reason recorded there was:
// "quay-init lays the mechanism layer into every consumer project but NOT the `packages/` source
// tree, so a laid-down ready-pool-check.ts can only reach a sibling plugin/scripts file." That
// reason is FALSE for this module's current consumers, and the move to `kernel/` is what makes the
// replacement argument true:
//   · MECHANISM side: `plugin/scripts/shape-sections.ts` is now a re-export of THIS file, so the
//     sibling `./shape-sections.ts` specifier every laid-down methodology tool already uses keeps
//     resolving. In the SHIPPED artifact the plugin bundler
//     (packages/quay/scripts/build-plugin-dist.mjs, `coreSrcAliasPlugin`) re-points every
//     `packages/quay/src/**` specifier coming from a plugin source onto the real Core source tree
//     and INLINES it into the bundle — so `dist/ready-pool-check.js` carries these tables itself
//     (it always did: the pure-data file was inlined) and a consumer needs no `packages/` tree for
//     the tasks the consumer actually runs.
//   · PRODUCT side: `packages/quay-native/src/store.ts` imports this file directly. Before the
//     move, that import was a `packages/**` → `plugin/**` edge — the product reverse-importing the
//     mechanism layer — and it resolved only because esbuild inlined the plugin file into the
//     self-contained dist bundle. A kernel home makes it an in-package import.
// A kernel file may import nothing outside `kernel/` except bare specifiers (node:*, npm) — this
// one has ZERO imports, which is the strongest form of that property. Checked by
// `plugin/scripts/import-graph-check.ts` (the conditional fourth rule: `kernelChecked`).
//
// PURE DATA — no imports, no logic. It must stay that way: this is the one module both judges read,
// so any logic here runs in the product bundle as well as the methodology layer.

/** AC/DoD SUFFIXED-HEADING VARIANTS (gap-ac47-completion-predicate-consumer-fail-closed, AC3):
 *  suffixed AC/DoD headings real directive tasks use — `## Acceptance Criteria (runnable)`,
 *  `## Acceptance Criteria (runnable — artifacts are necessary-not-sufficient)`, `## Definition of
 *  Done — REAL LANDING is the bar, not artifacts`, `## Definition of Done — REAL LANDING,
 *  subtractive (…)`. Explicitly REGISTERED rather than prefix-matched — a prefix would ALSO swallow
 *  `## Acceptance Criteria for the OLD design`. An UNREGISTERED suffixed variant is NOT matched and
 *  fails CLOSED. */
export const AC_SUFFIX_VARIANTS = [
  "Acceptance Criteria (runnable)",
  "Acceptance Criteria (runnable — artifacts are necessary-not-sufficient)",
] as const;
export const DOD_SUFFIX_VARIANTS = [
  "Definition of Done — REAL LANDING is the bar, not artifacts",
  "Definition of Done — REAL LANDING, subtractive (DIR-026 Reading A preserved)",
] as const;

/** Finding-shape DRAFT-HEADING variants (gap-todo-shape-mismatch-author-gate): `## AC（draft）` /
 *  `## DoD（draft）` (and half-width-paren form) that real finding-shape gap-* tasks use. The
 *  `（draft）` suffix is a heading-label convention, not an absent section — the four-artifacts gate
 *  must count them. Registered on the FINDING shape only. */
export const FINDING_AC_DRAFT_VARIANTS = ["AC（draft）", "AC (draft)"] as const;
export const FINDING_DOD_DRAFT_VARIANTS = ["DoD（draft）", "DoD (draft)"] as const;

/** The four-artifact section heading lists per shape (contract → finding → plan → proposal). A
 *  `finding`-shape task has NO plan dimension; a `contract`-shape task uses `## Contract` as its plan
 *  artifact; the proposal-slot of a `contract`-shape task is `## 人的裁定` (the directive-variant
 *  proposal-slot, DIR-123-aarch64 / gap-cli-quay-init-collides), of a `finding`-shape task is
 *  `## Finding`. */
export const SHAPE_SECTIONS = {
  contract: {
    proposal: ["Proposal", "人的裁定"],
    plan: ["Contract"],
    ac: ["AC", "Acceptance Criteria", ...AC_SUFFIX_VARIANTS],
    dod: ["DoD", "Definition of Done", ...DOD_SUFFIX_VARIANTS],
  },
  finding: {
    proposal: ["Finding"],
    ac: ["AC", "Acceptance Criteria", ...FINDING_AC_DRAFT_VARIANTS, ...AC_SUFFIX_VARIANTS],
    dod: ["DoD", "Definition of Done", ...FINDING_DOD_DRAFT_VARIANTS, ...DOD_SUFFIX_VARIANTS],
  },
  plan: {
    proposal: ["Proposal"],
    plan: ["Plan"],
    ac: ["AC", "Acceptance Criteria", ...AC_SUFFIX_VARIANTS],
    dod: ["DoD", "Definition of Done", ...DOD_SUFFIX_VARIANTS],
  },
  proposal: {
    proposal: ["Proposal"],
    ac: ["AC", "Acceptance Criteria", ...AC_SUFFIX_VARIANTS],
    dod: ["DoD", "Definition of Done", ...DOD_SUFFIX_VARIANTS],
  },
} as const;
