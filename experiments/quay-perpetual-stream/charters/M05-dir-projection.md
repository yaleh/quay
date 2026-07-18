# Charter M05-dir-projection — Directives-as-quay-tasks restrained projection (Tier-A)

**Milestone id:** M-DIR-PROJECTION · **surface:** MCP/CLI (task store) + method infra (no VT
chart weight — measured on discovery-latency/dogfooding tracks, §4.2/§4.3) · **type:** explore
**Source:** DIR-002 (human directive via `/quay-directive`), deferred at m4 drain, archived-pending
at `experiments/quay-perpetual-stream/directives/pending/DIR-002-directives-as-quay-tasks-restore-restrained-projection-design.md`.
**Charter authored:** m5 (after M04-discover/m4 DONE), 2026-07-18.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's
current HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis (recorded BEFORE dispatch, §4.1/§6.2 — methodology-infra framing)
- DIR-002's finding: the original restrained requirement (files canonical + generated task
  *projection*, not replacement) was agreed in exp4 but never actually built — exp4's DIR-006
  attempt did a destructive file→task cutover instead (it11), skipped the enabling tooling step,
  then rolled back to files-only (it15) and mischaracterized the rollback as "the design was
  wrong" rather than "the enforcement was never built." This is now the SECOND time this exact
  requirement has surfaced and been dropped (once in exp4, now flagged again in exp5 via DIR-002)
  — a repeat-governance-drift risk, not a one-off.
- Target `Y`: a working, mechanically-enforced projection where (a) `/quay-directive` produces
  BOTH the file and a `label: directive` task, (b) the Web UI's existing `?label=directive` filter
  (QW-005, already works, zero new code) surfaces it, and (c) an anti-drift reconciliation check
  exists that FAILS on divergence — the specific missing piece DIR-002 identifies as it15's
  correctly-diagnosed-but-never-built gap.
- Realized-value signal at ABSORB: does a real, live `/quay-directive` invocation this milestone
  produce a real projected task (not a hypothetical), and does the anti-drift check genuinely
  catch a deliberately-induced divergence (not just pass trivially)?

## In-scope work (the ONLY work this milestone may do — no open-ended feature work)
1. **Keep files canonical** — no change to `directives/pending/*.md` as the source of truth; do
   NOT repeat exp4 DIR-006 it11's mistake of deleting files once a task exists.
2. **Update the `/quay-directive` skill** (`.claude/skills/quay-directive/SKILL.md`) so that, after
   writing `DIR-NNN.md`, it ALSO calls `task_write` (native provider, this experiment's own task
   store — check which store `quay-perpetual-stream` actually uses at charter-execution time, do
   not assume) to create/refresh a `label: directive` task whose body is a GENERATED projection:
   a link to the DIR file's path + its Finding section's first paragraph (summary) + a status
   mirror field (pending/deferred/applied/rejected, matching the file's own `status:` line). The
   projection is regenerated, never hand-edited — no second authoritative copy.
3. **Anti-drift reconciliation check**: a script (`experiments/quay-perpetual-stream/scripts/
   it0-dir-projection-check.sh` or similar, following the M-GATES scripts' naming/exit-code
   convention) that FAILS (non-zero exit) if (a) a `label: directive` task exists with no
   corresponding `DIR-NNN.md` file, or (b) a `DIR-NNN.md` file's `status:` disagrees with its
   projected task's status mirror field. This is the concrete, previously-missing enforcement.
4. **Outer-loop inbox drain wiring**: update `OUTER-LOOP.md`'s inbox-drain step (currently reads
   only `directives/pending/`) to ALSO run `task_list --label directive`, reconciled against the
   files — so future outer passes see both channels, not just files.
5. **Live dogfood demonstration**: actually run `/quay-directive` once for real (a small, genuinely
   true finding from this milestone's own work is fine — e.g. drafting a DIR that documents "the
   M-DIR-PROJECTION milestone itself dogfoods this mechanism" is acceptable if truthful) and paste
   the real resulting task + a real Web UI `?label=directive` screenshot or curl transcript.
6. Do NOT delete or migrate any existing `DIR-*.md` file's authoritative status. Do NOT build a
   general-purpose task-projection framework beyond directives — scope is directives only.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's V_instance shape)
1. `[ ]` Running `/quay-directive` once (real invocation, not simulated) produces BOTH the file AND
   a `label: directive` task whose body links the file — pasted evidence (task_get/task_list
   output), not prose.
2. `[ ]` Web UI `?label=directive` lists that directive alongside dev tasks — pasted real
   screenshot or `curl` transcript (dogfooding evidence-gate discipline, per M-GATES).
3. `[ ]` Anti-drift reconciliation check script exists, is committed, and is demonstrated catching
   BOTH failure modes (task-with-no-file AND status-disagreement) with pasted PASS/FAIL output for
   each — not just the pass case.
4. `[ ]` `OUTER-LOOP.md`'s inbox-drain step is updated to also read `task_list --label directive`.
5. `[ ]` Full existing test suite still passes (no regression) — pasted raw output.

Milestone is DONE when all five are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first (ΔV plateau K=2, ceiling, budget≈10 past with nothing
climbing, external HALT).

## HARD GATES (Tier-A, transcluded byte-for-byte from the pinned template — §3.1, DIR-009 defense)

Source: `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` §0, fenced HARD GATES block
(lines 100-131 at charter-authoring time). Transcluded verbatim below; only the worktree/branch
path is parameterized per this milestone:

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
[ ] git worktree add experiments/quay-perpetual-stream/milestones/M05-dir-projection/worktrees/iteration-N
    -b exp5-m05-iteration-N  [PARAM: exp5 milestone worktree path + branch name]
    → paste the "HEAD is now at <hash>" line. Creating the worktree is NOT the
      gate — WRITING THIS ITERATION'S CHANGES INTO IT is. All development/test
      edits this iteration must target paths UNDER worktrees/iteration-N/, not
      the shared tree at repo root. See the end-of-iteration isolation proof
      gate below; the two are one requirement checked at both ends.
```

Additional gates (unparameterized, copied unchanged from the same §0 block, applicable as-is):
- Git worktree isolation END-OF-ITERATION PROOF (paste `git -C .../worktrees/iteration-N status
  --short` showing this iteration's writes landed there, AND `git -C <repo root> status --short --
  .claude/ experiments/` clean [PARAM: this milestone edits `.claude/skills/quay-directive/
  SKILL.md`, `experiments/quay-perpetual-stream/{scripts,OUTER-LOOP.md}`, and possibly a real new
  `directives/pending/DIR-NNN.md` from the live dogfood demonstration]).
- verification_coverage spot-check every iteration boundary.
- system_health regression check (no regression vs. exp1/exp2/exp3 inherited V-factor snapshots).
- All background dispatches (iteration/audit/simulated-user subagents) confirmed `run_in_background=true`.

**Gate-hash check (it0 systematic-explore, §4.4b) — MECHANIZED via M-GATES' script:**
```
$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh experiments/quay-perpetual-stream/charters/M05-dir-projection.md
```
Run this before dispatch and paste the result in the dashboard log (do not just assert PASS).

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop (compute at it0: is a
`task_write`-based projection reachable given the existing native-provider task store + label
filter already exist (`mcp-server.js`, confirmed at charter-authoring time)? Yes — no redesign
trigger) · (4) budget≈10 backstop, past→default HALT · (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work, MECHANIZED per M-GATES)
a. **Ceiling/floor arithmetic** — this milestone's in-scope work does not cite existing gap-list
   IDs to close (it builds new tooling); the applicable ceiling question is "does a directive→task
   projection mechanism already exist anywhere in this repo?" — checked at charter-authoring time:
   `grep -rn "label.*directive\|directive.*label" packages/*/src .claude/skills/quay-directive/`
   found nothing matching this shape (only the plain file-writing skill). Not already done, not
   unreachable.
b. **Gate-hash/transclusion** — run `it0-gate-hash-check.sh` against this file per the block above;
   record actual PASS/FAIL output in the dashboard log before dispatch, not an assumption.
c. **Dogfooding evidence-gate** — Done-when clauses 1-3 explicitly require pasted task/UI/script
   evidence, not prose; `it0-dogfood-evidence-gate.sh` can be run against this milestone's own
   iteration report once written, as a self-check.
d. **Domain-misfit audit-channel** — per `inherited-core.md`'s decision procedure: this milestone's
   domain (directive/task reconciliation) has a natural audit channel that IS this milestone's own
   Done-when clause 3 — the anti-drift check itself, run standing (e.g. as part of future outer-loop
   drain passes) — same CI-job/standing-check≡audit-channel pattern already confirmed twice
   (M01-dist, M03-abi-eval).

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above.
Record each iteration under `experiments/quay-perpetual-stream/milestones/M05-dir-projection/iterations/`.
