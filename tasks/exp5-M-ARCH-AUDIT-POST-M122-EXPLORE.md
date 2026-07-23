---
id: exp5-M-ARCH-AUDIT-POST-M122-EXPLORE
title: Post-M121/M122 architecture audit (mandatory explore) — confirm no
  structural regression from the SEA crash fix + CI extension
status: todo
labels:
  - milestone-candidate
  - explore
  - milestone:M-123
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Mandatory explore per the ≥1/5 rule: M119-M122 are 4 consecutive exploits since the M118 explore
reset. M121 (`gate/registry.ts` dual-mode `__dirname` fix) and M122 (`release.yml` CI extension +
Windows dotglob fix) both touched real product/infra code — a fresh archguard sweep confirms neither
introduced a structural regression (new cycles, god-packages, or unexpected dependency growth) before
the loop continues exploiting. Genuinely re-verifies the structural baseline after real code changes,
not a repeat of an unchanged surface — the correct shape for an explore.

## Plan
N/A — read-only archguard sweep (analyze + summary + cycle detection, scope=`packages`), compare
against the M113/M117/M118 baseline (entities=144/relations=201, 0 cycles). File any NEW confirmed
findings; explore never fixes.

## Acceptance Criteria
- [ ] Fresh `archguard_analyze` (scope=packages, noCache:true) + `archguard_summary` run on current
  master HEAD; entity/relation counts recorded and compared against the M113/M117/M118 baseline. Claimed
  evidence (orchestrator, NOT yet independently confirmed): `archguard_analyze(sources=["packages"],
  lang=typescript, noCache=true)` → 22 entities/57 relations (package-overview scope), 144
  entities/201 relations (class scope). `archguard_summary(scope=packages)` → entities=144,
  relations=201 — matches the M113/M117/M118 baseline exactly. `startServer` outDegree=7, unchanged,
  already-tracked `ARCH-M93-003` WONTFIX.
- [ ] Cycle detection run across the same scope; result recorded. Claimed evidence:
  `archguard_detect_cycles(scope=packages)` → `[]`, 0 cycles.
- [ ] Any new genuine findings filed as milestone-candidate tasks, gated through `routine-file-gate.ts`.
  Claimed: N/A, no new findings.
- [ ] FILE-ONLY invariant held (no product code touched). Claimed: confirmed via `git status --short`
  before commit — only task/charter/dashboard/backlog/milestone-report files touched.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [ ] All 4 AC items above verified true with pasted command output.
- [ ] it0 DoD meta-enforcer passes all clauses.
