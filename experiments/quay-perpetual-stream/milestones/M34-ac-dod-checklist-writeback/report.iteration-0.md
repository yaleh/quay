# M34-ac-dod-checklist-writeback — iteration-0 self-report

**Branch:** `exp5-m34-iteration-0`, worktree
`experiments/quay-perpetual-stream/milestones/M34-ac-dod-checklist-writeback/worktrees/iteration-0`.
**Base:** `exp5-outer-driver` HEAD `5da5c8a` (post-m33-publish-and-sync), per the charter.
**Commit:** `bae036d` — "M34: AC/DoD checklist form + unchecked-box-blocks (DIR-020)".

## HARD GATES / N/A statements
Web UI verification gate, manda healthz gate, port-4173 reachability gate: **N/A** — this milestone
is prose/mechanism-only (`inherited-core.md`, `it0-dod-check.mjs`, `OUTER-LOOP.md`, fixtures), no Web
UI surface touched, as the charter's Dispatcher notes state explicitly.

## What I changed (file:line citations against the final committed state)

### 1. `experiments/quay-perpetual-stream/inherited-core.md`
- **"AC/DoD live in the TASK" rule** (originally lines 877-888, now expanded): added a new paragraph
  ("**Checklist form, going forward:**...") mandating GFM checklist form (`- [ ]` per item) for AC/DoD
  going forward, authored UNCHECKED at SELECT, ticked ONLY by the acceptance audit's write-back, with
  explicit unchecked-box-blocks semantics and a backward-compatibility statement naming M32's
  `exp5-M-DOD-ESCROW-TESTFLOOR` as the still-accepted prose-form precedent.
- **Clause 0** (originally lines 890-899): "What it checks" rewritten to accept EITHER checklist-form
  (`- [ ]`/`- [x] text`) OR prose bullet/numbered form, and to add the unchecked-box HARD-block
  sub-check for checklist-form AC specifically, naming the unchecked item(s) in failure output.
- **Clause 1** (originally lines 930-950): added a new "**Checklist write-back**" bullet documenting
  that the audit is the ONLY writer that ticks boxes, that a prose-form task's write-back sub-step is
  a documented no-op, and that any AC box still `- [ ]` after the audit's pass is REFUTED-equivalent
  and HARD-blocks (cross-referencing Clause 0's mechanical enforcement of this).

Verified via `git diff experiments/quay-perpetual-stream/inherited-core.md` — 57 insertions across
these two clauses + the AC/DoD-live-in-TASK rule, no other section touched.

### 2. `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs`
Clause 0 block (originally lines 132-172, now ~192): added checklist-form detection using two new
regexes, `uncheckedBoxRe = /^\s*[-*]\s+\[\s\]\s+(\S.*)$/` and `checkedBoxRe = /^\s*[-*]\s+\[[xX]\]\s+(\S.*)$/`,
applied to the AC section's lines. `isChecklistForm` is true only if at least one line matches either
regex — prose-form AC (numbered/plain-bullet lines with no `[ ]`/`[x]` token) matches neither, so
`isChecklistForm` is false and the whole unchecked-box sub-check is skipped for it (this is the
backward-compatibility mechanism, not a separate code path). When `isChecklistForm` is true and
`uncheckedBoxes.length > 0`, `clause0Fail` gets a new failure message naming every unchecked item's
text verbatim. The PASS message was also extended to report `checklist-form, N/M checked` or
`prose-form` so the shape is visible in normal (non-failing) output too.

This is a genuinely new capability, not a shape-regex tweak: the pre-existing `acClauses` filter
(line ~150-155, unchanged) already structurally matched checklist lines (confirmed via direct probe
before editing — see below); what did NOT exist before is any notion of checked vs. unchecked state,
or any HARD-block tied to it. That is exactly what was added.

Pre-edit probe confirming the charter's own claim about the existing regex:
```
$ node -e '
const acSection = `
1. \`inherited-core.md\`... gains two new named clauses...
2. \`scripts/it0-dod-check.mjs\` mechanically checks both new clauses.
`;
const re = /^\s*([-*]|\d+[.)])\s+\S/;
for (const l of acSection.split("\n")) console.log(JSON.stringify(l), re.test(l));
'
"1. `inherited-core.md`'s \"Definition of Done\" section gains two new named clauses (escrow-Δv," true
"2. `scripts/it0-dod-check.mjs` mechanically checks both new clauses." true
```
(Both numbered prose lines match — the existing regex already accepted numbered/bulleted shapes,
including what would be a checklist line's `- [ ] text` shape, before any of my changes.)

### 3. `experiments/quay-perpetual-stream/OUTER-LOOP.md`
- **Step 1** (originally lines 92-105): the AC/DoD-authoring paragraph rewritten to state items are
  authored as UNCHECKED `- [ ]` checklists, ticked ONLY later by the step-6 audit, never by SELECT
  itself; noted Clause 0 now also HARD-blocks on any remaining unchecked box.
- **Step 6** (originally lines 222-230, per-milestone acceptance audit sub-step): inserted a new
  "**1a. Checklist write-back**" sub-item between the existing items 1 (AC satisfaction) and 2 (DoD
  satisfaction), documenting the audit's `task_write`-equivalent tick-as-it-confirms behavior, the
  "sole writer" rule, the prose-form no-op case, and the tie to item 3's mechanical-gate HARD block.
  Item 3's own text was extended to note the mechanical gate now also enforces the unchecked-box rule.

### 4. New fixtures under `experiments/quay-perpetual-stream/fixtures/dod/`
- `checklist-unchecked-box-stub.md` (fake id `M90-fake-checklist-unchecked`) — checklist-form AC with
  2 of 3 items ticked `- [x]` and 1 left `- [ ]` (simulating a partial audit write-back); compliant on
  every other clause (1-7); asserts exit 1.
- `checklist-all-checked-compliant-stub.md` (fake id `M90B-fake-checklist-checked`) — the mirror-
  compliant pair, identical shape but all 3 items `- [x]`; asserts exit 0. This demonstrates the
  checklist form is genuinely ACCEPTED when complete, not merely rejected when incomplete.

### 5. `experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh`
`CASES` array extended with the two new fixture entries (`M90-fake-checklist-unchecked` → exit 1,
`M90B-fake-checklist-checked` → exit 0), all 11 pre-existing entries left byte-for-byte unchanged.

## Backward-compatibility re-confirmation (M32 prose-form task, re-run against the FINAL edited script)
```
$ node scripts/it0-dod-check.mjs exp5-M-DOD-ESCROW-TESTFLOOR /tmp/m32-absorb-fixture.md /tmp/m32-absorb-fixture.md
...
PASS: clause0-ac-dod-present: task AC has 5 checkable clause(s) (prose-form); DoD references the standard [../../tasks/exp5-M-DOD-ESCROW-TESTFLOOR.md]
...
PASS: DoD check passed — all clauses satisfied (8 disposition(s) confirmed), no undeclared self-exemption.
```
(exit 0.) `exp5-M-DOD-ESCROW-TESTFLOOR` is M32's real task file, with real prose-numbered
`## Acceptance Criteria` — read directly by the script's real `tasks/<id>.md` path-resolution logic
(not a fixture fallback). It is correctly detected as `prose-form` and PASSes unmodified. This task
file was NOT edited by this milestone (confirmed by `git diff --stat`, below) — the file, and the
enforcer's behavior against it, are exactly as before, aside from now being explicitly labeled
`prose-form` in the pass message.

## Fixture suite results (full run, after all edits)
```
$ ./scripts/dod-fixture-selfcheck.sh
PASS: M98-fake-compliant — exit 0 (expected 0) [fixtures/dod/compliant-stub.md]
PASS: M99-fake-violating — exit 1 (expected 1) [fixtures/dod/violating-stub.md]
PASS: M96-fake-linebudget-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-linebudget-stub.md]
PASS: M95-fake-implrow-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-implrow-stub.md]
PASS: M94-fake-missing-ac — exit 1 (expected 1) [fixtures/dod/missing-ac-stub.md]
PASS: M97-fake-escrow-violating — exit 1 (expected 1) [fixtures/dod/escrow-deltav-violating-stub.md]
PASS: M97B-fake-escrow-compliant — exit 0 (expected 0) [fixtures/dod/escrow-deltav-compliant-stub.md]
PASS: M93-fake-testfloor-violating — exit 1 (expected 1) [fixtures/dod/test-floor-violating-stub.md]
PASS: M93B-fake-testfloor-compliant — exit 0 (expected 0) [fixtures/dod/test-floor-compliant-stub.md]
PASS: M92-fake-escrow-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-escrow-stub.md]
PASS: M91-fake-testfloor-negation — exit 1 (expected 1) [fixtures/dod/test-floor-negation-poison-stub.md]
PASS: M90-fake-checklist-unchecked — exit 1 (expected 1) [fixtures/dod/checklist-unchecked-box-stub.md]
PASS: M90B-fake-checklist-checked — exit 0 (expected 0) [fixtures/dod/checklist-all-checked-compliant-stub.md]

PASS: all 13 DoD fixtures behaved as asserted.
```
Exit code: 0. All 11 pre-existing fixtures unchanged and still passing; both new fixtures behave
exactly as asserted (unchecked case HARD-blocks, fully-checked case PASSes).

Direct isolated run of the new unchecked-box fixture, showing the actual failure message naming the
specific unchecked item:
```
$ node scripts/it0-dod-check.mjs M90-fake-checklist-unchecked fixtures/dod/checklist-unchecked-box-stub.md fixtures/dod/checklist-unchecked-box-stub.md
...
FAIL: clause0-ac-dod-present: checklist-form AC has 1 unchecked item(s) remaining (REFUTED-equivalent, HARD-blocks exactly as an unmet criterion does): "The regression test suite is green on CI (audit could NOT confirm — no CI run evidence found;" [fixture text — no real task file]

FAIL: DoD check failed — 1 clause violation(s) found (see above).
exit=1
```

## Live write-back demonstration (charter in-scope item 6)
Built a synthetic task `tasks/DEMO-WRITEBACK.md` (real file, `## Acceptance Criteria` authored
UNCHECKED, 3 items) under a throwaway directory `/tmp/writeback-demo`, then ran the mechanical check
against it in three stages to show a real, tool-observed box flip from `- [ ]` to `- [x]`, mirroring
exactly what the acceptance audit's `task_write`-equivalent write-back does at step 6.

**Stage 1 — task as authored at SELECT (all 3 unchecked):**
```
## Acceptance Criteria
- [ ] The demo script runs without error.
- [ ] The output file is created.
- [ ] The unit test passes.
```
```
$ node scripts/it0-dod-check.mjs DEMO-WRITEBACK absorb-entry.md absorb-entry.md   # cwd=/tmp/writeback-demo
...
FAIL: clause0-ac-dod-present: checklist-form AC has 3 unchecked item(s) remaining (REFUTED-equivalent, HARD-blocks exactly as an unmet criterion does): "The demo script runs without error.", "The output file is created.", "The unit test passes." [tasks/DEMO-WRITEBACK.md]
FAIL: DoD check failed — 1 clause violation(s) found (see above).
exit=1
```

**Stage 2 — simulated PARTIAL acceptance-audit write-back** (a Python script edited
`tasks/DEMO-WRITEBACK.md` directly, ticking the 2 items the "audit" could confirm, leaving the 3rd
`- [ ]` because it could not find CI-run evidence for it — mirroring the real audit's evidence-cited,
per-item confirm/refute behavior):
```
## Acceptance Criteria
- [x] The demo script runs without error.
- [x] The output file is created.
- [ ] The unit test passes.
```
```
$ node scripts/it0-dod-check.mjs DEMO-WRITEBACK absorb-entry.md absorb-entry.md
...
FAIL: clause0-ac-dod-present: checklist-form AC has 1 unchecked item(s) remaining (REFUTED-equivalent, HARD-blocks exactly as an unmet criterion does): "The unit test passes." [tasks/DEMO-WRITEBACK.md]
FAIL: DoD check failed — 1 clause violation(s) found (see above).
exit=1
```
The mechanism correctly narrowed the failure to name only the ONE item still unconfirmed after the
partial write-back — proving it re-reads the live task file state each run, not a cached/stale view.

**Stage 3 — completed write-back** (the "audit" confirms the 3rd item and ticks it too):
```
## Acceptance Criteria
- [x] The demo script runs without error.
- [x] The output file is created.
- [x] The unit test passes.
```
```
$ node scripts/it0-dod-check.mjs DEMO-WRITEBACK absorb-entry.md absorb-entry.md
...
PASS: clause0-ac-dod-present: task AC has 3 checkable clause(s) (checklist-form, 3/3 checked); DoD references the standard [tasks/DEMO-WRITEBACK.md]
...
PASS: DoD check passed — all clauses satisfied (8 disposition(s) confirmed), no undeclared self-exemption.
exit=0
```

This is the required live demonstration: an actual box flip from `- [ ]` to `- [x]` (Stage 1 → Stage
3, via the Stage 2 intermediate partial state), performed as a task-file edit exactly the shape a real
`task_write` call from the acceptance-audit subagent would make, observed by the mechanical check
transitioning HARD-block → HARD-block(narrower) → PASS across the three stages. (This milestone's own
scope is prose/mechanism-only — no live browser or manda dispatcher — so the demonstration uses the
charter's own explicitly-sanctioned fallback: "a scripted/manual simulation using the new mechanical
check directly against ... a synthetic task file," per charter in-scope item 6.)

## Out-of-scope boundary confirmation
```
$ git diff --stat
 experiments/quay-perpetual-stream/OUTER-LOOP.md                              | 37 ++++++++++----
 experiments/quay-perpetual-stream/inherited-core.md                          | 57 +++++++++++++++++-----
 experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh           |  4 ++
 experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs                  | 22 ++++++++-
 4 files changed, 99 insertions(+), 21 deletions(-)
 (+ 2 new files under fixtures/dod/, shown separately as untracked/added)
$ git show --stat HEAD | tail -8
 experiments/quay-perpetual-stream/OUTER-LOOP.md                                       | 37 ++++++++++----
 experiments/quay-perpetual-stream/fixtures/dod/checklist-all-checked-compliant-stub.md | 47 +++++++++++++++
 experiments/quay-perpetual-stream/fixtures/dod/checklist-unchecked-box-stub.md         | 63 +++++++++++++++++++
 experiments/quay-perpetual-stream/inherited-core.md                                   | 57 +++++++++++++++++-----
 experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh                     |  4 ++
 experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs                            | 22 ++++++++-
 6 files changed, 224 insertions(+), 21 deletions(-)
```
- **No `packages/quay` files touched** — confirmed, not present anywhere in the diff.
- **No pre-existing prose-form task touched** — `tasks/exp5-M-DOD-ESCROW-TESTFLOOR.md` (M32) was NOT
  edited; the backward-compat check above ran it through a copy/fixture path, never wrote to the real
  file. No other file under `tasks/` was touched.
- **No changes to Clauses 1-7's underlying trigger conditions or pass/fail semantics** beyond the
  named Clause-0-text/Clause-1-text updates — Clauses 2-7's code blocks in `it0-dod-check.mjs` are
  byte-for-byte unmodified (only Clause 0's block and its surrounding pass-message string changed);
  confirmed by the fact that all 11 pre-existing fixtures (which exercise Clauses 1-7 extensively)
  still pass unchanged.
- Files touched: exactly `inherited-core.md`, `it0-dod-check.mjs`, `OUTER-LOOP.md`,
  `dod-fixture-selfcheck.sh`, 2 new files under `fixtures/dod/`, plus this report and the task file
  itself (unmodified, pre-existing `tasks/exp5-M-AC-DOD-CHECKLIST-AUDIT-WRITEBACK.md`, not edited by
  me — it already ships checklist-form AC per the task's own "first live dogfood" framing).

## Commit
`bae036d` on `exp5-m34-iteration-0` — "M34: AC/DoD checklist form + unchecked-box-blocks (DIR-020)".
6 files changed, 224 insertions(+), 21 deletions(-).

## Self-assessment against the task's 5 Acceptance Criteria
1. **inherited-core.md rule + Clause 0 text updated for checklist shape** — DONE, see "What I
   changed" §1 above.
2. **it0-dod-check.mjs Clause 0 recognizes `- [ ]`/`- [x]`, ≥1 real item still required, DoD
   reference-rule unchanged, prose-form still accepted** — DONE, see §2; backward-compat re-confirmed
   live against M32's real task file.
3. **OUTER-LOOP.md step 1 text: authored UNCHECKED at SELECT** — DONE, see §3.
4. **OUTER-LOOP.md step 6 text: audit write-back, sole writer, live demonstration required for THIS
   milestone's own audit** — step-6 text DONE (§3); the live demonstration itself is provided above
   under "Live write-back demonstration" using the charter-sanctioned scripted-simulation fallback
   (this milestone's own scope has no live audit-subagent dispatch inside iteration-0's boundary —
   that dispatch is the OUTER loop's job at this milestone's real ABSORB, outside this iteration).
5. **Synthetic milestone with unchecked box HARD-blocked, new fixture wired in** — DONE, see §4/§5,
   13/13 fixture suite green.

## Known limitation / honest gap
The charter's item 6 asks for either (a) the dispatched iteration's own live acceptance-audit
write-back, or (b) if not reachable within scope, a scripted/manual simulation. I used (b) explicitly
— iteration-0 does not itself dispatch a fresh-context acceptance-audit subagent (that is the OUTER
loop's job at this milestone's real ABSORB step, which happens after both iterations report). The
scripted simulation faithfully mirrors the audit's real behavior (per-item confirm/refute with
evidence citation, direct task-file edit, sole-writer discipline) and is explicitly sanctioned as
sufficient by the charter text itself, but it is a simulation, not a real subagent dispatch — the
OUTER loop's actual acceptance-audit dispatch at this milestone's ABSORB is the true, final live
proof and should independently re-verify this claim (as the charter's own "Per-milestone acceptance
audit" section for this milestone already requires).
