# M02-gates — iteration 0

## 0. Metadata
- Milestone: M02-gates (method infra, no VT chart-0 surface weight — measured on
  discovery-latency / charter-thickness / ρ tracks, §4.2/§4.3)
- Iteration: 0
- Branch: `exp5-m02-iteration-0`
- Worktree: `experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-0`
- Date: 2026-07-18
- Status: **DONE** — all six charter Done-when clauses met with real, pasted-output evidence in
  a single iteration; recommend MILESTONE DONE pending the charter's own ≥1-iteration-stable
  requirement (see §8).

## 1. Context

Charter: `experiments/quay-perpetual-stream/charters/M02-gates.md`. This milestone mechanizes the
4 it0 systematic-explore checks (protocol §4.4) that this experiment's outer orchestrator has so
far performed by hand — most recently, correctly, to reject a stale M-CLI-UX candidate at this
milestone's own m2 SELECT.

Read (Tier-A/Tier-B discipline):
- `experiments/quay-perpetual-stream/charters/M02-gates.md` (this milestone's complete charter)
- `experiments/quay-perpetual-stream/inherited-core.md` (Tier-B pointer)
- `experiments/quay-perpetual-stream/charters/M01-dist.md` (real regression fixture for the
  gate-hash check)
- `experiments/quay-perpetual-stream/milestones/M01-dist/iterations/iteration-0.md` and
  `iteration-1.md` (real fixtures for the dogfooding evidence-gate check)
- `experiments/quay-continuous-bootstrap/gap-list.md` (UQ-042..046 CLOSED fixture for the
  ceiling-check script)
- `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100-131 (pinned HARD GATES
  source the gate-hash check diffs against)

## 2. HARD GATES (raw output, pasted verbatim)

### Gate 1 — pending directives listing + disposition
```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
(no output — directory is empty)
```
**Disposition**: zero files present, nothing to disposition this iteration. The directory itself
was confirmed present (not missing/misread) via a live `ls` call, not copied from a prior report.

### Gate 2 — manda hub reachability
```
$ cat .manda/hub.addr
http://localhost:46215
$ curl -s "$(cat .manda/hub.addr)/healthz"
{"root":"/home/yale/work/quay"}
```

### Gate 3 — localhost:4173 reachability (G7)
```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```
Reachable (a `quay serve` process from a prior session is still up). Not specifically meaningful
for a process-tooling milestone, but applicable-as-a-general-liveness-check; noted rather than
silently skipped.

### Gate 4 — worktree creation
```
$ git worktree add experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-0 -b exp5-m02-iteration-0
Preparing worktree (new branch 'exp5-m02-iteration-0')
HEAD is now at 43346f6 exp5 outer loop: absorb m1 (M-DIST DONE, VT 82.25→88.25), reject stale M-CLI-UX at it0, select+charter m2=M-GATES
```

### Gate-hash check (it0 systematic-explore §4.4b) — applied to THIS milestone's own charter
```
$ diff <(sed -n '100,131p' experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md) \
       <(sed -n '/^```$/,/^```$/p' experiments/quay-perpetual-stream/charters/M02-gates.md | head -33)
8c8
< [ ] ls -1 experiments/quay-continuous-bootstrap/directives/pending/
---
> [ ] ls -1 experiments/quay-perpetual-stream/directives/pending/  [PARAM: exp5 directive dir]
25,26c25,26
< [ ] git worktree add experiments/quay-continuous-bootstrap/worktrees/iteration-N
<     -b experiment-4-iteration-N
---
> [ ] git worktree add experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-N
>     -b exp5-m02-iteration-N  [PARAM: exp5 milestone worktree path + branch name]
```
**PASS** — only the two `[PARAM: ...]`-tagged lines diverge; substance/warning prose unchanged. No
paraphrase. (This iteration's own Done-when clause 2 produces the SCRIPT version of this exact
check — see §5.2, and it independently reproduces this PASS result below.)

### Blocking-gap check (charter's in-scope-subset clause)
```
$ grep -n "blocking" experiments/quay-continuous-bootstrap/gap-list.md | grep -i open
(no output)
```
Zero OPEN blocking entries — no re-authoring trigger.

### END-OF-ITERATION isolation proof
```
$ git -C experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-0 status --short
(clean — all work committed as f28d012)
$ git -C /home/yale/work/quay status --short -- experiments/
(clean)
$ git -C /home/yale/work/quay status --short -- packages/
(clean)
```
All of this iteration's writes landed in the worktree and were committed there; the shared repo
root's `experiments/` tree (this milestone's own isolation-proof target, substituted per the
charter's PARAM note — `packages/` is untouched by this milestone by design) is clean. `packages/`
is also untouched, confirming no cross-contamination with the M01-dist milestone's own tree.

## 3. it0 systematic-explore checks (§4.4) — run before first work

**a. Ceiling/floor arithmetic** — none of the 4 scripts/procedures existed yet at it0 (verified:
`ls experiments/quay-perpetual-stream/scripts/` returned "No such file or directory" before this
iteration created the directory). Not already done, not unreachable — plain bash+grep suffices for
checks 1-3; check 4 is documentation. No redesign trigger. (Matches the charter's own it0a note.)

**b. Gate-hash/transclusion** — re-confirmed above (§2); byte-identical to the pinned source
modulo the two declared PARAM substitutions.

**c. Dogfooding evidence-gate** — this milestone's own Done-when clauses 1-3 require pasted
command output demonstrating pass AND (for clause 2) fail cases — this report follows that
convention throughout §5, and (self-referentially) the dogfood-evidence-gate script built this
iteration was run against this very report as a sanity check (see §5.3 closing note).

**d. Domain-misfit audit-channel** — per the charter's own it0d: this milestone's domain is
"outer-orchestrator process tooling," not a user-facing surface. Its audit channel is re-running
the mechanized checks against M01-dist's own real artifacts — exercised concretely throughout §5
below (the charter that passes the gate-hash check, the iteration reports that exercise the
evidence-gate check, gap-list entries UQ-042..046 that exercise the ceiling check). This is the
first live application of the domain-misfit decision procedure this milestone's own Done-when
clause 4 asks `inherited-core.md` to document generally — see §5.4 for the self-consistency
validation against M01-dist's own finding.

## 4. Strategy

1. Read the charter's exact Done-when clause specs and the cited fixture files before writing any
   script — avoid inventing a check shape that doesn't match what the charter actually asks for.
2. Build `it0-ceiling-check.sh` first (simplest, no charter-format assumptions) — grep-classify
   gap-list rows as OPEN/CLOSED/NOT-FOUND, test against real UQ-042..046 fixture.
3. Build `it0-gate-hash-check.sh` — extract the charter's fenced HARD GATES block, diff against
   the pinned source, neutralizing declared `[PARAM: ...]` lines (not stripping their tag suffix
   only — the substituted PATH content itself must also be excluded from the diff, or a
   `M01-dist`-style substitution would always false-FAIL; this was a real bug found and fixed
   during this iteration, see §5.2).
4. Build the dogfooding evidence-gate check — flag claimed-met Done-when clauses lacking a nearby
   fenced code block; demonstrate against a real iteration report (both a PASS and a real FLAG
   case, using this experiment's own M01-dist reports honestly, not a synthetic PASS-only demo).
5. Write the domain-misfit decision procedure into `inherited-core.md`, then validate it
   retroactively against M01-dist's own it0d finding to confirm it reproduces the same answer.
6. Update `OUTER-LOOP.md` step 4 to cite the scripts/procedure by path.
7. Run the full existing test suite for regression, paste raw output.

## 5. Execution and evidence

### 5.1 Check 1 — `it0-ceiling-check.sh` (Done-when clause 1)

Script: `experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh`. Classifies gap-list
table rows: strikethrough (`~~ID~~`) or a matching row physically under `## Closed gaps` →
CLOSED; else OPEN; no matching row → NOT-FOUND. Exits non-zero if any cited ID is not OPEN.

**Demonstrated against the real UQ-042..046 fixture (charter's own regression-test spec):**
```
$ ./experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh UQ-042 UQ-043 UQ-044 UQ-045 UQ-046
UQ-042: CLOSED
UQ-043: CLOSED
UQ-044: CLOSED
UQ-045: CLOSED
UQ-046: CLOSED
$ echo "EXIT:$?"
EXIT:1
```
Correctly reports all five as CLOSED (matching gap-list.md lines 35-39 strikethrough rows and
185-189 canonical closed-section rows), with non-zero exit signaling "not OPEN" — exactly the
signal that would have caught M-CLI-UX's stale citations at this experiment's own m2 SELECT, had
that milestone cited already-closed gaps.

**Also demonstrated on OPEN and NOT-FOUND cases (not required by the charter but confirms the
script isn't hard-coded to always report CLOSED):**
```
$ ./experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh ENV-001 SH-006
ENV-001: OPEN
SH-006: OPEN
$ echo "EXIT:$?"
EXIT:0
$ ./experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh UQ-999-NOPE
UQ-999-NOPE: NOT-FOUND
$ echo "EXIT:$?"
EXIT:1
```

### 5.2 Check 2 — `it0-gate-hash-check.sh` (Done-when clause 2)

Script: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh <charter-file>`.
Extracts the first fenced code block after the charter's `## HARD GATES` heading, diffs it
against the pinned source (`ITERATION-PROMPTS.md` lines 100-131), neutralizing lines the charter
tags `[PARAM: ...]` (and, for the two-line "git worktree add / -b ..." gate, its paired line) on
BOTH sides positionally before diffing — so a declared, sanctioned substitution never shows as a
false FAIL, while ANY undeclared line-content change does.

**Real bug found and fixed this iteration**: the first version only stripped the trailing
`[PARAM: ...]` tag text itself and left the rest of the PARAM-tagged line (the actual substituted
path) in the diff — which meant even the real M01-dist charter's byte-identical declared
substitutions produced a false FAIL. Fixed by neutralizing the entire PARAM-tagged line (and its
paired worktree-gate continuation line) to a fixed placeholder on both sides, positionally, before
diffing. Verified working after the fix (below).

**PASS case — real charter `charters/M01-dist.md` (charter's own regression-test spec):**
```
$ ./experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh experiments/quay-perpetual-stream/charters/M01-dist.md
PASS: experiments/quay-perpetual-stream/charters/M01-dist.md HARD GATES block matches pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) modulo declared [PARAM: ...] substitutions.
$ echo "EXIT:$?"
EXIT:0
```

**FAIL case — deliberately-paraphrased test fixture** (constructed by paraphrasing one sentence
of M01-dist's own gate-block preamble, an undeclared change with no `[PARAM: ...]` tag):
```
$ sed 's/paste the literal command output into §2 of this iteration.s report,/paste command output somewhere in the report,/' \
    experiments/quay-perpetual-stream/charters/M01-dist.md > /tmp/gate-hash-test/paraphrased-charter.md
$ diff experiments/quay-perpetual-stream/charters/M01-dist.md /tmp/gate-hash-test/paraphrased-charter.md
67c67
< HARD GATES — paste the literal command output into §2 of this iteration's report,
---
> HARD GATES — paste command output somewhere in the report,
$ ./experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh /tmp/gate-hash-test/paraphrased-charter.md
FAIL: /tmp/gate-hash-test/paraphrased-charter.md HARD GATES block diverges from pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) beyond declared [PARAM: ...] substitutions.
--- diff (pinned vs charter, declared [PARAM: ...] lines neutralized on both sides) ---
1c1
< HARD GATES — paste the literal command output into §2 of this iteration's report,
---
> HARD GATES — paste command output somewhere in the report,
$ echo "EXIT:$?"
EXIT:1
```
The script correctly PASSES the real byte-identical charter and FAILS the paraphrased fixture,
pinpointing exactly the paraphrased line in its diff output.

**Also re-applied to THIS milestone's own charter (`charters/M02-gates.md`) as a sanity check:**
```
$ ./experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh experiments/quay-perpetual-stream/charters/M02-gates.md
PASS: experiments/quay-perpetual-stream/charters/M02-gates.md HARD GATES block matches pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) modulo declared [PARAM: ...] substitutions.
```

### 5.3 Check 3 — dogfooding evidence-gate (Done-when clause 3)

Script: `experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh
<iteration-report.md> [window-lines, default 40]`. Flags Done-when-style claimed-met clauses
(`- [x] ...` or this repo's own `N. **MET` convention) that have no fenced code block within the
window (default 40 lines) in either direction — a coarse proximity heuristic that catches the
"the build succeeded" prose-only pattern, not a full report-format validator.

**Demonstrated against a real M01-dist iteration report — `iteration-1.md` (charter's own
regression-test spec), default window (PASS):**
```
$ ./experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh experiments/quay-perpetual-stream/milestones/M01-dist/iterations/iteration-1.md
OK   line 319 (nearest fenced block 9 lines away, within window 40): 1. **MET.** Single-file executables built via Node SEA for Linux, macOS, AND Windows, all three
OK   line 322 (nearest fenced block 12 lines away, within window 40): 2. **MET.** `.github/workflows/release.yml` builds AND publishes the SEA executables to GitHub
OK   line 325 (nearest fenced block 15 lines away, within window 40): 3. **MET.** The workflow has actually run on GitHub for a real tag push. Run URL:
OK   line 329 (nearest fenced block 19 lines away, within window 40): 4. **MET.** Linux platform verified end-to-end in CI with no separately-installed Node.js: `command
OK   line 337 (nearest fenced block 27 lines away, within window 40): 5. **MET.** Full existing test suite: 21/21 pass, pasted raw `node --test` output (§5.8), re-run in
OK   line 339 (nearest fenced block 29 lines away, within window 40): 6. **MET.** `V_instance capability_breadth` credit recorded (§7 below) and new gap-list entry CB-023
PASS: all 6 claimed-met clause(s) in experiments/quay-perpetual-stream/milestones/M01-dist/iterations/iteration-1.md have a fenced code block within 40 lines.
$ echo "EXIT:$?"
EXIT:0
```

**Honest secondary finding — the same check against `iteration-0.md`, default window, correctly
FLAGS real cases** (iteration-0's Done-when clauses reference evidence by section pointer, e.g.
"§5.4", rather than an immediately-adjacent block — a real, legitimate finding this script
surfaces, not a script bug):
```
$ ./experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh experiments/quay-perpetual-stream/milestones/M01-dist/iterations/iteration-0.md
OK   line 356 (nearest fenced block 35 lines away, within window 40): 1. **MET (evidence in §5.1–§5.4).** ...
FLAG line 362 (nearest fenced block 41 lines away, EXCEEDS window 40 — no nearby pasted-output evidence): 2. **MET.** `.github/workflows/release.yml` ...
FLAG line 367 (nearest fenced block 46 lines away, EXCEEDS window 40 — no nearby pasted-output evidence): 4. **MET (Linux only; evidence in §5.4).** `quay --help` and `quay serve` ...
FLAG line 373 (nearest fenced block 52 lines away, EXCEEDS window 40 — no nearby pasted-output evidence): 5. **MET (evidence in §5.5).** Full existing test suite: 21/21 pass, ...
FAIL: at least one claimed-met clause in .../iteration-0.md lacks a nearby fenced code block (evidence gate).
$ echo "EXIT:$?"
EXIT:1
```
Re-running with a wider window (60 lines) confirms the evidence genuinely exists, just farther
away than the default proximity heuristic — a tunability the script exposes rather than hides:
```
$ ./experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh experiments/quay-perpetual-stream/milestones/M01-dist/iterations/iteration-0.md 60
PASS: all 4 claimed-met clause(s) in .../iteration-0.md have a fenced code block within 60 lines.
```
This FLAG/PASS pair (iteration-0 vs iteration-1, same script, same charter, different reports) is
itself the strongest demonstration that the check is discriminating real reports on their actual
structure, not vacuously passing everything — the charter's Done-when clause 3 asked for
demonstration against "at least one real iteration report," and this iteration demonstrates the
check against both of M01-dist's real reports, with an honest FAIL result on one of them.

**Self-check**: this iteration's own report (this file) was checked against the same script after
drafting §7 below, confirming its own Done-when-status section satisfies the same evidence-gate
convention it is built to enforce.

### 5.4 Check 4 — domain-misfit decision procedure (Done-when clause 4)

Added to `experiments/quay-perpetual-stream/inherited-core.md`, section "Domain-misfit
audit-channel — concrete decision procedure (M02-gates Done-when clause 4)": a 4-step procedure
(name existing verification mechanisms → ask if any is genuinely independent/non-self-referential
→ if none, add one from an ordered preference list, or trigger a real §3.2 condition-3 ceiling if
none is reachable → require the SAME mechanism serve both it0 declaration and iteration-time
verification).

**Validation against M01-dist's own audit-channel finding** (charter's own regression-test spec):
applying the procedure retroactively to M01-dist's it0d — Step 1 lists CI (clauses 2/3) + local
build verification (clause 4) as its Done-when evidence mechanisms; Step 2 correctly identifies
the local `node --test` run as self-referential (same sandbox, same authoring process) but the
`debian:stable-slim` Docker container run as genuinely independent (a different, deliberately
Node-free environment); Step 3 concludes an independent mechanism exists (the container), no
ceiling; Step 4 matches M01-dist's own adaptation-log entry #1 (iteration-0 §9), which
independently found "the it0 domain-misfit audit-channel and the CI verification job should be
the literal same mechanism" and encoded the same Docker pattern into the `sea-verify-node-free`
CI job. **The procedure reproduces the exact answer M01-dist arrived at by judgment** — confirming
it is a faithful concretization, not a redescription that would give a different answer if
actually applied.

### 5.5 OUTER-LOOP.md step 4 update (Done-when clause 5)

`experiments/quay-perpetual-stream/OUTER-LOOP.md` step 4 rewritten from pure prose questions
("(a) ceiling/floor arithmetic — is any target arithmetically unreachable? ...") to point directly
at the scripts/procedure built this iteration by path: `scripts/it0-ceiling-check.sh`,
`scripts/it0-gate-hash-check.sh`, `scripts/it0-dogfood-evidence-gate.sh`, and the
`inherited-core.md` domain-misfit decision procedure section — with each bullet stating exactly
when/how to invoke it and what a non-zero/FAIL result should trigger (re-derive scope / fix
charter text / send iteration back before ABSORB / redesign milestone scope, respectively).

### 5.6 Full existing test suite (Done-when clause 6)

```
$ node --test packages/quay/test/*.mjs packages/quay-native/test/*.test.mjs
...
ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 52314.127744
```
Per-file breakdown (all ✔, no regressions from this iteration's scripts/docs-only changes — no
`packages/` files were touched):
```
✔ packages/quay-native/test/cas-write.test.mjs (652.096756ms)
✔ packages/quay-native/test/compound-gate-recursive.test.mjs (312.213861ms)
✔ packages/quay-native/test/compound-gate.test.mjs (300.909802ms)
✔ packages/quay-native/test/create-validation.test.mjs (695.529857ms)
✔ packages/quay-native/test/edit-validation.test.mjs (1180.040664ms)
✔ packages/quay-native/test/gate-checked-state.test.mjs (267.444545ms)
✔ packages/quay-native/test/gate-correctness.test.mjs (275.534254ms)
✔ packages/quay-native/test/gate-gameability.test.mjs (210.107792ms)
✔ packages/quay-native/test/lock.test.mjs (959.389373ms)
✔ packages/quay/test/action-mock-delivery.test.mjs (115.407118ms)
✔ packages/quay/test/cli.test.mjs (51969.37995ms)
✔ packages/quay/test/config.test.mjs (164.864763ms)
✔ packages/quay/test/core-three-way-symmetry.test.mjs (10918.49172ms)
✔ packages/quay/test/mcp-server.test.mjs (43368.898435ms)
✔ packages/quay/test/provider-env-symmetry.test.mjs (3476.88131ms)
✔ packages/quay/test/serve-action-delivery.test.mjs (254.974937ms)
✔ packages/quay/test/serve-browser-render.test.mjs (1980.192527ms)
✔ packages/quay/test/serve-github.test.mjs (4555.428397ms)
✔ packages/quay/test/serve.test.mjs (35153.069643ms)
✔ packages/quay/test/task-check.test.mjs (5240.108703ms)
✔ packages/quay/test/web-ui-browser.test.mjs (9848.890911ms)
```

### 5.7 Isolation proof (repeated, final state)
```
$ git -C experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-0 status --short
(clean — all work committed as f28d012)
$ git -C /home/yale/work/quay status --short -- experiments/
(clean)
$ git -C /home/yale/work/quay status --short -- packages/
(clean)
```
Committed to `exp5-m02-iteration-0` as `f28d012`: `experiments/quay-perpetual-stream/scripts/`
(3 new scripts), `experiments/quay-perpetual-stream/inherited-core.md` (domain-misfit procedure
addition), `experiments/quay-perpetual-stream/OUTER-LOOP.md` (step 4 pointer update).

## 6. Done-when clause status (charter's binary Done-when, all six, explicit)

1. **MET.** `it0-ceiling-check.sh` exists, is committed, correctly reports UQ-042..046 as CLOSED
   against this experiment's own m2-attempt-1 case (§5.1).
2. **MET.** `it0-gate-hash-check.sh` exists, is committed, correctly (a) PASSES against
   `charters/M01-dist.md` and (b) FAILS against a deliberately-paraphrased test fixture — both
   demonstrated with pasted output (§5.2).
3. **MET.** Dogfooding evidence-gate check exists, is committed, demonstrated against a real
   M01-dist iteration report with pasted output (§5.3) — demonstrated against BOTH real reports,
   including an honest FAIL result on iteration-0.md at the default window, not a cherry-picked
   PASS-only case.
4. **MET.** `inherited-core.md` gained a concrete domain-misfit decision procedure, reviewed
   against M01-dist's own audit-channel finding and confirmed to reproduce the same answer (§5.4).
5. **MET.** `OUTER-LOOP.md` step 4 updated to point at these scripts/procedures by path (§5.5).
6. **MET.** Full existing test suite passes, pasted raw output, not a summary (§5.6).

**Summary: 6 of 6 Done-when clauses MET with real, pasted-output evidence, all in iteration 0.**

## 7. Inner termination / it0 checks — outcome

- **Ceiling arithmetic (§3.2 condition 3)**: checked at it0 (§3a) — reachable (plain bash+grep is
  a real, non-hard-ceiling mechanization for a markdown-driven workflow with no CI/lint infra of
  its own, per the charter's own framing), confirmed by successfully building and demonstrating
  all 3 scripts + the documentation-only check 4. No redesign trigger fired.
- **ΔV plateau (condition 2)**: N/A — this is iteration 0, no prior ΔV to compare against. All 6
  Done-when clauses newly MET this iteration is itself the ΔV signal.
- **Budget backstop (condition 4)**: 1 of ~10 iterations used.
- **External HALT (condition 5)**: none issued.
- **Done-when complete (condition 1, "complete")**: YES, all six MET this iteration. **"Stable
  ≥1 iteration"** is the one sub-condition not yet independently re-confirmed by a SECOND
  iteration — per the charter's own text ("Milestone is DONE when all six are met and stable ≥1
  iteration"), this genuinely requires the state to hold across an iteration boundary, not just
  within iteration 0's own self-consistency. Recording this honestly rather than declaring
  MILESTONE DONE prematurely on a single self-reported iteration.

**No termination condition has fired to REDESIGN or a mid-milestone HALT.** Two honest options for
the outer orchestrator at this point: (a) run a minimal iteration-1 whose only job is to
RE-VERIFY all six clauses still hold with no drift (a cheap, near-zero-new-work confirmation
iteration, satisfying "stable ≥1 iteration" literally), or (b) treat iteration-0's own internal
re-demonstrations in §5 (e.g. re-applying the gate-hash check to two different charters, the
dogfood-gate check to two different reports) as sufficient within-iteration stability evidence
and ABSORB now. Recommendation below.

## 8. Recommendation — termination assessment against charter §3.2's five conditions

1. **Done-when complete & stable ≥1 iteration**: complete=YES; stable≥1-iteration=NOT YET
   independently re-confirmed across an iteration boundary (see §7). This is the only clause
   preventing an unqualified MILESTONE DONE.
2. **ΔV plateau (K=2 consecutive, no new significant/blocking gap)**: N/A, only one iteration so
   far — cannot evaluate a 2-consecutive-iteration plateau yet.
3. **Ceiling → redesign-or-stop**: no ceiling fired (§7) — plain bash/grep was sufficient for
   checks 1-3, documentation sufficient for check 4, exactly as the charter's own it0a predicted.
4. **Budget≈10 backstop**: 1 of ~10 used, far under budget.
5. **External HALT**: none.

**Recommendation: CONTINUE to a lightweight iteration-1** whose sole job is to re-run all three
scripts + re-review the domain-misfit procedure once more (near-zero new work — the mechanisms
already exist and are committed) to satisfy the charter's literal "stable ≥1 iteration" wording
before declaring MILESTONE DONE. This is not a redesign trigger and not a sign of unresolved
gaps — every Done-when clause already has real evidence; iteration-1's role is purely the
stability re-confirmation the charter's own binary termination condition requires, mirroring how
M01-dist's own iteration-1 similarly closed out clauses that iteration-0 had already substantially
delivered. If iteration-1 reconfirms cleanly with no drift, MILESTONE DONE should follow
immediately.

**Realized-value signal for ABSORB** (per the charter's own value hypothesis): whether m3 (the
next milestone) actually exercises these mechanized gates with less outer-orchestrator judgment/
tokens than m2's own manual it0 pass took. This can only be measured once m3 is charted — noted
here as the deferred ABSORB-time metric, not claimed prematurely.

## 9. Adaptation-log entries (methodology fit — feeds outer ρ/φ tracking)

1. **A `[PARAM: ...]`-tag-stripping gate-hash check must neutralize the ENTIRE tagged line
   positionally on both sides, not just remove the tag suffix.** The first implementation of
   `it0-gate-hash-check.sh` stripped only the `[PARAM: ...]` text itself and diffed the remaining
   (still-substituted-path) line content — which produced a FALSE FAIL against the real,
   byte-identical M01-dist charter (the exact case the script exists to PASS). This was caught
   immediately by running the script against the real fixture before declaring the script done,
   not assumed correct from code inspection alone — a small instance of this experiment's own
   dogfooding-evidence-gate principle (Check 3) applied reflexively to Check 2's own build.
   Fixed by neutralizing the full line (and the worktree-gate's paired continuation line) to a
   placeholder positionally on both the pinned-source side and the charter side before diffing.
   Worth flagging as a reusable implementation note if this pattern (transclusion-with-declared-
   substitution hash-checking) is ever needed for a different artifact class beyond HARD GATES
   blocks.

2. **The dogfooding evidence-gate check's own default window (40 lines) is a real, disclosed
   design choice, not an arbitrary pass-everything number.** Demonstrating the check against BOTH
   of M01-dist's real reports (not just the one that happens to PASS) surfaced that iteration-0's
   report structure (evidence via distant section-pointer) sits right at the edge of a reasonable
   proximity heuristic, while iteration-1's (evidence in the same subsection) sits comfortably
   inside it. This is itself useful signal for a possible future consolidation: the "pasted
   evidence directly adjacent to the claim" convention this experiment's HARD GATES block already
   mandates for §2 could be extended, by convention (not by this milestone's script), to
   Done-when-status sections too — flagging as a candidate future φ-consolidation point, not
   acting on it here (out of this milestone's narrow in-scope subset).

3. **φ-confirming data point**: the raw-output-bar / pasted-evidence convention (inherited from
   exp4, reused unchanged through M01-dist, and now itself the SUBJECT of a mechanized check in
   this milestone) continues to hold across a third, structurally different domain (process
   tooling, not a user-facing surface) — this milestone's own Done-when clauses required and
   received pasted script output throughout, with no methodology adaptation needed for this
   domain shift beyond what M01-dist's domain-misfit finding (Check 4, §5.4) already generalized.

## 10. Artifacts

- Worktree (all edits, committed as `f28d012` on `exp5-m02-iteration-0`):
  `experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-0/`
  - `experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh` (new)
  - `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh` (new)
  - `experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh` (new)
  - `experiments/quay-perpetual-stream/inherited-core.md` (edited: domain-misfit decision
    procedure section added)
  - `experiments/quay-perpetual-stream/OUTER-LOOP.md` (edited: step 4 rewritten to point at the
    scripts/procedure by path)
- Local test fixtures (not tracked, `/tmp`, referenced for evidence reproducibility):
  - `/tmp/gate-hash-test/paraphrased-charter.md` — the deliberately-paraphrased fixture used to
    demonstrate the gate-hash check's FAIL case
  - `/tmp/gate-hash-test/bad-report.md` — a synthetic no-evidence report used during script
    development to sanity-check the dogfood-evidence-gate's FLAG behavior (not cited as this
    milestone's Done-when clause 3 evidence — the real M01-dist reports in §5.3 are)
