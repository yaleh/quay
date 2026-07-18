# Charter M02-gates — Institutionalize the 4 systematic-explore it0 checks (Tier-A)

**Milestone id:** M02-gates · **surface:** method infra (no VT chart-0 surface weight — measured on
discovery-latency / charter-thickness / ρ tracks instead, §4.2/§4.3) · **type:** explore
**Source:** `offline-replay/RESULTS.md` §B2 (4/5 checks offline-validated: ceiling arithmetic,
gate-hash/transclusion, dogfooding evidence-gate, domain-misfit audit-channel — target 206
accumulated iterations of mechanizable-channel late-discovery latency, protocol §4.4).
**Charter authored:** m2 (after M-DIST/m1 DONE and the M-CLI-UX it0-rejection, both 2026-07-18).
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's
current HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis (recorded BEFORE dispatch, §4.1/§6.2 — methodology-infra framing)
- The 4 it0 checks currently exist only as **prose instructions in OUTER-LOOP.md step 4** — this
  very milestone's own m2-attempt-1 (M-CLI-UX rejection, dashboard log) is live proof they work
  when actually performed, but nothing MECHANIZES or ENFORCES that they get performed at every
  future milestone SELECT. There is no script, no lint, no gate that blocks a charter from being
  authored if the it0 checks weren't run.
- Target `Y` (the measured metric, since there's no VT points to hypothesize): a **committed,
  reusable check script** (or equivalent mechanized artifact) for each of the 4 checks, wired into
  the outer cycle so that skipping one is either impossible or leaves a visible, checkable trace —
  NOT a redescription of the prose checklist in different words (that would be dilution, not
  mechanization).
- Realized-value signal at ABSORB: does m3 (the next milestone after this one) actually exercise
  the mechanized gates, and does doing so take LESS outer-orchestrator judgment/tokens than m2's
  manual it0 pass took? (Discovery-latency / charter-thickness tracks are the outer proxy for this.)

## In-scope gap subset (the ONLY work this milestone may do — no gap-list-wide sweep)
- **Check 1 — ceiling/floor arithmetic**: build a mechanism that, given a milestone's cited
  gap-list/directive IDs, checks whether they're already closed/stale BEFORE a charter is authored
  (the exact manual check that just caught M-CLI-UX). Minimum viable form: a script
  `experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh <gap-id>...` that greps the cited
  gap-list(s) for each ID and reports OPEN / CLOSED / NOT-FOUND per ID, non-zero exit if any cited
  ID is not OPEN.
- **Check 2 — gate-hash/transclusion**: mechanize the manual diff this experiment has done twice
  by hand (M01-dist charter authoring + restart) into a script
  `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh <charter-file>` that extracts
  the charter's fenced HARD GATES block, diffs it (modulo declared `[PARAM: ...]` substitution
  lines) against the current pinned source
  (`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100-131), non-zero exit on
  any undeclared divergence.
- **Check 3 — dogfooding evidence-gate**: a lightweight check (script or documented grep recipe)
  over an iteration report that flags Done-when clauses claimed met without an adjacent pasted
  command/CI-output block — does not need to be a full report-format validator, but must be more
  than prose ("we should paste evidence") — e.g. a grep for `\[x\]` Done-when lines lacking a
  fenced code block within N lines.
- **Check 4 — domain-misfit audit-channel**: NOT independently mechanizable (it's a judgment call:
  "does this new domain have an independent audit channel?") — scope for this milestone is
  **documentation**, not automation: a short, concrete decision procedure in `inherited-core.md`
  (building on M01-dist's adaptation-log finding that the audit channel and the CI verification job
  should be the *same* mechanism) that a future charter-author can apply directly, replacing the
  current abstract framing.
- Every OPEN blocking gap in exp4's gap-list.md, verbatim (checked at charter-authoring time): grep
  confirmed **zero** OPEN entries with severity `blocking` as of m2 SELECT. If it0 finds a blocking
  gap that post-dates this charter, STOP and re-author (do not silently absorb it).

## Binary Done-when (§3.4 — mandatory, freezes this milestone's V_instance shape)
1. `[ ]` `it0-ceiling-check.sh` (or equivalent) exists, is committed, and correctly reports
   UQ-042..046 as CLOSED when run against this experiment's own m2-attempt-1 case (a real
   regression test using the actual rejection this milestone is built on).
2. `[ ]` `it0-gate-hash-check.sh` (or equivalent) exists, is committed, and correctly (a) PASSES
   against the current `charters/M01-dist.md` (a real charter that IS a verbatim transclusion) and
   (b) FAILS against a deliberately-paraphrased test fixture — both outcomes demonstrated with
   pasted command output.
3. `[ ]` A dogfooding evidence-gate check (script or documented recipe) exists, is committed, and
   demonstrated against at least one real iteration report from `milestones/M01-dist/iterations/`
   with pasted output.
4. `[ ]` `inherited-core.md` gains a concrete domain-misfit decision procedure (not abstract framing)
   — reviewed against M01-dist's own audit-channel finding to confirm it would have produced the
   same answer if applied at that milestone's it0.
5. `[ ]` `OUTER-LOOP.md` step 4 (it0 systematic-explore checks) is updated to POINT AT these
   scripts/procedures by path, replacing the current pure-prose instructions — so a future outer
   pass runs the mechanism, not just reads about it.
6. `[ ]` Full existing test suite still passes (no regression) — pasted raw output, not a summary.

Milestone is DONE when all six are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first (ΔV plateau K=2, ceiling, budget≈10 past with nothing
climbing, external HALT).

## HARD GATES (Tier-A, transcluded byte-for-byte from the pinned template — §3.1, DIR-009 defense)

Source: `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` §0, fenced HARD GATES block
(lines 100-131 at charter-authoring time). Transcluded verbatim below; only the worktree/branch
path is parameterized per this milestone (substitution called out inline, not a paraphrase of gate
substance — every checklist item's wording is copied unchanged):

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
[ ] git worktree add experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-N
    -b exp5-m02-iteration-N  [PARAM: exp5 milestone worktree path + branch name]
    → paste the "HEAD is now at <hash>" line. Creating the worktree is NOT the
      gate — WRITING THIS ITERATION'S CHANGES INTO IT is. All development/test
      edits this iteration must target paths UNDER worktrees/iteration-N/, not
      the shared tree at repo root. See the end-of-iteration isolation proof
      gate below; the two are one requirement checked at both ends.
```

Additional gates (unparameterized, copied unchanged from the same §0 block, applicable as-is):
- Git worktree isolation END-OF-ITERATION PROOF (paste `git -C .../worktrees/iteration-N status
  --short` showing this iteration's writes landed there, AND `git -C <repo root> status --short --
  experiments/` clean [PARAM: this milestone edits `experiments/` and `scripts/` paths, not
  `packages/` — substitute the isolation-proof target path accordingly, substance unchanged]).
- verification_coverage spot-check every iteration boundary.
- system_health regression check (no regression vs. exp1/exp2/exp3 inherited V-factor snapshots).
- All background dispatches (iteration/audit/simulated-user subagents) confirmed `run_in_background=true`.

**Gate-hash check (it0 systematic-explore, §4.4b):** the fenced block above must literal-match
`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100-131 except the three lines
tagged `[PARAM: ...]` (worktree/branch path + isolation-proof target substitution only — substance
and all warning prose unchanged). Any other divergence FAILS this gate and blocks dispatch. (This
milestone's own Done-when clause 2 will produce the SCRIPT that checks this automatically — until
then, verified by hand as done for M01-dist.)

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop (compute at it0: is
"mechanized, non-prose enforcement" reachable given this is a markdown-driven agentic workflow with
no CI/lint infrastructure of its own? A bash script IS reachable — this is not a hard ceiling, just
a lighter-weight mechanization than a real CI lint job) · (4) budget≈10 backstop, past→default HALT
· (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — is any Done-when clause already satisfied or arithmetically
   unreachable? None of the 4 scripts/procedures exist yet (verified: `ls
   experiments/quay-perpetual-stream/scripts/` — directory does not exist). Not already done, not
   unreachable (plain bash + grep suffices for checks 1-3; check 4 is documentation). No redesign
   trigger.
b. **Gate-hash/transclusion** — confirmed above; charter's block re-diffed against current
   `ITERATION-PROMPTS.md` lines 100-131 at authoring time, byte-identical apart from declared PARAM
   substitutions.
c. **Dogfooding evidence-gate** — Done-when clauses 1-3 explicitly require pasted command output
   demonstrating both a pass and (for clause 2) a fail case — this milestone's own Done-when is
   itself dogfooding the check it's building.
d. **Domain-misfit audit-channel** — this milestone's domain is "outer-orchestrator process
   tooling," not a user-facing surface. Its audit channel is: **re-run the mechanized checks against
   the M01-dist milestone's own real artifacts** (the charter that should pass the gate-hash check,
   the iteration reports that should exercise the evidence-gate check, the M-CLI-UX rejection that
   should exercise the ceiling check) — i.e., the just-completed milestone IS the independent audit
   fixture. This is a concrete instance of the pattern this milestone's own Done-when clause 4 asks
   `inherited-core.md` to document generally.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above.
Record each iteration under `experiments/quay-perpetual-stream/milestones/M02-gates/iterations/`.
