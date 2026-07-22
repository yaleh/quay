# Charter M104-startserver-outdegree-probe — startServer outDegree 6→7 investigation (ARCH-M103-002)

**Milestone id:** M104  
**Task:** `tasks/ARCH-M103-002.md` (milestone-candidate, defect)  
**Surface:** `packages/quay/src/serve.ts` — investigate outDegree measurement discrepancy (M100 claimed 6, M103 measured 7)  
**Type:** development-class / defect  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

M100 (ARCH-M93-003) decomposed `startServer` from 675 lines → 65 lines and documented outDegree=6→6 (no regression). M103 fresh archguard measurement shows outDegree=7, not 6. The extra edge is `serve-handlers.ts.handleAllRoutes`, the companion-file facade added by M100.

The M103 finding task (ARCH-M103-002) says this may be either:
- **(a) Scope artefact:** M100 and M103 used different archguard scopes; the `handleAllRoutes` edge was not captured in M100's scope but IS captured in M103's scope.
- **(b) Genuine regression:** M100's measurement was run before `handleAllRoutes` was finalized, or used a stale cache. The companion file edge is genuinely new vs M93 baseline.

Both outcomes are acceptable per the task's DoD: "either root cause documented as scope artefact (WONTFIX) or fix to ≤6."

**Lesson from M97→M99 (PROBE-M98-001):** When M97 measured outDegree=0 (narrow scope) vs M98's 7 (global scope), the fix was a facade (`registerAllHandlers`). The same approach COULD apply here — but `startServer` already only calls `handleAllRoutes` once (it's already a single facade). There are no 5-separate-call→1-facade consolidations available. If the 7 edges are all inherent (setup deps + 1 facade), WONTFIX is the honest outcome.

## Scope

**In scope:**

1. **Root cause analysis**: run archguard with BOTH the M100 scope AND the M103 global scope; compare `startServer` outDegree measurement. Determine if the +1 is a scope difference or a genuine edge introduced by M100.

2. **If genuine regression (outDegree 6→7 is real)**:
   - Assess whether `handleAllRoutes` edge can be eliminated by a different code structure (unlikely — it's the only mechanism for `startServer` to dispatch routes without inlining them again)
   - If no fix possible: close as WONTFIX with documented rationale ("companion-file facade adds 1 inherent edge; same fundamental constraint as M99's remaining edges")
   - If fix possible: implement and verify with fresh archguard

3. **If scope artefact**: document the scope difference precisely; close as WONTFIX (measurement artifact, not a structural change).

4. Update ARCH-M103-002 task with root cause and resolution.

**Out of scope:**
- Re-doing the M100 decomposition
- Getting startServer to ≤4 (not the AC; the only AC is "≤6 OR documented WONTFIX")
- ARCH-M103-001 (loadWorkspaceGates) — separate task

## Class routing

**Development-class** — likely lands as WONTFIX documentation (methodology), but may include code change. Requires quay-task-to-plan (N=2 proposals → adjudication → plan → executor). Per OUTER-LOOP.md step 5a.

**Note:** If both proposals independently conclude WONTFIX, the adjudicator may shortcut directly to a one-agent executor for the documentation-only resolution.

## Acceptance Criteria

- [ ] Root cause of M100 vs M103 measurement discrepancy documented (scope artefact vs genuine regression).
- [ ] Either: (a) outDegree ≤6 confirmed by fresh archguard after fix, OR (b) WONTFIX with documented rationale (companion-file facade inherent edge, no fix possible).
- [ ] ARCH-M103-002 task updated with resolution.

## Definition of Done

- [ ] Root cause documented + resolution (fix or WONTFIX) pasted in ABSORB entry.
- [ ] Fresh archguard measurement pasted (regardless of WONTFIX).
- [ ] If code changed: tests pass, adversarial audit done.
- [ ] If WONTFIX: adversarial audit of the rationale (confirm no better fix exists).
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
