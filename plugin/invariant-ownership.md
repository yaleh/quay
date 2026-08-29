# Invariant-Ownership Manifest

Single source of truth for invariant-to-owner assignment across the installed milestone workflow.
Every load-bearing invariant names exactly ONE intended executable owner. Every other occurrence is
classified (compatibility-adapter, dsl-necessity-mirror, generated-view, or duplicate-to-remove).

**Schema (v1):** each `## Invariant:` block must contain:
- `**Rule:**` — one-sentence invariant statement
- `**Authoritative owner:**` — exactly one `` `<repo-root-relative-path>` `[authoritative]` ``
- `**Other occurrences:**` (optional) — classified occurrences with rationale

Classifications: `[authoritative]` (exactly one per invariant), `[compatibility-adapter]`,
`[dsl-necessity-mirror]`, `[generated-view]`, `[duplicate-to-remove]`.

This manifest is self-hosting: its own entries are validated by the enforcement script on every DoD check.

---

## Invariant: invariant-ownership-manifest
- **Rule:** The invariant-ownership manifest is the single source of truth for invariant-to-owner assignment.
- **Authoritative owner:** `experiments/quay-perpetual-stream/invariant-ownership.md` `[authoritative]`
- **Other occurrences:**
  - `plugin/invariant-ownership.md` `[compatibility-adapter]` -- distribution copy for plugin installs

## Invariant: invariant-ownership-enforcement
- **Rule:** The invariant-ownership enforcement script validates the manifest structurally on every DoD check (Clause 13).
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/workflow-invariant-ownership.mjs` `[authoritative]`
- **Other occurrences:**
  - `plugin/scripts/workflow-invariant-ownership.mjs` `[compatibility-adapter]` -- distribution copy for plugin installs

## Invariant: dod-clause-13-invariant-ownership
- **Rule:** it0-dod-check.ts Clause 13 shells out to workflow-invariant-ownership.mjs on every DoD check (unconditional).
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts` `[authoritative]`

---

## Invariant: gate-resolve-milestone-root
- **Rule:** gate_resolve_milestone_root (gate-script-lib.sh:152) is the canonical >=130 boundary function; all path resolution goes through it.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/gate-script-lib.sh` `[authoritative]`
- **Other occurrences:**
  - `plugin/scripts/gate-script-lib.sh` `[compatibility-adapter]` -- distribution copy

---

## Invariant: build-evidence-collection
- **Rule:** Build evidence (test results, file manifests) is collected by build-evidence-collector.ts per the build-evidence-manifest.ts evidence schema (composite-contracts.ts was retired at gap-retire-the-prepare-execute-pipeline-cluster).
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts` `[authoritative]`

---

## Invariant: dod-clause-enumeration
- **Rule:** The 15 DoD clauses (0-14) are the single executable enforcer defined in it0-dod-check.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts` `[authoritative]`
- **Other occurrences:**
  - `docs/references/inherited-core.md` `[generated-view]` -- prose description of the DoD clauses; the executable enforcer is authoritative

## Invariant: vmeta-consolidation-lag
- **Rule:** V_meta consolidation-lag is checked by vmeta-lag-check.ts, invoked by the Gate phase.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts` `[authoritative]`

## Invariant: line-budget-cap
- **Rule:** The 2000-line charter cap is enforced by it0-ceiling-line-budget-check.sh.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh` `[authoritative]`

## Invariant: dashboard-line-budget-cap
- **Rule:** The 1200-line dashboard cap is enforced by it0-dashboard-line-budget-check.sh.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh` `[authoritative]`

## Invariant: tree-hygiene
- **Rule:** Tree hygiene (no stray files outside expected paths) is enforced by tree-hygiene-check.sh.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` `[authoritative]`

## Invariant: worktree-branch-hygiene
- **Rule:** Worktree and branch hygiene (no stale worktrees/branches) is enforced by worktree-branch-hygiene-check.sh.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh` `[authoritative]`

## Invariant: split-or-commit-whole-store
- **Rule:** SPLIT-OR-COMMIT whole-store scan (PARENT-DONE-IFF-CHILDREN, child-link-symmetry, SELECT-split) is enforced by it0-split-or-commit-check.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts` `[authoritative]`

## Invariant: build-evidence-gate
- **Rule:** Build-evidence structural completeness is checked by build-evidence-gate.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts` `[authoritative]`

## Invariant: gate-hash-byte-for-byte
- **Rule:** Gate hash byte-for-byte verification is enforced by it0-gate-hash-check.sh.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh` `[authoritative]`

## Invariant: dogfood-evidence
- **Rule:** Dogfood evidence (quay used to build quay) is checked by it0-dogfood-evidence-gate.sh.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh` `[authoritative]`

## Invariant: enforcement-with-design
- **Rule:** Enforcement-with-design (mechanical enforcement backed by design documentation) is checked by it0-enforcement-with-design-check.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts` `[authoritative]`

---

## Invariant: dashboard-backlog-regeneration
- **Rule:** Dashboard and backlog regeneration after Land is performed by it0-backlog-regen.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-backlog-regen.ts` `[authoritative]`

## Invariant: task-schema-v1-marker
- **Rule:** Task schema v1 marker (extra.schema: "v1") is the single canonical task schema definition, validated by task-schema-check.sh + task-schema.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/task-schema.ts` `[authoritative]`

## Invariant: schema-v1-marker-enforcement
- **Rule:** The schema v1 marker is mechanically enforced by task-schema-check.sh (shells out to checkTask).
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/task-schema-check.sh` `[authoritative]`

---

## Invariant: concurrent-touches-orthogonality
- **Rule:** Concurrent batch touches-orthogonality is checked by touches-orthogonality-check.ts before dispatch.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.ts` `[authoritative]`

## Invariant: concurrent-fan-in-sole-merge-owner
- **Rule:** In concurrent dispatch mode, the fan-in (OUTER-LOOP.md step g) is the SOLE merge owner — only it merges worktree branches.
- **Authoritative owner:** `experiments/quay-perpetual-stream/OUTER-LOOP.md` `[authoritative]`

---

## Invariant: human-steered-classification
- **Rule:** Human-steered task classification (exclusion of human-steered tasks from autonomous SELECT) is performed by human-steered-classify.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/human-steered-classify.ts` `[authoritative]`

## Invariant: deliverable-classification
- **Rule:** Deliverable classification (governor gate for SELECT) is performed by deliverable-governor.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/deliverable-governor.ts` `[authoritative]`

## Invariant: explore-exploit-cadence
- **Rule:** Explore/exploit cadence (>=1 explore per 5 milestones) is computed by explore-exploit-cadence.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/explore-exploit-cadence.ts` `[authoritative]`

## Invariant: drain-before-select
- **Rule:** Directives must be drained before SELECT runs; enforced by drain-scheduler.ts + drain-directives.js.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts` `[authoritative]`

## Invariant: halt-sentinel-check
- **Rule:** The .halt sentinel is read via the unified three-layer check point halt-check.sh (SPEC 2.8, orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md §2.8).
- **Authoritative owner:** `plugin/scripts/halt-check.sh` `[authoritative]`
- **Other occurrences:**
  - `CLAUDE.md` `[generated-view]` -- prose description of halt behavior; the executable check is authoritative
  - `experiments/quay-perpetual-stream/OUTER-LOOP.md` `[generated-view]` -- prose description of halt behavior

## Invariant: candidate-synthesis-portfolio
- **Rule:** Candidate synthesis and portfolio choice for SELECT are computed by candidate-synthesis.ts + portfolio-choice.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/candidate-synthesis.ts` `[authoritative]`

---

## Invariant: out13-not-point-baime-at-stream
- **Rule:** I1 (not-point-baime-at-stream): BAIME experiments must not point directly at the perpetual stream; enforced by discipline (OUTER-LOOP.md prose).
- **Authoritative owner:** `experiments/quay-perpetual-stream/OUTER-LOOP.md` `[authoritative]`

## Invariant: out13-not-perturb-inflight
- **Rule:** I2 (not-perturb-inflight): The loop must not perturb in-flight milestones; enforced by .halt sentinel + discipline.
- **Authoritative owner:** `experiments/quay-perpetual-stream/OUTER-LOOP.md` `[authoritative]`

## Invariant: out13-gate-text-transclusion
- **Rule:** I3 (gate-text-transclusion-or-hash): Gate text must be either transcluded or hash-pinned; enforced by it0-gate-hash-check.sh.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh` `[authoritative]`

## Invariant: out13-drain-before-select
- **Rule:** I4 (drain-before-select): Directives must be drained before SELECT; enforced by drain-scheduler.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts` `[authoritative]`

## Invariant: out13-master-direct
- **Rule:** I5 (master-direct): All work lands directly on master unless under worktree isolation; enforced by restart-readiness-check.sh.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh` `[authoritative]`

## Invariant: out13-halt-sentinel
- **Rule:** I6 (halt-sentinel): The .halt sentinel pauses the loop at the next milestone boundary; mechanically enforced by the unified check point halt-check.sh.
- **Authoritative owner:** `plugin/scripts/halt-check.sh` `[authoritative]`

## Invariant: out13-not-self-tick
- **Rule:** I7 (not-self-tick): The loop must not self-tick (DIR-020); enforced by discipline only.
- **Authoritative owner:** `experiments/quay-perpetual-stream/OUTER-LOOP.md` `[authoritative]`

## Invariant: out13-explore-cadence
- **Rule:** I8 (explore >=1 per 5): At least 1 explore milestone per 5 total; enforced by explore-exploit-cadence.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/explore-exploit-cadence.ts` `[authoritative]`

## Invariant: out13-split-or-commit
- **Rule:** I9 (split-or-commit): SPLIT-OR-COMMIT whole-store scan enforced by it0-split-or-commit-check.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts` `[authoritative]`

## Invariant: out13-schema-v1-marker
- **Rule:** I10 (schema-v1 marker): Every task must carry schema v1 marker; enforced by task-schema-check.sh.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/task-schema-check.sh` `[authoritative]`

## Invariant: out13-deliverable-governor
- **Rule:** I11 (deliverable-governor SOFT): Deliverable classification is advisory (SOFT gate); enforced by deliverable-governor.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/deliverable-governor.ts` `[authoritative]`

## Invariant: out13-human-steered-exclude
- **Rule:** I12 (human-steered EXCLUDE): Human-steered tasks are excluded from autonomous SELECT; enforced by human-steered-classify.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/human-steered-classify.ts` `[authoritative]`

## Invariant: out13-file-only-routines
- **Rule:** I13 (FILE-ONLY routines output): Routine output must be file-only; enforced by routine-file-gate.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/routine-file-gate.ts` `[authoritative]`

## Invariant: out13-task-canonical-directives
- **Rule:** I14 (task-canonical directives): Directives are task-canonical (DIR-028); enforced by drain-scheduler.ts.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts` `[authoritative]`

## Invariant: out13-parent-done-iff-children
- **Rule:** I15 (parent-done iff children-done): Parent task is done iff all children are done; enforced by it0-split-or-commit-check.ts child-link-symmetry.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts` `[authoritative]`

## Invariant: out13-sentinel-removal-idempotent
- **Rule:** I16 (sentinel-removal-idempotent): Sentinel removal must be idempotent; enforced by restart-readiness-check.sh.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh` `[authoritative]`

---

## Invariant: extractSection-canonical-parser
- **Rule:** extractSection (task-schema.ts:73-83) is the single canonical section parser used by it0-dod-check.ts, drain-scheduler.ts, proposal-convergence.ts, and workflow-invariant-ownership.mjs.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/task-schema.ts` `[authoritative]`
