---
id: gap-discovery-coverage-map-from-findings
title: Capability Coverage Map over user-named domains, graded only by concrete
  findings + operations (prompt/teaching mentions never count)
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-portfolio-value-evidence-ledger
---
## Proposal
(B) of the 2026-10-12 strategy change: a Capability Coverage Map over the domains the user named:
- shared semantics;
- config→behavior;
- writer/checker contract;
- state transitions;
- reuse refutation;
- method trustworthiness.

A domain counts as covered only by concrete evidence: a portfolio Finding plus the investigation operation that produced it. It never counts because a case appeared in a prompt, a seed or a teaching set.

The operator baseline (`/data/home/yale/work/quay-scratch/portfolio-demo/REPORT.md`) suggests:
- autonomous coverage exists for shared semantics (F02, F03, F04, F06), writer/checker contract (F01, F05) and reuse refutation (N01);
- config→behavior and method trustworthiness are covered only by operator work;
- state transitions have no autonomous hit: the blind run mispredicted `HX-needs-human-transition-three-copies`.

## Plan
1. In `docs/analysis/discovery-portfolio.mjs`, add `coverageMap(root)`. It is derived, not stored, from `.quay/discovery-portfolio.jsonl` and the method registry. For each domain it reports:
   - findings by origin and evidence level;
   - the operations that produced them (verifier call, routine probe, instrument);
   - methods whose `applicability` claims the domain, with their trust state (active/draft/retired, contaminated or not);
   - a coverage grade: `autonomous` (≥1 supported autonomous `independent`/`production-open` finding with a landed fix), `assisted` (operator/user/teaching only), or `none`.
2. A finding gets its domain from an explicit `domain` field on the portfolio record, set at ingest with a reason. A missing domain ⇒ `unclassified`, reported, never guessed.
3. A case named only in a prompt, seed, sealed label or teaching Experience never raises a grade. The map refuses evidence whose `evidence_level` is `teaching` for the `autonomous` grade.
4. Retired or contaminated methods contribute no coverage.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-portfolio.test.mjs` exits 0 with new cases:
  - (a) a teaching-level supported finding yields `assisted`, never `autonomous`;
  - (b) a contaminated or retired method adds nothing;
  - (c) an unclassified finding is reported as `unclassified`;
  - (d) one autonomous production-open supported finding with a landed fix yields `autonomous`.
- [ ] Real map from the production portfolio (requires `gap-discovery-portfolio-value-evidence-ledger`). Paste the per-domain grade, the backing finding ids and operations, and the gap list (domains not `autonomous`).
- [ ] Mutation control: let teaching evidence count toward `autonomous` and show case (a) goes red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-coverage-map-from-findings` green.

## Touches
- tasks/gap-discovery-coverage-map-from-findings.md
- docs/analysis/discovery-portfolio.mjs
- plugin/test/discovery-portfolio.test.mjs
