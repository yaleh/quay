---
id: exp5-M-ARCH-AUDIT-POST-M122-EXPLORE
title: Post-M121/M122 architecture audit (mandatory explore) — confirm no
  structural regression from the SEA crash fix + CI extension
status: done
labels:
  - milestone-candidate
  - explore
  - milestone:M-123
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-ARCH-AUDIT-POST-M122-EXPLORE
    experiments/quay-perpetual-stream/charters/M123-arch-audit-post-m122-explore.md
    /tmp/m123-absorb-entry.md
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
against the M117/M118 full-4-package baseline (entities=144/relations=201, 0 cycles). File any NEW
confirmed findings; explore never fixes.

## Acceptance Criteria
- [x] Fresh `archguard_analyze` (scope=packages, noCache:true) + `archguard_summary` run on current
  master HEAD; entity/relation counts recorded and compared against the M117/M118 full-4-package
  baseline. Claimed evidence (orchestrator): `archguard_analyze(sources=["packages"],
  lang=typescript, noCache=true)` → 22 entities/57 relations (package-overview scope), 144
  entities/201 relations (class scope). `archguard_summary(scope=packages)` → entities=144,
  relations=201 — matches the M117/M118 baseline exactly. `startServer` outDegree=7, unchanged,
  already-tracked `ARCH-M93-003` WONTFIX.
  ADVERSARIAL AUDIT CONFIRMED (independently re-ran `archguard_analyze`+`archguard_summary`, scope=
  packages, noCache=true, TWICE — once against the shared checkout, once against this audit's own
  isolated worktree — both returned entities=144/relations=201, 0 cycles, startServer outDegree=7
  rank-1 topByOutDegree; see `iteration-0-adversarial-audit.md` for full pasted output).
- [x] Cycle detection run across the same scope; result recorded. Claimed evidence:
  `archguard_detect_cycles(scope=packages)` → `[]`, 0 cycles.
  ADVERSARIAL AUDIT CONFIRMED (independently re-ran `archguard_detect_cycles`, outputScope=package,
  against both the shared checkout and this audit's own worktree → `[]` both times).
- [x] Any new genuine findings filed as milestone-candidate tasks, gated through `routine-file-gate.ts`.
  Claimed: N/A, no new findings.
  ADVERSARIAL AUDIT CONFIRMED (independently checked every prior ARCH-* finding task — all
  status=done/resolved; entity/relation/cycle counts identical to the M117/M118 baseline; no
  plausible new structural signal found).
- [x] FILE-ONLY invariant held (no product code touched). Claimed: confirmed via `git status --short`
  before commit — only task/charter/dashboard/backlog/milestone-report files touched.
  ADVERSARIAL AUDIT CONFIRMED (independently ran `git show --stat cbfd047` — the milestone's actual
  commit — zero `packages/**` files touched. Caught a real transcript-fidelity gap: iteration-0.md's
  original pasted `git status --short` transcript incorrectly listed `dashboard.md` as modified; the
  real commit does not touch it. Corrected same-ABSORB, logged as `DEV-13` in `inherited-core.md`.)

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [x] All 4 AC items above verified true with pasted command output. Independently re-confirmed by
  the adversarial audit with fresh tool calls, not by trusting the orchestrator's pasted transcript.
- [x] it0 DoD meta-enforcer passes all clauses. FOLLOW-UP PASS (second dispatch, same audit worktree):
  independently re-read the orchestrator's corrections (charter's baseline citation, iteration-0.md's
  FILE-ONLY transcript) — confirmed both accurate and non-spun. Confirmed the new `DEV-13` row in
  `inherited-core.md` accurately represents both findings. Independently re-ran, from the shared
  checkout root: `it0-dod-check.sh` → all 12 clauses PASS/N/A, exit 0; `quay gate
  exp5-M-ARCH-AUDIT-POST-M122-EXPLORE` → PASS, exit 0, a NEW distinct GateEvent
  (`4786f7a4-7eac-42e1-b660-b01b8a64e6e0`, `2026-07-23T10:49:06.795Z`), alongside the orchestrator's
  own (`cfcdcb25...`, `10:47:41.009Z`).

## Execution record (M123 ABSORB, 2026-07-23)

**Milestone:** M123 · **Iterations:** 1 (single-pass methodology-class explore, FILE-ONLY) ·
**Realized Δv:** 0 (explore milestones carry no VT points by design). **Merge commit:** `cbfd047`.
**Adversarial-audit verdict:** NO REFUTATION FOUND, 2 non-blocking CONCERNS (see
`milestones/M123/audits/iteration-0-adversarial-audit.md`) — caught 2 real transcript/citation-
fidelity gaps (a stale "M113/M117/M118 baseline" mislabel and iteration-0.md's inaccurate template
`git status` transcript), both corrected same-ABSORB and logged as `DEV-13`; neither changes the
underlying true claims. **DoD meta-enforcer:** PASS (`quay gate`, GateEvent
`2026-07-23T10:47:41.009Z` orchestrator + `2026-07-23T10:49:06.795Z` independent audit re-run, both
PASS). One-line outcome: confirms M121/M122's changes introduced zero structural regression
(entities=144/relations=201/0 cycles, unchanged since M117/M118), satisfying the ≥1/5 explore-cadence
rule after 4 consecutive exploits.