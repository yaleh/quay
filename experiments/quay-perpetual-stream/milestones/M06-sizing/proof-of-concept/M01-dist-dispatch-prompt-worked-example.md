# Worked example: dispatched iteration-executor prompt for a gate-hash-by-reference charter

(M06-sizing proof-of-concept, item 5. This is NOT a live dispatch — M01-dist is already DONE. This
file demonstrates concretely what the DISPATCHER must inject into a `baime:iteration-executor`
prompt when the charter it is reading (`M01-dist-by-reference.md`, same directory) uses the
gate-hash-by-reference form instead of verbatim transclusion.)

## The rule (OUTER-LOOP.md step 3, by-reference note)

> Either form [verbatim or by-reference] is an acceptable satisfaction of invariant 3, but the
> by-reference form does NOT change what a DISPATCHED iteration-executor agent's prompt must
> contain: that prompt must always include the literal gate text somewhere, in full, regardless of
> which form the charter file uses.

So: the CHARTER FILE may hold only `GATE-HASH-REF: <hash> (<path> lines <range>)`. The ACTUAL
PROMPT constructed for the dispatched agent must NOT simply forward that one line — it must be
resolved back to literal text by the dispatcher BEFORE the agent ever sees it.

## Worked example — what the dispatcher sends

If M01-dist-by-reference.md were a live charter being dispatched via `baime:iteration-executor`,
the dispatcher's actual prompt (not the charter file, the constructed message to the subagent)
would read like this (excerpt — full charter content aside from the gates section elided for
brevity, since this is a proof-of-concept, not a real dispatch):

```
Execute inner iteration-N of milestone M01-dist within quay-perpetual-stream.

Read this charter: experiments/quay-perpetual-stream/milestones/M06-sizing/proof-of-concept/M01-dist-by-reference.md
Read the pinned Tier-B pointer: experiments/quay-perpetual-stream/inherited-core.md

The charter's HARD GATES section is cited by reference (GATE-HASH-REF, verified PASS by the
dispatcher via it0-gate-hash-check.sh --by-reference before this dispatch). Resolved to literal
text, the HARD GATES you must satisfy this iteration are:

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
[ ] git worktree add experiments/quay-perpetual-stream/milestones/M01-dist/worktrees/iteration-N
    -b exp5-m01-iteration-N  [PARAM: exp5 milestone worktree path + branch name]
    → paste the "HEAD is now at <hash>" line. Creating the worktree is NOT the
      gate — WRITING THIS ITERATION'S CHANGES INTO IT is. All development/test
      edits this iteration must target paths UNDER worktrees/iteration-N/, not
      the shared tree at repo root. See the end-of-iteration isolation proof
      gate below; the two are one requirement checked at both ends.

Additional gates (unparameterized, copied unchanged from the same §0 block, applicable as-is):
- Git worktree isolation END-OF-ITERATION PROOF (paste `git -C .../worktrees/iteration-N status
  --short` showing this iteration's writes landed there, AND `git -C <repo root> status --short --
  packages/` clean).
- verification_coverage spot-check every iteration boundary.
- system_health regression check (no regression vs. exp1/exp2/exp3 inherited V-factor snapshots).
- All background dispatches (iteration/audit/simulated-user subagents) confirmed
  `run_in_background=true`.

[... rest of the charter's Done-when / value-hypothesis / scope content follows, read directly
from the charter file itself, which the agent also has access to ...]
```

## Why this satisfies the constraint

- The **charter file** (`M01-dist-by-reference.md`) never contains the literal 32-line HARD GATES
  block — only a `GATE-HASH-REF:` line — so ITS token/line count is reduced by exactly the size of
  the gate section that would otherwise be transcluded (~880-900 tokens / ~50 lines per the
  original `M01-dist.md`'s measured gate-section size).
- The **dispatched agent's prompt** (what actually reaches the `baime:iteration-executor`
  subagent) still contains the full literal gate text, unabridged, because the dispatcher resolves
  `GATE-HASH-REF` back to source text before constructing the prompt — never forwards the hash
  reference alone to the agent. This is the exact DIR-009 defense (the gate text an executing agent
  actually reads is never diluted/paraphrased/omitted), preserved identically to the verbatim-
  transclusion form; only WHERE the literal text physically lives (charter file vs.
  dispatcher-constructed prompt) has changed.
- `it0-gate-hash-check.sh --by-reference` verifies the CHARTER's reference is current (the pinned
  source hasn't drifted since the hash was recorded) — it does not and cannot verify what a live
  dispatcher actually sends an agent; that remains a dispatcher-discipline requirement, stated
  explicitly in OUTER-LOOP.md step 3, the same way "read only the charter, not experiment history"
  was already a stated (not mechanically enforced) dispatcher discipline before this milestone.
