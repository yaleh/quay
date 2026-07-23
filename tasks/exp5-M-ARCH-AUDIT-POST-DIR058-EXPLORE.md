---
id: exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE
title: "Post-DIR-058 architecture audit (archguard, M118 mandatory explore):
  first-ever full 4-package structural analysis"
status: todo
labels:
  - milestone-candidate
  - milestone:M-118
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE
    experiments/quay-perpetual-stream/charters/M118-arch-audit-post-dir058-explore.md
    /tmp/m118-absorb-entry.md
---
## Proposal

Mandatory explore at M118 (4 consecutive exploits M114–M117 since the M113 explore reset). DIR-058
just closed at M117: `packages/quay-backlog/src/*` and all 4 packages' `bin/*` entrypoints are now
`.ts` for the first time ever, meaning archguard's TypeScript-based structural instrument can, for
the first time, see the ENTIRE product (all 4 packages, no dark files) in one analysis. Every prior
archguard audit in this experiment (M93/M98/M108/M113) was structurally incomplete by construction —
it excluded whatever wasn't yet migrated. This is genuinely new observability, not a repeat of an old
surface, which is what makes it the right explore pick (grows the reusable structural-analysis core
rather than re-treading it).

**Scope:** fresh, comprehensive archguard sweep against current `master` HEAD, scope=`packages/`:
1. Full entity/relation counts (already have a preliminary reading from M117's ABSORB: entities=144,
   relations=201 — re-confirm fresh, noCache:true, as this milestone's own official baseline).
2. God-package detection across all 4 packages (not just `quay/src` as before).
3. God-function / high-outDegree detection across all 4 packages.
4. Cycle detection across all 4 packages.
5. Cross-check the 2 STALE-bookkeeping findings already on the board (`PROBE-M98-001`,
   `exp5-M-ARCH-AUDIT-M98-EXPLORE` — both have AC/DoD boxes fully ticked from the M98-era
   investigation but `status: todo`, an administrative gap flagged at M115/M116/M117's SELECT
   "not selected" notes): verify whether their underlying findings (`startMcpServer` outDegree)
   still hold against this fresh full-scope reading; if confirmed still accurate and genuinely
   resolved, flip their `status` to `done` as a trivial administrative correction (no re-investigation,
   just verify + flip); if stale/superseded, note why in their own body.
6. File any NEW confirmed architectural findings as evidence-backed milestone-candidate tasks behind
   `routine-file-gate.ts` (FILE-ONLY — explore never fixes what it finds).

## Plan

N/A — methodology-class / explore milestone; no implementation plan required. Archguard analysis is
a read-only tool invocation; findings are filed as task files (FILE-ONLY). No docs/plans/*.md needed.

## Acceptance Criteria

- [ ] Fresh archguard analysis run on current `master` HEAD, scope=`packages/`, `noCache:true`; entity/relation counts recorded as this milestone's official full-product baseline (all 4 packages, no dark files).
- [ ] God-package + god-function metrics measured across the FULL scope (previously `quay-backlog`/`bin/*` were invisible); any new finding beyond what M93/M98/M108/M113 already found is filed.
- [ ] `PROBE-M98-001` and `exp5-M-ARCH-AUDIT-M98-EXPLORE`'s stale `status: todo` (despite fully-ticked boxes) is administratively resolved — either flipped to `done` (findings still hold) or explicitly annotated as superseded (with reason), not left ambiguous.
- [ ] Any new genuine architectural findings filed as milestone-candidate tasks with reproduction evidence, gated through `routine-file-gate.ts` (ACCEPT/REJECT documented per finding).
- [ ] FILE-ONLY invariant held: no commits to product/method code this milestone, only task files + dashboard/administrative updates.

## Definition of Done

References the standard inherited-core DoD clauses (adversarial-audit, V_meta-lag, line-budget,
impl-row N/A, no-self-exemption, test-floor N/A — no product code touched); the bar is REAL LANDING:

- [ ] Archguard re-run output pasted in the ABSORB entry; comparison table vs the M113/M117 partial baselines shows which packages/files are newly visible.
- [ ] All new findings' `routine-file-gate.ts` ACCEPT/REJECT disposition pasted as evidence.
- [ ] FILE-ONLY confirmed via `git show --stat` on this milestone's commit(s) — only task/dashboard files touched.
- [ ] it0 DoD meta-enforcer passes all clauses.
