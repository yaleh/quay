# M02-gates — iteration 1

## 0. Metadata
- Milestone: M02-gates (method infra, no VT chart-0 surface weight)
- Iteration: 1
- Branch: `exp5-m02-iteration-1` (branched from `exp5-m02-iteration-0` @ `f28d012`)
- Worktree: `experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-1`
- Date: 2026-07-18
- Status: **DONE — stability re-confirmed, no drift, no new edits needed.** All six charter
  Done-when clauses independently re-verified with fresh command output. **MILESTONE DONE.**

## 1. Context

Charter: `experiments/quay-perpetual-stream/charters/M02-gates.md`. Iteration-0 built and committed
(`f28d012`) all 6 Done-when artifacts in a single iteration but explicitly declined to declare
MILESTONE DONE because the charter's own termination condition 1 requires Done-when-complete AND
"stable ≥1 iteration" — a state that by definition cannot be self-certified within the same
iteration that created it. This iteration's sole job is independent re-verification: re-run every
check against its original fixture with fresh command output (not cite iteration-0's pasted output
as still valid), confirm the committed state (not worktree-only) still holds, and render the final
termination call.

Read (Tier-A/Tier-B discipline):
- `experiments/quay-perpetual-stream/charters/M02-gates.md` (charter, unchanged since authoring)
- `experiments/quay-perpetual-stream/milestones/M02-gates/iterations/iteration-0.md` (full read,
  prior state)
- `experiments/quay-perpetual-stream/inherited-core.md` (Tier-B pointer)

No new fixture reads were needed beyond what iteration-0 already cited (UQ-042..046 in
`experiments/quay-continuous-bootstrap/gap-list.md`, `charters/M01-dist.md`, M01-dist's own
iteration-0.md/iteration-1.md reports) — this iteration re-exercises the same fixtures, not new
ones, per the charter's explicit "re-verify, not redo" framing.

## 2. HARD GATES (raw output, pasted verbatim)

### Gate 0 — branch lineage verification (lesson from M01-dist iteration-1: verify, don't take on faith)
```
$ git branch -a | grep -i m02
+ exp5-m02-iteration-0
$ git log exp5-m02-iteration-0 --oneline -5
f28d012 M02-gates iteration-0: mechanize it0 checks 1-3, add domain-misfit decision procedure, wire OUTER-LOOP.md
43346f6 exp5 outer loop: absorb m1 (M-DIST DONE, VT 82.25→88.25), reject stale M-CLI-UX at it0, select+charter m2=M-GATES
d9df5b4 Merge M01-dist (exp5 milestone): Node SEA single-file executables + CI release
77c58c6 exp5 M01-dist iteration-1: close CB-023 gap-list entry (DIR-004 SEA/Bun half)
cb53af5 exp5 M01-dist iteration-1: fix private-repo release asset download (404 via browser_download_url)
```
Confirmed: `f28d012` is really present as the HEAD of `exp5-m02-iteration-0`, not just claimed in
prose — matches iteration-0's own report citation exactly.

### Gate 1 — pending directives listing + disposition
```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
(no output — directory is empty)
```
**Disposition**: zero files present, nothing to disposition this iteration. Directory confirmed
present via a live `ls` call this iteration (not copied from iteration-0's report).

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

### Gate 4 — worktree creation, branched from iteration-0
```
$ git worktree add experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-1 -b exp5-m02-iteration-1 exp5-m02-iteration-0
Preparing worktree (new branch 'exp5-m02-iteration-1')
HEAD is now at f28d012 M02-gates iteration-0: mechanize it0 checks 1-3, add domain-misfit decision procedure, wire OUTER-LOOP.md
```
Confirms iteration-1's worktree branches from the real, committed iteration-0 state.

### Blocking-gap check (charter's in-scope-subset clause)
```
$ grep -n "blocking" experiments/quay-continuous-bootstrap/gap-list.md | grep -i open
(no output)
```
Zero OPEN blocking entries — no re-authoring trigger, unchanged from iteration-0.

### END-OF-ITERATION isolation proof
```
$ git -C experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-1 status --short
(clean — no edits needed this iteration; re-verification found no drift)
$ git status --short -- experiments/
?? experiments/quay-perpetual-stream/milestones/M02-gates/
$ git status --short -- packages/
(clean)
```
The single untracked entry at repo root is the new `worktrees/iteration-1/` directory itself (a
side effect of `git worktree add`, same pattern iteration-0 exhibited for its own worktree) — not
staged content or an edit. No files were modified this iteration; re-verification alone required no
new commits.

## 3. it0 systematic-explore checks (§4.4) — re-run before this iteration's work

Since this iteration's task is re-verification, not new work, the it0 checks collapse into the
same re-verification exercise as §4-5 below — no separate pre-work check was warranted (the
"work" this iteration IS the check).

## 4. Strategy

1. Re-verify branch lineage (`f28d012` really present, per the M01-dist iteration-1 lesson about
   not taking claimed hashes on faith).
2. Re-run all 3 scripts against their original fixtures, independently, with fresh pasted output.
3. Confirm `inherited-core.md` and `OUTER-LOOP.md` changes are present in the COMMITTED branch
   (`git show <branch>:<path>`, not just the checked-out worktree file).
4. Re-run the full test suite fresh.
5. Investigate the Check-3 FAIL-on-iteration-0.md case specifically: is it a correct positive or a
   script limitation producing a false positive?
6. Render the termination call.

## 5. Execution and evidence

### 5.0 Check 4 — domain-misfit decision procedure and OUTER-LOOP.md pointer, confirmed COMMITTED

Both artifacts confirmed present via `git show <committed-branch>:<path>` (not the checked-out
worktree file, which could theoretically diverge from what's actually committed — this is the
distinction the M01-dist iteration-1 lesson about verifying claimed hashes generalizes to: verify
the committed ref, not the working tree):

```
$ git show exp5-m02-iteration-0:experiments/quay-perpetual-stream/inherited-core.md | grep -n "Domain-misfit"
41:## Domain-misfit audit-channel — concrete decision procedure (M02-gates Done-when clause 4)
```
```
$ git show exp5-m02-iteration-0:experiments/quay-perpetual-stream/OUTER-LOOP.md | grep -n "it0-\|scripts/"
51:   (a) **ceiling/floor arithmetic** — `scripts/it0-ceiling-check.sh <gap-id>...` against every
54:   (b) **gate-hash/transclusion** — `scripts/it0-gate-hash-check.sh <charter-file>` against the
57:   (c) **dogfooding evidence-gate** — `scripts/it0-dogfood-evidence-gate.sh <iteration-report.md>
67:   `experiments/quay-perpetual-stream/scripts/`).
```
Read in full: `OUTER-LOOP.md` step 4 correctly points at all three scripts by path plus the
`inherited-core.md` domain-misfit procedure section, with each bullet stating what a FAIL/non-zero
result should trigger (re-derive scope / fix charter text / send iteration back / redesign,
respectively) — matches iteration-0's own §5.5 description exactly, confirmed independently against
the actual committed text rather than cited from the prior report. **No drift.**

### 5.1 Check 1 — `it0-ceiling-check.sh` re-run against UQ-042..046
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
Identical result to iteration-0: all five CLOSED, non-zero exit ("not all OPEN"). **No drift.**

### 5.2 Check 2 — `it0-gate-hash-check.sh` re-run, both PASS and FAIL cases

**PASS case — real charter `charters/M01-dist.md`:**
```
$ ./experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh experiments/quay-perpetual-stream/charters/M01-dist.md
PASS: experiments/quay-perpetual-stream/charters/M01-dist.md HARD GATES block matches pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) modulo declared [PARAM: ...] substitutions.
$ echo "EXIT:$?"
EXIT:0
```

**FAIL case — paraphrased fixture recreated fresh this iteration** (iteration-0's `/tmp` fixture was
not preserved across sessions, per the charter's own instruction to recreate it if not preserved):
```
$ mkdir -p /tmp/gate-hash-test-it1
$ sed 's/paste the literal command output into §2 of this iteration.s report,/paste command output somewhere in the report,/' \
    experiments/quay-perpetual-stream/charters/M01-dist.md > /tmp/gate-hash-test-it1/paraphrased-charter.md
$ diff experiments/quay-perpetual-stream/charters/M01-dist.md /tmp/gate-hash-test-it1/paraphrased-charter.md
67c67
< HARD GATES — paste the literal command output into §2 of this iteration's report,
---
> HARD GATES — paste command output somewhere in the report,
$ ./experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh /tmp/gate-hash-test-it1/paraphrased-charter.md
FAIL: /tmp/gate-hash-test-it1/paraphrased-charter.md HARD GATES block diverges from pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) beyond declared [PARAM: ...] substitutions.
--- diff (pinned vs charter, declared [PARAM: ...] lines neutralized on both sides) ---
1c1
< HARD GATES — paste the literal command output into §2 of this iteration's report,
---
> HARD GATES — paste command output somewhere in the report,
$ echo "EXIT:$?"
EXIT:1
```
Both outcomes reproduced exactly, independently, from a freshly-recreated fixture. **No drift.**

### 5.3 Check 3 — dogfooding evidence-gate re-run against both M01-dist reports

**PASS case — `iteration-1.md`:**
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

**FAIL case — `iteration-0.md`, default window:**
```
$ ./experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh experiments/quay-perpetual-stream/milestones/M01-dist/iterations/iteration-0.md
OK   line 356 (nearest fenced block 35 lines away, within window 40): 1. **MET (evidence in §5.1–§5.4).** Single-file executables produced via Node SEA for
FLAG line 362 (nearest fenced block 41 lines away, EXCEEDS window 40 — no nearby pasted-output evidence): 2. **MET.** `.github/workflows/release.yml` (the same file DIR-004's prior resolution already used,
FLAG line 367 (nearest fenced block 46 lines away, EXCEEDS window 40 — no nearby pasted-output evidence): 4. **MET (Linux only; evidence in §5.4).** `quay --help` and `quay serve` both verified running
FLAG line 373 (nearest fenced block 52 lines away, EXCEEDS window 40 — no nearby pasted-output evidence): 5. **MET (evidence in §5.5).** Full existing test suite: 21/21 pass, pasted raw `node --test`
FAIL: at least one claimed-met clause in experiments/quay-perpetual-stream/milestones/M01-dist/iterations/iteration-0.md lacks a nearby fenced code block (evidence gate).
$ echo "EXIT:$?"
EXIT:1
```
Reproduces iteration-0's report byte-for-byte (same line numbers, same flagged clauses). **No drift.**

**FAIL-case investigation (charter task item 2 — is this a correct positive or a script false
positive?)**: read `experiments/quay-perpetual-stream/milestones/M01-dist/iterations/iteration-0.md`
directly around the flagged lines (§7, lines ~355-390). Confirmed: clauses 2, 4, 5 DO cite real
evidence — "§5.5" for clause 5 ("Full existing test suite: 21/21 pass... evidence in §5.5"), "§5.4"
for clause 4, and unlabeled prose for clause 2 pointing at the same `release.yml` CI section
discussed earlier in the report. This evidence is real and substantive, but structured as a
**section-pointer reference** rather than an **immediately-adjacent fenced block** — a genuinely
different report-writing convention than iteration-1.md's (which pastes command output directly
under each Done-when line). Re-running with a wider window confirms the evidence exists, just
farther away:
```
$ ./experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh experiments/quay-perpetual-stream/milestones/M01-dist/iterations/iteration-0.md 60
OK   line 356 (nearest fenced block 35 lines away, within window 60): 1. **MET (evidence in §5.1–§5.4).** Single-file executables produced via Node SEA for
OK   line 362 (nearest fenced block 41 lines away, within window 60): 2. **MET.** `.github/workflows/release.yml` (the same file DIR-004's prior resolution already used,
OK   line 367 (nearest fenced block 46 lines away, within window 60): 4. **MET (Linux only; evidence in §5.4).** `quay --help` and `quay serve` both verified running
OK   line 373 (nearest fenced block 52 lines away, within window 60): 5. **MET (evidence in §5.5).** Full existing test suite: 21/21 pass, pasted raw `node --test`
PASS: all 4 claimed-met clause(s) in experiments/quay-perpetual-stream/milestones/M01-dist/iterations/iteration-0.md have a fenced code block within 60 lines.
$ echo "EXIT:$?"
EXIT:0
```
(Re-checked precisely: exit code at window=60 is 0, consistent with the PASS message — no
discrepancy. Inspected the script source
(`experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh`) to confirm: `fail` is
set only inside the OK/FLAG loop over claimed-met clauses and is independent of any `NOT MET`
lines in the source report, which the script's claim-detection regex correctly does not match in
the first place — no exit-code/message inconsistency exists.)

**Verdict: this FAIL (at the default window=40) is a CORRECT POSITIVE** — a genuine, disclosed
structural difference between how iteration-0.md and iteration-1.md present evidence
(pointer-to-section vs. adjacent-paste), not a bug in the script's fenced-block detection or line
counting. The script is functioning exactly as designed: a coarse proximity heuristic that
correctly discriminates two real reports on their actual structure, and correctly flips to PASS
once the window is widened to include evidence that is real but farther away. This matches
iteration-0's own characterization in its report (§5.3) — re-confirmed here independently rather
than taken on faith.

### 5.4 Full existing test suite — fresh re-run, raw output

```
$ node --test packages/quay/test/*.mjs packages/quay-native/test/*.test.mjs
✔ packages/quay-native/test/cas-write.test.mjs (709.933883ms)
✔ packages/quay-native/test/compound-gate-recursive.test.mjs (277.069282ms)
✔ packages/quay-native/test/compound-gate.test.mjs (336.148683ms)
✔ packages/quay-native/test/create-validation.test.mjs (658.495899ms)
✔ packages/quay-native/test/edit-validation.test.mjs (1388.289101ms)
✔ packages/quay-native/test/gate-checked-state.test.mjs (271.328888ms)
✔ packages/quay-native/test/gate-correctness.test.mjs (236.623425ms)
✔ packages/quay-native/test/gate-gameability.test.mjs (235.505612ms)
✔ packages/quay-native/test/lock.test.mjs (662.98834ms)
✔ packages/quay/test/action-mock-delivery.test.mjs (122.996544ms)
✔ packages/quay/test/cli.test.mjs (49266.398171ms)
✔ packages/quay/test/config.test.mjs (183.38899ms)
✔ packages/quay/test/core-three-way-symmetry.test.mjs (10267.875914ms)
✔ packages/quay/test/mcp-server.test.mjs (43376.267665ms)
✔ packages/quay/test/provider-env-symmetry.test.mjs (3363.420676ms)
✔ packages/quay/test/serve-action-delivery.test.mjs (193.610165ms)
✔ packages/quay/test/serve-browser-render.test.mjs (1895.400663ms)
✔ packages/quay/test/serve-github.test.mjs (3905.700966ms)
✔ packages/quay/test/serve.test.mjs (32523.895928ms)
✔ packages/quay/test/task-check.test.mjs (4309.596879ms)
✔ packages/quay/test/web-ui-browser.test.mjs (7793.905142ms)
ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 49644.524059
```
21/21 pass, 0 fail — identical result count to iteration-0's run (§5.6 there: 21/21). No regression.
**No drift.**

### 5.5 Isolation proof (final state)

```
$ git -C experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-1 status --short
(clean — no edits needed this iteration)
$ git status --short -- experiments/
?? experiments/quay-perpetual-stream/milestones/M02-gates/
$ git status --short -- packages/
(clean)
```
The untracked entry is the new worktree directory registration itself (expected `git worktree add`
side effect, same as iteration-0's own pattern) — no content edits were made this iteration.

## 6. Done-when clause status — independently RE-VERIFIED, all six

1. **CONFIRMED STABLE.** `it0-ceiling-check.sh` re-run fresh against UQ-042..046 → all 5 CLOSED,
   identical to iteration-0 (§5.1).
2. **CONFIRMED STABLE.** `it0-gate-hash-check.sh` re-run fresh: PASS against `charters/M01-dist.md`,
   FAIL against a freshly-recreated paraphrased fixture — both outcomes reproduced independently
   (§5.2).
3. **CONFIRMED STABLE.** Dogfooding evidence-gate re-run fresh against both real M01-dist reports:
   PASS on iteration-1.md, FAIL on iteration-0.md at default window — and the FAIL was specifically
   investigated and confirmed to be a correct positive (real evidence, just farther away than the
   default proximity window), not a script bug (§5.3).
4. **CONFIRMED STABLE.** `inherited-core.md`'s domain-misfit decision procedure confirmed present
   in the COMMITTED branch (`git show`, not worktree-only) (§5.0).
5. **CONFIRMED STABLE.** `OUTER-LOOP.md` step 4 confirmed present in the COMMITTED branch, correctly
   pointing at all 3 scripts + the domain-misfit procedure by path (§5.0).
6. **CONFIRMED STABLE.** Full existing test suite re-run fresh: 21/21 pass, 0 fail, pasted raw
   output (§5.4).

**Summary: all 6 of 6 Done-when clauses independently re-verified this iteration with fresh command
output. Zero drift, zero regression, zero new bugs found. No edits were required.**

## 7. Inner termination / it0 checks — outcome

- **Ceiling arithmetic (§3.2 condition 3)**: no new ceiling fired — the mechanization already built
  in iteration-0 remains sufficient; re-verification required no new mechanism.
- **ΔV plateau (condition 2)**: this iteration made zero net-new changes (by design — its job was
  re-verification, not new work); state is stable across the iteration-0→iteration-1 boundary.
- **Budget backstop (condition 4)**: 2 of ~10 iterations used.
- **External HALT (condition 5)**: none issued.
- **Done-when complete & stable ≥1 iteration (condition 1)**: **YES — fully satisfied now.** All six
  clauses were met in iteration-0 and have now been independently re-confirmed, with fresh evidence,
  across a real iteration boundary (new worktree, new branch, re-run against the same fixtures,
  re-checked against the committed refs not the working tree). This is exactly the literal
  "stable ≥1 iteration" condition the charter's own §3.2 condition 1 requires.

**Termination condition 1 has now fired: Done-when complete AND stable ≥1 iteration. MILESTONE
DONE.**

## 8. Termination call

**All 6 Done-when clauses are CONFIRMED STABLE** — re-verified independently this iteration with
fresh command output against the original fixtures, no regression, no drift, and the one
FAIL-case investigation (Check 3 against M01-dist iteration-0.md) was specifically probed and
confirmed to be a correct positive, not a false positive masking a script bug.

**Recommendation: MILESTONE DONE. Close M02-gates.**

### Realized-value assessment for the outer ABSORB step

Per the charter's own value hypothesis (§ "Value hypothesis"), this is a methodology-infra
milestone with no VT chart-0 surface weight — realized value is not a points delta but a claim
about whether the mechanized checks are genuinely usable by a future outer-loop pass, replacing
manual judgment calls like the one that caught M-CLI-UX's staleness by hand. Assessment:

- **Check 1 (ceiling-check)** is now a single deterministic command
  (`it0-ceiling-check.sh <gap-id>...`) with a machine-checkable exit code, replacing the manual grep
  + judgment call that caught M-CLI-UX's stale UQ-042..046 citations at this milestone's own m2
  SELECT. A future outer-loop pass can run this in seconds against any newly-drafted charter's cited
  IDs, with no ambiguity about the verdict (OPEN/CLOSED/NOT-FOUND per ID, non-zero exit signaling
  "stop and re-derive"). This is a genuine mechanization, not a redescription — it was independently
  re-run this iteration against the exact fixture that motivated it and produced the identical,
  correct verdict twice.
- **Check 2 (gate-hash-check)** replaces a manual `diff` the experiment had performed by hand twice
  (M01-dist charter authoring + restart). It correctly discriminates a real byte-identical charter
  from a deliberately-paraphrased one, with the diff output pinpointing exactly which line
  diverged — a future charter-author gets a precise, actionable FAIL location instead of having to
  eyeball a full-block diff themselves. Re-verified this iteration from a freshly-recreated fixture
  (the original `/tmp` fixture did not persist across sessions, as anticipated by the task
  instructions) — the script's correctness does not depend on any stale cached state.
- **Check 3 (dogfood-evidence-gate)** is the most nuanced of the three: it is a coarse heuristic
  (proximity to a fenced code block, default 40-line window), not a semantic evidence validator. Its
  genuine value is that it catches the "zero pasted evidence anywhere nearby" failure mode
  cheaply and mechanically, and its tunable window makes explicit a real trade-off (strict
  adjacency vs. section-pointer conventions) that would otherwise remain an implicit, undiscussed
  judgment call. This iteration's FAIL-case investigation is itself a demonstration of the kind of
  judgment a future outer-loop pass would still need to apply on a FLAG/FAIL result — the script
  narrows the judgment call (from "read the whole report and decide if evidence exists" to "look at
  these N specific flagged lines and decide if the pointer target is legitimate"), it does not
  eliminate judgment entirely for this one check. This is consistent with the charter's own
  framing of Check 3 as "more than prose" but explicitly not "a full report-format validator."
- **Check 4 (domain-misfit procedure)** is documentation, not automation, by the charter's own
  explicit design (it's a judgment call that isn't independently mechanizable). Its value is
  concreteness: a future charter-author has a 4-step procedure to apply directly at it0 instead of
  answering an abstract question from scratch, and it was validated in iteration-0 to reproduce
  M01-dist's own real, independently-arrived-at answer.
- **Net assessment**: 3 of 4 checks (1, 2, 4) are now fully mechanized/concretized in a form a
  future outer-loop pass can run or apply directly, each independently re-verified this iteration
  against real fixtures with fresh output — a genuine reduction in required manual judgment/tokens
  versus this milestone's own m2 SELECT (which required an ad hoc grep + read-through). Check 3 is
  partially mechanized (catches the obvious failure mode cheaply) but still requires some judgment
  on FLAG results, which is disclosed rather than hidden. The deferred part of the value hypothesis
  — "does m3 actually exercise these gates with less judgment/tokens than m2's manual pass took" —
  remains genuinely unmeasured until m3 exists; this iteration's re-verification increases
  confidence that the checks will behave correctly when m3 exercises them (no drift found), but is
  not itself that measurement. Recommend the outer ABSORB step record this as the deferred
  ABSORB-time metric to check once m3's it0 pass actually happens.

## 9. Adaptation-log entries (methodology fit — feeds outer ρ/φ tracking)

1. **"Stable ≥1 iteration" as a literal termination sub-condition is worth taking literally, and
   doing so was cheap.** This iteration required zero new code, zero new fixtures beyond
   recreating one `/tmp` file, and produced high-confidence evidence (fresh re-runs against real
   fixtures, committed-ref checks rather than worktree checks) that the prior iteration's claimed
   completion was not a fluke or a self-consistency illusion. The cost (one more iteration, no new
   development) is low relative to the confidence gained — worth keeping as standard practice for
   any future methodology-infra milestone with a binary "artifact + stable" Done-when shape,
   rather than declaring MILESTONE DONE the moment all clauses first show MET.

2. **Verifying against the committed ref (`git show <branch>:<path>`), not just the checked-out
   worktree file, is a distinct and additive check beyond re-running scripts.** A worktree could in
   principle diverge from what was actually committed (e.g. an uncommitted local edit sitting on
   top of a stale commit) without any of the 3 scripts' own re-runs catching that — this iteration's
   explicit `git show exp5-m02-iteration-0:...` calls for both `inherited-core.md` and
   `OUTER-LOOP.md` closed that gap independently of the script re-runs. Generalizes the lesson
   named explicitly in this iteration's task brief (M01-dist iteration-1's hard-won lesson about
   verifying claimed commit hashes, not taking them on faith) to "verify committed file content,
   not just claimed commit hashes."

3. **φ-confirming data point**: the raw-output-bar / pasted-evidence convention, already confirmed
   across 3 structurally different domains in iteration-0 (§9 item 3 there), held again this
   iteration for a fourth, even narrower case — a pure re-verification iteration with no new
   development still produced fresh pasted command output for every claim rather than citing prior
   output as still valid. No methodology adaptation was needed.

## 10. Artifacts

- Worktree: `experiments/quay-perpetual-stream/milestones/M02-gates/worktrees/iteration-1/`
  (branched from `exp5-m02-iteration-0` @ `f28d012`; clean, no new commits — re-verification
  produced no edits).
- Branch: `exp5-m02-iteration-1` (currently identical to `exp5-m02-iteration-0` — HEAD `f28d012`).
- Local test fixture (not tracked, `/tmp`, recreated fresh this iteration per task instructions):
  `/tmp/gate-hash-test-it1/paraphrased-charter.md`.
- No new files under `experiments/quay-perpetual-stream/scripts/` or edits to
  `inherited-core.md`/`OUTER-LOOP.md` — all six artifacts from iteration-0 remain unmodified and
  independently re-verified as correct and committed.
