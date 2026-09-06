// shape-sections.ts — SINGLE SOURCE of the shape section-heading lists (which headings count as
// proposal / plan / ac / dod per task shape). Imported by BOTH packages/quay-native/src/store.ts
// (the product judge, `SHAPE_REGISTRY[shape].sections`) and plugin/scripts/ready-pool-check.ts
// (the methodology judge, `SHAPE_SECTIONS[shape]`) — gap-shape-section-tables-dual-copy-no-
// single-source.
//
// WHY THIS FILE LIVES IN plugin/scripts/ (not packages/quay-native/src/): quay-init lays the
// mechanism layer (plugin/scripts/ + workflows/agents/probes/loop) into every consumer project, but
// NOT the packages/ source tree (consumers carry only the vendored dist bundle, no packages/). So a
// laid-down ready-pool-check.ts cannot `import` anything under packages/ — the consumer has no such
// tree and dies with ERR_MODULE_NOT_FOUND (the first, rejected, direction imported store.ts from
// ready-pool-check.ts). The section lists therefore live HERE, where a laid-down ready-pool-check.ts
// reaches them via a sibling `./shape-sections.ts`, and store.ts reaches them via a relative path
// that esbuild INLINES into the self-contained dist bundle (so the product bundle stays standalone).
//
// PURE DATA — no imports, no logic. It must stay that way: any import here becomes a transitive
// laydown dependency (closure step (d) only sees `${SCRIPT_DIR}/` shell refs, not ESM `./`), and any
// methodology machinery imported here would leak into the product bundle via store.ts.

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
