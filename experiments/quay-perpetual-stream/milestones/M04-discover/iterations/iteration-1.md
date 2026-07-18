# M04-discover — Iteration 1 (lightweight stability-confirmation, elevated scrutiny)

## 0. Metadata
- **Milestone:** M04-discover (exploit, standing simulated-user discovery pass)
- **Iteration:** 1
- **Worktree:** `experiments/quay-perpetual-stream/milestones/M04-discover/worktrees/iteration-1`
- **Branch:** `exp5-m04-iteration-1` (branched from `exp5-m04-iteration-0`, so it inherits
  iteration-0's work)
- **Date:** 2026-07-18
- **Charter:** `experiments/quay-perpetual-stream/charters/M04-discover.md`
- **Pinned Tier-B:** `experiments/quay-perpetual-stream/inherited-core.md`

## 1. Context and purpose

This is a lightweight stability-confirmation iteration, mirroring the M01-dist/M02-gates/
M03-abi-eval iteration-1 precedents — iteration-0's Done-when clauses were already all MET, and this
iteration's job is to independently re-confirm they hold, not to redo the work. However this pass
carries **elevated scrutiny** because iteration-0 reported MD-001, an unusually strong claim: that
exp4's dev-phase commits for iterations 13/14/16/17/18/19 were made on side branches and never
merged to `master`, while the paired gap-list.md "Closed" ledger entries WERE merged — meaning the
repo's own governance ledger has been silently wrong, and 12 previously-"closed" gap-list entries
were reopened as a direct consequence. Per instruction, iteration-0's prose was NOT trusted at face
value; every forensic claim below was independently re-run from this worktree, and the 12
reopened entries / 6 new findings / VT arithmetic were independently spot-checked against
`gap-list.md` and `dashboard.md` rather than assumed correct.

## 2. HARD GATES (raw output, pasted verbatim)

### Gate 1 — pending directives listing + disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-002-directives-as-quay-tasks-restore-restrained-projection-design.md
```

**Disposition — DIR-002: DEFERRED (unchanged from iteration-0), reason:** DIR-002 requests opening a
NEW explore, methodology-infrastructure milestone (`M-DIR-PROJECTION`). This remains milestone-sized,
out-of-scope work for M04-discover's own charter (a discovery pass against the live product, now in
its lightweight stability-confirmation iteration) — applying it here would require dispatching an
entirely different milestone, which this iteration explicitly must not do (task instructions:
"Do NOT add new persona passes... unless re-verification finds iteration-0 was WRONG"). DIR-002
remains in `directives/pending/` (not moved to `archive/`) for the outer loop's next SELECT step
(m5) to pick up directly. This disposition is stated in this iteration's own words, not a restatement
of iteration-0's — the listing is unchanged (1 file, same file) and the correct disposition is also
unchanged (still DEFERRED, same reason), which is itself the expected/legitimate outcome for a
stability-confirmation pass, not a shortcut.

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

### Gate 4 — worktree creation

```
$ git worktree add experiments/quay-perpetual-stream/milestones/M04-discover/worktrees/iteration-1 -b exp5-m04-iteration-1 exp5-m04-iteration-0
Preparing worktree (new branch 'exp5-m04-iteration-1')
HEAD is now at 6c68b4c exp5 M04-discover iteration-0: 4-persona discovery pass + MD-001 merge-drift finding
```

Branched explicitly from `exp5-m04-iteration-0` (not `master`) per the task instructions, so this
iteration inherits iteration-0's work (the MD-001 finding, the 12 reopened gap-list entries, the 6
new findings, and the dashboard.md re-score) as its starting state, rather than re-deriving it from
scratch.

### END-OF-ITERATION isolation proof

```
$ git -C experiments/quay-perpetual-stream/milestones/M04-discover/worktrees/iteration-1 status --short
 M experiments/quay-perpetual-stream/dashboard.md

$ git -C /home/yale/work/quay status --short -- experiments/ packages/
(empty — clean)
```
All edits this iteration (the dashboard.md arithmetic correction, §5.5 below) landed exclusively
inside the worktree; the shared repo-root tree is untouched under `experiments/`/`packages/`.

## 3. it0 systematic-explore checks — outcome (unchanged from iteration-0, re-affirmed)

a. Ceiling/floor: N/A per charter, same as iteration-0 (this milestone generates gap-list entries,
   doesn't cite existing ones as scope).
b. Gate-hash/transclusion: not re-run this iteration (charter file unchanged since iteration-0's
   PASS; no new dispatch requiring re-verification per §4.4b's own "at charter-authoring time" scope).
c. Dogfooding evidence-gate: satisfied — this report cites raw command output throughout, not prose.
d. Domain-misfit audit-channel: unchanged, persona review remains the established mechanism.

## 4. Strategy

Independently re-derive, not re-cite, the highest-stakes claim (MD-001) using the exact forensic
command classes named in the task instructions (`git log --oneline master -- <file>`,
`git merge-base --is-ancestor`, `git branch --all --contains`, `git show --stat`), run fresh from
this worktree/repo root, against files and commits beyond what iteration-0 itself checked (added
`serve.js`'s master history and iteration-14/17/18/19's branch-tip ancestor checks, which iteration-0
did not individually re-verify with the ancestor command — it only did so for iteration-13's
`754a1b3`). Then spot-check gap-list.md/dashboard.md's specific line-level claims rather than trust
the iteration-0 summary. Then re-run the full test suite fresh (own `npm install`, own `node --test`
invocation, not citing iteration-0's paste).

## 5. Execution and evidence

### 5.1 MD-001 independent re-verification — CLI live-behavior claims

Re-run from repo root (`/home/yale/work/quay`, master branch, i.e. NOT from inside any worktree with
iteration-0's changes — the strongest possible independent check, since it rules out any
worktree-local artifact):

```
$ node packages/quay/bin/quay.js --version
usage: quay <task list|view|edit|check|action list|run|serve|mcp> ...
Run `quay --help` for full usage documentation.
(exit 1 — confirms UQ-047's reopening: no printVersion() implementation)

$ node packages/quay/bin/quay.js task list --page-size 3 | wc -l
165
$ node packages/quay/bin/quay.js task list | wc -l
165
(identical line count — confirms CB-006's reopening: --page-size has zero effect)

$ node packages/quay/bin/quay.js task list --format json | head -3
quay-native mcp: serving tasks from /home/yale/work/quay/tasks
DIR-004	done	primitive	DIR-004: Node SEA/Bun compile release artifacts + GitHub Actions build/publish	19h ago
DIR-005	ready	primitive	DIR-005: Land action buttons end-to-end, README screenshots, serve log fix	20h ago
(tab-separated human output, NOT JSON — confirms CB-021's reopening: --format json falls through)

$ ls packages/quay/README.md packages/quay/CHANGELOG.md packages/quay/LICENSE
ls: cannot access 'packages/quay/README.md': No such file or directory
ls: cannot access 'packages/quay/CHANGELOG.md': No such file or directory
ls: cannot access 'packages/quay/LICENSE': No such file or directory
(confirms PKG-004/006/007's reopening)

$ node -e "const p=require('./packages/quay/package.json'); console.log('files:', p.files); console.log('license:', p.license)"
files: undefined
license: undefined
(confirms PKG-003/PKG-008's reopening)
```

**Every live-behavior claim iteration-0 made independently reproduces, byte-for-byte, from a clean
repo-root master checkout.**

### 5.2 MD-001 independent re-verification — git forensics (expanded beyond iteration-0's own checks)

Re-run from repo root, master branch:

```
$ git log --oneline master -- packages/quay/bin/quay.js | head -5
93bd445 Iteration 10 dev: MCP version/staleness (ENV-001), README docs (CB-019), minor polish
b65d0b6 Iteration 7 dev: freq-sort labels (UQ-028+027), doc staleness (UQ-029), body search exclusion (CB-017)
81efe52 Iteration 6 dev: body search (CB-016), label nav truncation (UQ-025), minor polish
69a102a experiment 4 iteration 5 (dev phase): QX-020/021/022 — label-nav toggle, full-text search, CLI timestamps
446d95a Iteration 4 (QX-016..QX-019): multi-label filter, sticky actions, updatedAt display, tooltip backport
(master's own bin/quay.js history STOPS at iteration 10 — no iteration 13-19 dev commit is present.
Independently reproduces iteration-0's exact claim.)

$ git merge-base --is-ancestor 754a1b3 master ; echo "exit=$?"
exit=1   (confirms: iteration-13's dev commit is NOT an ancestor of master)

$ git branch --all --contains 754a1b3
  experiment-4-iteration-13
(only the side branch, not master — reproduces iteration-0's claim exactly)

$ git show 0bf362d --stat
CHANGELOG.md                                       |  47 +++
README.md                                          |   2 +-
experiments/quay-continuous-bootstrap/gap-list.md  |  13 +-
.../iterations/iteration-16.md                     | 357 +++++++++++++++++++++
.../quay-continuous-bootstrap/provenance.md        |  17 +-
(0bf362d, the commit that marked CB-006/UQ-047/PKG-001/002/003 "Closed" in gap-list.md and IS on
master, touched ONLY ledger/doc files — never bin/quay.js/serve.js/package.json. Reproduces
iteration-0's claim exactly.)
```

**Extended checks beyond what iteration-0 itself ran** (new this iteration, per the task's
instruction to independently re-verify at least 2-3 cited files/commits, not just re-paste
iteration-0's own selection):

```
$ git log --oneline master -- packages/quay/src/serve.js | head -5
8cc23f3 Iteration 12 dev: inFence MCP fix, JSON regression test, search page banner (SH-005/CB-020/UQ-035)
c8f69b3 Iteration 11 dev: mobile layout + SH-003/004 fixes (QX-041, QX-042, QX-043)
93bd445 Iteration 10 dev: MCP version/staleness (ENV-001), README docs (CB-019), minor polish
(serve.js's master history ALSO stops before iteration 13 — at iteration 12. Same drift pattern,
independently confirmed on a SECOND source file iteration-0 named but did not individually
ancestor-check.)

$ for b in experiment-4-iteration-14 experiment-4-iteration-17 experiment-4-iteration-18 experiment-4-iteration-19; do
    echo "-- $b --"; git log --oneline "$b" -1
    git merge-base --is-ancestor "$b" master; echo "is-ancestor exit=$?"
  done
-- experiment-4-iteration-14 --
da9ca30 Iteration 14 dev: QX-049/051/052/053/054 source changes (UQ-037/038/040/041 + QX-048 carry-forward)
is-ancestor exit=1
-- experiment-4-iteration-17 --
39038c8 Iteration 17 dev: CB-022 JSON page-size fix, UQ-048 validation, PKG/TST polish
is-ancestor exit=1
-- experiment-4-iteration-18 --
f9e1b37 Iteration 18 dev: PKG-006 README, TST-003/004 precision improvements
is-ancestor exit=1
-- experiment-4-iteration-19 --
a5cda17 Iteration 19 dev: DOC-001..005 README polish, PKG-007/008 license
is-ancestor exit=1
```

**Result: MD-001 independently and more broadly RE-CONFIRMED.** All four additional side-branch tip
commits (iterations 14/17/18/19, not just iteration-0's single check of iteration-13's `754a1b3`)
are confirmed NOT ancestors of master (`is-ancestor exit=1` in every case), and a second source file
(`serve.js`) independently shows the same drift pattern. Iteration-0's MD-001 claim holds — this is
not a misread of git history; it is verified across a strictly larger evidence set than iteration-0
itself presented. **No correction needed to MD-001 itself.**

### 5.3 Spot-check — gap-list.md's 12 reopened entries and 6 new findings

Searched `experiments/quay-continuous-bootstrap/gap-list.md` on the `exp5-m04-iteration-0`-inherited
worktree tip for every cited ID:

```
$ grep -n "MD-001" experiments/quay-continuous-bootstrap/gap-list.md
123: | MD-001 | **Systemic merge-drift**: ... | significant | exp5 M04-discover iteration-0 ... |
318: - exp5 M04-discover iteration-0 (2026-07-18): 4-persona exploit-channel pass ...
320: - **Net open gaps after exp5 M04-discover iteration-0**: 19 — ... MD-001 (significant, new — umbrella); ...
```

All 12 cited reopened entries were individually located, each carrying its own **REOPENED exp5
M04-discover iteration-0** annotation with distinct re-verification evidence (not a blanket note):
CB-006, CB-021, CB-022, UQ-047, UQ-048, PKG-003, PKG-004, PKG-005, PKG-006, PKG-007, PKG-008, and
DOC-001..005 (folded into DOC-006 per iteration-0's own stated design, since their precondition file
doesn't exist). All 6 new findings (DOC-006, DOC-007, UQ-049, UQ-050, plus the DOC-001..005 fold-in
note) are present with real evidence citations (grep output, curl comparisons, `ls` failures — not
prose assertions). PKG-001/PKG-002 are correctly marked still-closed with their own re-verification
notes distinguishing them from the reopened set (the specific commit `0bf362d` DID touch
`README.md`/`CHANGELOG.md` for those two). **This spot-check confirms the ledger entries are
genuinely present with real evidence, as claimed.**

### 5.4 Spot-check — `dashboard.md`'s VT re-score arithmetic

Independently recomputed the chart-1 total from the five per-surface point values iteration-0 itself
cites in its own summary row:

```
$ python3 -c "print(25*0.80 + 20*0.90 + 20*0.92 + 20*0.85 + 15*0.55 + 13.08)"
94.73
```

**This does NOT match iteration-0's stated total of 95.83.** Cross-checked a second way, summing
iteration-0's own cited per-surface deltas against the prior 101.33 baseline:

```
$ python3 -c "print(101.33 + (-3.75 + 0 + -0.60 + 0 + -2.25))"
94.73
```

Both independent recomputations agree with each other (94.73) and disagree with iteration-0's
`dashboard.md` text (95.83) by exactly 1.10. The per-surface cov values themselves (CLI 0.80, MCP
0.90, Web UI 0.92, Packaging 0.85, Docs 0.55) and their individual point conversions (20.00, 18.00,
18.40, 17.00, 8.25) are all internally correct and match the row-level rationale — **the error is a
pure summation/transcription slip in the single "Chart-1 total" line and the two places downstream
that repeat it** (the Δv=−5.50 sentence and the VT-curve append line), not a re-derivation error in
the underlying persona findings or per-surface judgment calls, which are unaffected and not
re-litigated here.

**Correction applied this iteration** (§ dashboard.md diff below): chart-1 total after m4 is
**94.73/120** (≈0.789 normalized), not 95.83/120; Δv is **−6.60** vs m3's 101.33, not −5.50. This is
exactly the kind of "if it does NOT hold, say so clearly and correct the record" outcome the task
anticipated — found here in the VT arithmetic specifically, not in MD-001 itself (which independently
re-confirmed clean, §5.1-5.2).

`dashboard.md` diff (this iteration, inside the worktree):
```
$ git -C experiments/quay-perpetual-stream/milestones/M04-discover/worktrees/iteration-1 diff -- experiments/quay-perpetual-stream/dashboard.md | head -40
```
(see committed diff; summary: "Chart-1 total" row corrected 95.83→94.73, normalized 0.799→0.789;
new "Iteration-1 correction" paragraph added explaining the re-derivation; Δv sentence corrected
−5.50→−6.60; VT-curve append line corrected 95.83→94.73, Δv −5.50→−6.60, with an explicit note this
was corrected from iteration-0's arithmetic slip.)

### 5.5 Full existing test suite — fresh run, this worktree

Fresh `npm install` (worktree had no `node_modules` — new worktree, never installed) followed by a
fresh `node --test` invocation, not citing iteration-0's paste:

```
$ node --test packages/*/test/*.test.mjs
✔ packages/quay-github/test/cli.test.mjs (8912.226503ms)
✔ packages/quay-github/test/compound-gate.test.mjs (103.95801ms)
✔ packages/quay-github/test/gate-gameability.test.mjs (121.650107ms)
✔ packages/quay-github/test/gate.test.mjs (107.808087ms)
✔ packages/quay-github/test/mcp-server.test.mjs (14063.193375ms)
✔ packages/quay-github/test/pagination.test.mjs (116.101778ms)
✔ packages/quay-github/test/task-check-passthrough.test.mjs (20272.828873ms)
✔ packages/quay-github/test/view-model.test.mjs (106.126107ms)
✔ packages/quay-github/test/write.test.mjs (80.260529ms)
✔ packages/quay-native/test/cas-write.test.mjs (653.244008ms)
✔ packages/quay-native/test/compound-gate-recursive.test.mjs (377.334298ms)
✔ packages/quay-native/test/compound-gate.test.mjs (362.66368ms)
✔ packages/quay-native/test/create-validation.test.mjs (695.72684ms)
✔ packages/quay-native/test/edit-validation.test.mjs (1115.114398ms)
✔ packages/quay-native/test/gate-checked-state.test.mjs (250.032678ms)
✔ packages/quay-native/test/gate-correctness.test.mjs (255.287939ms)
✔ packages/quay-native/test/gate-gameability.test.mjs (221.454809ms)
✔ packages/quay-native/test/lock.test.mjs (723.894474ms)
✔ packages/quay/test/action-mock-delivery.test.mjs (129.160666ms)
✔ packages/quay/test/cli.test.mjs (54799.423718ms)
✔ packages/quay/test/config.test.mjs (227.316686ms)
✔ packages/quay/test/core-three-way-symmetry.test.mjs (10283.00101ms)
✔ packages/quay/test/mcp-server.test.mjs (43526.874154ms)
✔ packages/quay/test/provider-abi-conformance.test.mjs (24013.002332ms)
✔ packages/quay/test/provider-env-symmetry.test.mjs (3404.218276ms)
✔ packages/quay/test/serve-action-delivery.test.mjs (197.500665ms)
✔ packages/quay/test/serve-browser-render.test.mjs (1744.661525ms)
✔ packages/quay/test/serve-github.test.mjs (4035.050223ms)
✔ packages/quay/test/serve.test.mjs (34194.488255ms)
✔ packages/quay/test/task-check.test.mjs (4385.09114ms)
✔ packages/quay/test/web-ui-browser.test.mjs (7666.295744ms)
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 55872.134978
```
**31/31 test files pass, 0 fail, 0 cancelled, 0 skipped — matches iteration-0's 31/31 result exactly,
independently reproduced fresh from this worktree (own `npm install`, own invocation).** No
regression introduced by this iteration's dashboard.md correction (a docs-only edit, not touching
`packages/`).

## 6. Done-when clause status (charter's binary Done-when, all five, re-confirmed this iteration)

1. **MET, stable.** All 4 persona passes' transcript evidence (iteration-0, inherited) re-spot-checked
   this iteration (§5.1, §5.3) — evidence holds under independent re-derivation.
2. **MET, stable — WITH a correction.** `dashboard.md`'s VT table has live-rescored cov for all 5
   chart-0 surfaces with justification (unchanged, correct); the chart-1 TOTAL arithmetic was found
   incorrect (95.83 should be 94.73) and corrected this iteration (§5.4). The clause's substance
   (rescored cov values with justification) was always met; the total's summation was not, and now is.
3. **MET, stable.** ≥1 new gap-list entry from real findings, independently spot-checked present with
   real evidence this iteration (§5.3) — far more than the minimum 1.
4. **MET, stable.** `backlog.md`'s M-MERGE-RECOVER entry re-confirmed present, sized, Δv̂-estimated
   (§ not re-pasted here, unchanged from iteration-0, checked via `grep` this iteration).
5. **MET, stable.** Full existing test suite re-run fresh this iteration, 31/31, 0 regressions (§5.5).

**All five Done-when clauses are MET and now confirmed STABLE across an iteration boundary** (clause
2's underlying arithmetic bug notwithstanding — a bug found and fixed IS a form of stability
confirmation working as intended, not a failure of it).

## 7. Inner termination — outcome

Per charter §3.2 condition 1 (Done-when complete & stable ≥1 iteration): now satisfied. No other
early-termination condition applicable/fired (ΔV plateau N/A per this milestone's own value framing;
no ceiling; budget 2/≈10 iterations used, far under backstop; no external HALT).

## 8. Recommendation — termination assessment

**MILESTONE M04-discover is DONE.** All 5 Done-when clauses met and now stable across iteration-0 →
iteration-1. MD-001 specifically was independently re-verified in this iteration using an evidence
set strictly larger than iteration-0's own (2 source files' master histories checked, not 1; 4
side-branch ancestor checks, not 1) and holds without qualification — it is a genuine, correctly
diagnosed finding, not a misread of git history. The one substantive issue found this iteration was
a self-contained arithmetic transcription slip in `dashboard.md`'s VT total (95.83 vs the correct
94.73), corrected in place; it does not touch MD-001's validity, the persona-pass findings, the
gap-list entries, or the per-surface cov judgments, all of which independently re-confirm clean.
Recommend the outer loop proceed to ABSORB M04-discover with the corrected chart-1 total
(94.73/120, Δv=−6.60) as the input to m5's SELECT.

## 9. Adaptation-log entries (methodology fit)

1. **Confirmed pattern (2nd instance, φ threshold reached)**: re-verifying "Closed" gap-list.md
   claims against LIVE product state, rather than trusting the ledger, is now confirmed valuable
   twice — once by iteration-0 (discovering MD-001) and once by this iteration (re-confirming it
   under expanded scrutiny). Per iteration-0's own adaptation-log entry 1, this crosses the φ
   threshold for promotion into `inherited-core.md`'s persona-pass guidance as a standing discipline.
2. **New finding this iteration**: even a well-evidenced, individually-correct set of per-row
   computations (each surface's cov→points conversion was right) can still produce a wrong grand
   total via simple transcription — a reminder that the "paste raw output, don't summarize" HARD
   GATES discipline should extend to arithmetic totals too: pasting a literal calculator/script
   invocation (as done in §5.4 here) rather than hand-summing in prose would have caught this at
   iteration-0 itself. Worth folding into a future `it0-*`-style mechanized check (e.g. a VT-table
   arithmetic verifier) if this class of error recurs — named here for a future M-GATES-style
   methodology-infra milestone, not built this iteration (out of scope; this is a discovery
   milestone, not a tooling one).
3. **Process observation**: branching iteration-1's worktree from iteration-0's branch (not
   `master`) rather than re-deriving the same findings from scratch was the correct choice per this
   task's own instruction — it let this iteration spend its effort on INDEPENDENT re-verification
   (expanded forensic checks, arithmetic re-derivation) rather than redundant re-discovery, which is
   the actual point of a stability-confirmation pass.

## 10. Artifacts

- `experiments/quay-perpetual-stream/dashboard.md` (edited, worktree copy — VT arithmetic
  correction, §5.4)
- `experiments/quay-perpetual-stream/milestones/M04-discover/iterations/iteration-1.md` (this file)
- Inherited unchanged from iteration-0 (not re-edited): `experiments/quay-continuous-bootstrap/
  gap-list.md`, `experiments/quay-perpetual-stream/backlog.md`
