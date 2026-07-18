# Charter M06-sizing — Milestone sizing rubric + value-typed SELECT (Tier-A)

**Milestone id:** M-SIZING · **surface:** method infra (charter template, `inherited-core.md`,
`OUTER-LOOP.md` SELECT step) — no VT chart weight, measured on sizing/calibration health tracks.
**type:** explore (methodology-infrastructure).
**Source:** DIR-004 (human directive via `/quay-directive`), applied immediately at the m5→m6
boundary — no inner milestone was in-flight when it arrived (pre-dispatch for m6), so per this
experiment's standing rule ("pivot immediately if pre-dispatch, defer if mid-milestone with real
work already done", established at m4's drain) this is NOT deferred.
**Charter authored:** m6, 2026-07-18, immediately after m5/M-DIR-PROJECTION ABSORB + checkpoint-1.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's
current HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis (recorded BEFORE dispatch, §4.1/§6.2 — methodology-infra framing)
- DIR-004's finding, reviewing m1-m4: (a) "2 inner iterations" is a cost-proxy artifact of the
  build+verify template, not a real size signal — the true gauge is whether iteration-0 lands ALL
  Done-when in one pass AND iteration-1 has real material to independently re-derive (m1 was mildly
  oversized — iteration-1 did substantive new build work, not pure verification; m2/m4 were
  correctly sized — iteration-1 caught real errors via genuine independent re-derivation); (b) VT
  prices only capability-growth value, and is blind to discovery value (m3), instrument-correction
  value (m4, which scored VT **-6.60** despite being one of the two most valuable milestones so
  far), and risk/option/governance-integrity value (m2, m5, both scored 0) — SELECT currently
  compensates with ad hoc prose instead of a structured, typed ledger.
- Target `Y`: (1) a written size definition + verify-iteration size gauge in `inherited-core.md`,
  referenced from `OUTER-LOOP.md`'s SELECT step; (2) the NEXT SELECT after this milestone (m7) uses
  an explicit value-typed ledger (capability-growth / discovery / instrument-correction /
  risk-option / governance-integrity) instead of VT-only ranking; (3) charter thickness for the
  first charter authored after this milestone comes in under the 2K alarm by citing the HARD GATES
  block by verified hash instead of transcribing it verbatim; (4) a governance/infra hard-floor
  check is recorded as part of SELECT (reject/resize a partial-scope governance candidate, per the
  DIR-002/DIR-006 lesson generalized).
- Realized-value signal at ABSORB: does m7's actual SELECT log entry visibly use the value-typed
  ledger (not just claim to), and does the first post-M-SIZING charter's real token/line count
  demonstrate the gate-hash-by-reference change actually shrinks charter thickness (not just assert
  it would)?

## In-scope work (the ONLY work this milestone may do — no open-ended feature work)
1. **Size definition** — add a new section to `inherited-core.md` (follow the existing
   "Domain-misfit audit-channel — concrete decision procedure" section's pattern: a named
   sub-heading, a one-paragraph definition, then a concrete decision procedure) stating DIR-004's
   size definition verbatim-in-spirit: *smallest scope carrying a coherent value step AND fitting
   the build+verify cost band; when a coherent value step doesn't fit one cost unit, split along a
   different seam OR explicitly budget a multi-build milestone — never ship half a value step.*
2. **Verify-iteration size gauge** — in the same new section: make explicit that "iteration-1 has
   nothing real to re-derive" ⇒ under-sized (bundle it into iteration-0's milestone or fold into a
   neighboring one), "iteration-1 is forced into new build work, or a mid-milestone re-scope
   happens" ⇒ over-sized (split it). Cite m1 (oversized: iteration-1 did real new CI-fix work),
   m2/m4 (correctly sized: iteration-1 caught real errors via genuine independent re-derivation) as
   the worked examples, mirroring how the domain-misfit section validates itself against M01-dist.
3. **Value-typed SELECT ledger** — add a short section (`inherited-core.md` or `OUTER-LOOP.md`,
   your call on the better location, but referenced from OUTER-LOOP.md's SELECT step either way)
   naming the value types observed so far (capability-growth, discovery, instrument-correction,
   risk/option, governance-integrity) with one-line definitions and the m1-m5 worked examples from
   DIR-004's own table. Update `OUTER-LOOP.md`'s SELECT step (currently step 1, "SELECT the next
   milestone...") to require recording each candidate's value type(s) at SELECT time, with VT Δv̂
   as one input among several, not the sole ranker.
4. **Governance/infra hard floor** — add a one-line SELECT-time check (in the same ledger section):
   a governance/infra candidate whose scope excludes its own enabling/enforcement half must be
   rejected or resized at SELECT, never dispatched partial (the DIR-002/DIR-006 lesson,
   generalized so it's checked BEFORE dispatch next time, not discovered after the fact again).
5. **Gate-hash-by-reference charter template change** — update the charter-authoring guidance
   (`OUTER-LOOP.md` step 3, "AUTHOR CHARTER") so a NEW charter may cite the pinned HARD GATES block
   by path + verified hash (using the already-built `it0-gate-hash-check.sh`) instead of
   transcribing the full block verbatim, IF the milestone's own iteration-executor prompt still
   includes the raw gate text at dispatch time (the charter file itself may shrink; the DISPATCHED
   agent must still see the literal gate text somewhere in its prompt — do not let dispatched agents
   receive only a hash with no literal text, that reintroduces the DIR-009 dilution risk this whole
   mechanism defends against). Demonstrate this by re-authoring ONE existing charter's HARD GATES
   section (your choice, pick the smallest to minimize risk) as a worked proof-of-concept, OR by
   using the new by-reference form when authoring the next real charter after this milestone (m7) —
   your call which is more convincing evidence, but Done-when 3 requires a REAL charter's line/token
   count under 2K, not just the template text existing unused.
6. Do NOT change the fundamental HARD GATES content itself (still DIR-009's pinned source, still
   hash-verified) — only how a *charter* references it, never how a dispatched *agent's prompt* sees
   it (dispatched agents must always receive the literal gate text, per item 5's parenthetical).
   Do NOT attempt to retroactively re-score m1-m5's VT with the new value-typed ledger — apply it
   forward from m7 only, to avoid rewriting settled history.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's V_instance shape)
1. `[ ]` The size definition (item 1) and verify-iteration size gauge (item 2) are written into
   `inherited-core.md`, and `OUTER-LOOP.md`'s SELECT step references them — pasted diff, not prose.
2. `[ ]` The value-typed ledger (item 3) and governance/infra hard floor (item 4) are written and
   `OUTER-LOOP.md`'s SELECT step is updated to require using them — pasted diff.
3. `[ ]` The gate-hash-by-reference mechanism (item 5) is demonstrated on a REAL charter (either a
   worked re-authoring of an existing one, or used live for m7's real charter) with a pasted
   `it0-gate-hash-check.sh` PASS result AND a real token/line count showing the charter file itself
   is now under the 2K alarm, while confirming (state explicitly, with evidence — e.g. quote the
   dispatched-agent prompt template) that a DISPATCHED iteration-executor's actual prompt still
   contains the literal gate text, not just a hash reference.
4. `[ ]` A worked self-consistency check retroactively applying the value-typed ledger to m1-m5
   (read-only, does NOT rewrite dashboard.md's settled VT numbers) reproduces DIR-004's own table
   (m2/m4 as non-capability-growth types) — mirroring how the domain-misfit section validates
   itself against M01-dist — pasted as evidence this milestone's own ledger definitions are usable,
   not just aspirational prose.
5. `[ ]` Full existing test suite still passes (no regression — this milestone touches only `.md`
   process files, but any incidental script changes must be verified) — pasted raw output.

Milestone is DONE when all five are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first (ΔV plateau K=2, ceiling, budget≈10 past with nothing
climbing, external HALT).

## HARD GATES (Tier-A, transcluded byte-for-byte from the pinned template — §3.1, DIR-009 defense)

Source: `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` §0, fenced HARD GATES block
(lines 100-131 at charter-authoring time). Transcluded verbatim below; only the worktree/branch
path is parameterized per this milestone. (Note: this milestone's OWN in-scope work proposes a
by-reference alternative to this transclusion pattern for FUTURE charters — but per item 6 above,
this charter itself still uses full verbatim transclusion, since the by-reference mechanism does not
exist yet until this milestone builds it.)

```
HARD GATES — paste the literal command output into §2 of this iteration's report,
not a prose summary. A summary is not acceptable evidence for these four; the raw
output is the artifact. (This block exists because through iteration 3 the
"directives listed" check was satisfied by copying the prior report's sentence
forward, and DIR-005/DIR-006 went unseen for three iterations — see gap-list PR-001.)

[ ] ls -1 experiments/quay-perpetual-stream/directives/pending/  [PARAM: exp5 directive dir]
    → paste the raw file listing. Then give EACH file listed an explicit
      applied/deferred-with-reason/rejected DISPOSITION this iteration — not
      an acknowledgment. Naming the gap (e.g. "still open per PR-001") or
      restating that the mechanism is unreliable is NOT a disposition and
      does not satisfy this gate — each filename needs its own outcome
      stated in this iteration's own words, even if the outcome is
      "deferred, reason: X." If the listing shows more files than you have
      given a real disposition to, you have not completed this gate.
      (This sub-clause exists because iteration 4 satisfied the letter of
      the original gate by citing PR-001 itself as the reason DIR-005/
      DIR-006 remained unaddressed — technically an acknowledgment, but not
      a disposition, and the loophole this gate is meant to close.)
[ ] cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
    → paste both outputs.
[ ] curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
    → paste the status code (G7 reachability).
[ ] git worktree add experiments/quay-perpetual-stream/milestones/M06-sizing/worktrees/iteration-N
    -b exp5-m06-iteration-N  [PARAM: exp5 milestone worktree path + branch name]
    → paste the "HEAD is now at <hash>" line. Creating the worktree is NOT the
      gate — WRITING THIS ITERATION'S CHANGES INTO IT is. All development/test
      edits this iteration must target paths UNDER worktrees/iteration-N/, not
      the shared tree at repo root. See the end-of-iteration isolation proof
      gate below; the two are one requirement checked at both ends.
```

Additional gates (unparameterized, copied unchanged from the same §0 block, applicable as-is):
- Git worktree isolation END-OF-ITERATION PROOF (paste `git -C .../worktrees/iteration-N status
  --short` showing this iteration's writes landed there, AND `git -C <repo root> status --short --
  experiments/` clean [PARAM: this milestone edits `experiments/quay-perpetual-stream/
  {inherited-core.md,OUTER-LOOP.md,charters/}` and possibly one re-authored existing charter file]).
- verification_coverage spot-check every iteration boundary.
- system_health regression check (no regression vs. exp1/exp2/exp3 inherited V-factor snapshots).
- All background dispatches (iteration/audit/simulated-user subagents) confirmed `run_in_background=true`.

**Gate-hash check (it0 systematic-explore, §4.4b) — MECHANIZED via M-GATES' script:**
```
$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh experiments/quay-perpetual-stream/charters/M06-sizing.md
```
Run this before dispatch and paste the result in the dashboard log (do not just assert PASS).

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop (compute at it0: is a
"size definition + value ledger + gate-hash-by-reference" change reachable given the existing
`it0-gate-hash-check.sh` tooling already exists (M-GATES) and `inherited-core.md`/`OUTER-LOOP.md`
are plain editable process files? Yes — no redesign trigger) · (4) budget≈10 backstop, past→default
HALT · (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work, MECHANIZED per M-GATES)
a. **Ceiling/floor arithmetic** — this milestone cites no existing gap-list IDs to close (it builds
   new methodology substrate); applicable ceiling question: "does a sizing rubric or value-typed
   ledger already exist anywhere in this repo's process docs?" — checked at charter-authoring time:
   `grep -rn "value.typed\|verify-iteration.*gauge\|cost band" experiments/quay-perpetual-stream/
   inherited-core.md experiments/quay-perpetual-stream/OUTER-LOOP.md docs/proposals/
   quay-perpetual-stream-experiment-v5.md` found nothing matching this shape. Not already done, not
   unreachable.
b. **Gate-hash/transclusion** — run `it0-gate-hash-check.sh` against this file per the block above;
   record actual PASS/FAIL output in the dashboard log before dispatch, not an assumption.
c. **Dogfooding evidence-gate** — Done-when clauses 1-4 explicitly require pasted diffs/evidence,
   not prose; `it0-dogfood-evidence-gate.sh` can be run against this milestone's own iteration
   report once written, as a self-check.
d. **Domain-misfit audit-channel** — per `inherited-core.md`'s decision procedure: this milestone's
   domain (process/methodology text) has a natural audit channel in Done-when clause 3's real
   token-count measurement (an objective, non-self-referential number, not a self-assessment) and
   Done-when clause 4's retroactive-reproduction self-consistency check (mirrors the domain-misfit
   section's own M01-dist validation) — both are independent of the milestone's own prose claims.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above.
Record each iteration under `experiments/quay-perpetual-stream/milestones/M06-sizing/iterations/`.
