# ADR-020: Runtime-contract ground-truth registry for PlanAuthor/PlanCheck

**Status:** proposed
**Date:** 2026-08-01
**Related:** [[ADR-019]], DIR-124-B, DIR-124-D, DIR-124-F, inherited-core.md `evidenceSurface`

## Context

The prepare-milestone pipeline's PlanAuthor writes a grounded plan, and PlanCheck verifies
it against the live repo. Across the 2026-07-31 → 2026-08-01 product-task batch, PlanCheck
repeatedly found the SAME classes of defect, each a repo-runtime-contract fact the PlanAuthor
did not know and had to be told via per-task "grounded facts" added to task bodies:

| Fact class | Frequency |
|---|---|
| CLI binary path is `quay.ts` not `quay.js` | 5+ |
| Node `--test --experimental-test-coverage` prints basename rows with no `%` | 3+ |
| Touches entry/count matching (parentheticals break exact-path match) | 4+ |
| Exact line/callsite counts | 4+ |
| Runtime contract vs Proposal assumption (provider env defaults, module signatures) | 3+ |

Each task pays the full cost of a failed PlanCheck round + a grounding-fact fix. The facts
are repo-invariant, not task-specific — they belong in ONE shared, versioned place, injected
into the PlanAuthor/PlanCheck context, not re-discovered per task.

## Decision

Adopt a **runtime-contract ground-truth registry** as a first-class, versioned, machine-
readable reference that the prepare-milestone workflow injects into PlanAuthor and PlanCheck
prompts. It is:

1. **A factual invariant registry** (CLI paths, tool output formats, module signatures,
   provider runtime defaults) — distinct from DIR-124-D's ExecutionPolicy registry (which
   owns task-class → routing/gate/test/audit/resource POLICY, not repo facts).
2. **Versioned + hash-bound** per DIR-124-B's receipt discipline: the registry version/hash
   is bound into each StageReceipt, and a version change invalidates affected receipts.
3. **Feeding a learning loop**: a PlanCheck finding classified as `grounded-fact-gap`
   (repo-invariant, not task-specific) is promoted into the registry with a version bump —
   it never needs to be re-discovered by a later task.
4. **Persisted in two layers**:
   - **ADR** for DECISIONS (e.g. "github missing QUAY_GITHUB_REPO → warn because
     resolveRepo() defaults to yaleh/quay" is a product-semantics decision + rationale);
   - **registry** for FACTS (e.g. "CLI is packages/quay/bin/quay.ts" is reference data, not
     a decision).

## Consequences

- **Positive**: PlanAuthor starts with the repo's actual contracts, eliminating the recurring
  first-attempt failure classes; facts are single-sourced, versioned, and hash-bound; the
  learning loop makes the pipeline smarter over time (the crystallization direction).
- **Negative**: a new registry to maintain; the injection adds prompt context; facts that
  change require a version bump + receipt invalidation.
- **The `inherited-core.md` `evidenceSurface` section (2026-08-01) is the first concrete
  instance of this pattern** and should migrate into the registry rather than remaining a
  prose section.

## Implementation

Owned by [[DIR-124-F]]. Seed the registry with the five recurring fact classes above and the
`evidenceSurface` content. Inject into `prepare-milestone.js` PlanAuthor/PlanCheck prompts.
Promote `grounded-fact-gap` findings via the proposal-convergence finding-ledger.
