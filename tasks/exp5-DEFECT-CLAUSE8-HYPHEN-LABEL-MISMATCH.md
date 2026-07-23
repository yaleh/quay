---
id: exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH
title: "defect: it0-dod-check.ts clause8 regex doesn't match the repo's actual
  milestone:M-NN (hyphenated) label convention"
status: todo
labels:
  - milestone-candidate
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Found by the M115 adversarial audit (`milestones/M115/audits/iteration-0-acceptance-audit.md`,
"Overall verdict" section, final bullet): `it0-dod-check.ts`'s clause8
(`task-canonical-lifecycle-record`) regex `/milestone:M(\d+)/i` requires digits IMMEDIATELY after
`M`, but the repo's ACTUAL, established `milestone:M-NN` label convention (confirmed present on
`exp5-M-ARCH-AUDIT-POST-FULL-TS.md` as `milestone:M-113`, and used by this session on M114/M115 as
`milestone:M-114`/`milestone:M-115`) has a HYPHEN between `M` and the number. The regex never
matches any task using the real convention, so clause8 has silently reported every such task as
"no milestone:M<N> label found — legacy/unlabeled" (the N/A-legacy path) since its introduction —
never actually exercising the cutover-check logic it was built for. This is non-blocking (N/A is
still a PASS disposition) but means clause8 has likely never fired its real check against a single
real task in this repo's history.

## Plan
N/A — a one-line regex fix (`/milestone:M-?(\d+)/i` or equivalent) plus re-running the fixture
selfcheck (`dod-fixture-selfcheck.sh`) to confirm no regression, then spot-checking clause8 actually
applies (not N/A) against a real `milestone:M-<N>`-labeled task with N ≥ the cutover number.

## Acceptance Criteria
- [ ] `it0-dod-check.ts`'s clause8 regex matches BOTH `milestone:M113` and `milestone:M-113` forms.
- [ ] Re-run against a real task carrying `milestone:M-<N>` (N ≥ cutover) and confirm clause8 actually APPLIES (not N/A) — pasted output.
- [ ] `dod-fixture-selfcheck.sh` still 17/17 (or current count) PASS after the fix (golden-diff, no other clause's verdict changes).

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [ ] All 3 AC items above verified true with pasted command output.
- [ ] it0 DoD meta-enforcer passes all clauses.




## Not selected (M116)

Not selected M116 — exp5-M-TS-MIGRATION-P5-A selected instead (capability-growth: real product TS migration work, diversifying value type from the last two governance-integrity/instrument-correction picks M114/M115). Good next pick.