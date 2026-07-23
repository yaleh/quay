# M124 iteration-0 — adversarial audit

Audit session id: PLACEHOLDER-ORCHESTRATOR-FILLS-IN

**Task under audit:** `exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH`
**Charter:** `experiments/quay-perpetual-stream/charters/M124-clause8-multi-label-fix.md`
**Claims audited:** `experiments/quay-perpetual-stream/milestones/M124/iterations/iteration-0.md`
**Commit under audit:** `ab8b6c8` ("M124 SELECT+impl: fix clause8 multi-label first-match-wins defect")
**Auditor stance:** fresh-context, refute-first (inherited-core.md §"Adversarial-audit role" / Clause 1).

## Verdict

**REFUTED** — specifically, AC item 3's implicit regression-protection claim ("a new fixture pair
… added to cover this case going forward") is false: the 3 new fixture tests added to
`it0-dod-check.test.mjs` do **not** discriminate the fix from the pre-fix bug. I proved this by
mechanically reverting the source to the exact pre-fix single-`.match()` logic and re-running only
those 3 new tests — **all 3 still passed** against the buggy code. In addition, I found and
demonstrated a real, reproducible design flaw in the shipped fix (whole-file `matchAll` scan is
vulnerable to incidental `milestone:M<N>`-shaped substrings appearing in a task's own prose, not
just its real labels), which is not covered by any new test and is not disclosed as a known
limitation anywhere in the charter/task/iteration-0.

The diff shown in `iteration-0.md` **does** match the real commit byte-for-byte (verified via
`git show ab8b6c8`), and the 3 real named tasks' claimed max-label numbers **are** independently
correct. Those two things are NOT what's wrong here — the problem is the test suite's actual
discriminating power and a scope gap in the fix's own design.

## What I independently verified (confirms, not refutes)

1. **Diff fidelity.** `git show ab8b6c8 -- experiments/quay-perpetual-stream/scripts/it0-dod-check.ts`
   produces a diff textually identical (modulo the pre-fix comment block, which iteration-0.md
   elides for brevity but doesn't misrepresent) to the diff pasted in `iteration-0.md`. Confirmed by
   direct comparison.

2. **The 3 named real tasks' max-label computation.** Independently re-derived with a fresh Node
   one-liner reading the real files (not trusting the pasted numbers):
   ```
   tasks/exp5-M-GATE-CLI-ERROR-UX.md matches: [ '37', '56' ] max: 56 applies: true
   tasks/exp5-M-GATE-HELP-SYNOPSIS-GAP.md matches: [ '37', '51' ] max: 51 applies: true
   tasks/exp5-M-GATE-MCP-PARITY-GAP.md matches: [ '37', '53' ] max: 53 applies: true
   ```
   Matches iteration-0.md's claims exactly. Also confirmed via `grep -n "milestone:M"` on each file
   that these are the task's ONLY two `milestone:M<N>` occurrences (both in the YAML frontmatter
   `labels:` block), so there's no additional body-prose pollution affecting these 3 specific tasks
   (see the design-flaw finding below for why this matters in general).

3. **`dod-fixture-selfcheck.sh`.** Re-ran directly: `PASS: all 17 DoD fixtures behaved as asserted.`
   Matches the claimed 17/17 golden-diff-unchanged claim exactly.

4. **Test counts.** Re-ran both suites myself, not trusting the pasted numbers:
   - `node --test experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs` → **43 pass, 0 fail**
     (matches claim).
   - Full experiments suite (`find experiments -name "*.test.mjs"` piped to `node --test`) →
     **475 pass, 0 fail** (matches claim exactly, including the +3 delta from 472).

## What I refute

### Finding 1 (REFUTES AC item 3's "to cover this case going forward" claim) — the 3 new fixture tests are tautological; they pass under the pre-fix buggy code too

I copied the real `it0-dod-check.ts`, reverted **only** the clause8 label-scan lines back to the
exact pre-fix single-`.match()` form (removing `matchAll`/`Math.max`, restoring the literal
pre-`ab8b6c8` code), then re-ran just the 3 new tests
(`--test-name-pattern="clause8: multi-label"`) against that deliberately-buggy version:

```
✔ clause8: multi-label low-then-high order (early discovery label below cutover, real landing label above) → applies, using the MAX (201.500787ms)
✔ clause8: multi-label high-then-low order (real landing label first, an older low-numbered label after) → still applies, using the MAX (226.174999ms)
✔ clause8: multi-label, ALL below cutover → N/A grandfathered pass (max still < 40) (177.697226ms)
tests 3, pass 3, fail 0
```

All 3 "new coverage" tests pass identically whether the fix is present or reverted. Root cause: the
tests assert only `hasPass(r, "clause8-task-canonical-lifecycle-record")` and `!hasFail(r,
"clause8")`. Both the "applies" pass message
(`clause8-task-canonical-lifecycle-record: task carries a real…`) and the "N/A" pass message
(`clause8-task-canonical-lifecycle-record: N/A — …`) share the same
`clause8-task-canonical-lifecycle-record` prefix, so a substring-match assertion cannot
distinguish "clause8 genuinely applied" from "clause8 N/A'd" — which is exactly the distinction
this whole defect is about. The MULTILOW test (low-then-high: `M5-discover` then `M41-fake`) is
particularly weak: under the OLD first-match code, the first match in that specific ordering is
`M5` (< cutover) → N/A — and the test's assertions pass regardless, because both outcomes satisfy
`hasPass("clause8-task-canonical-lifecycle-record")`. I restored the real file immediately after
this experiment (`git status --short` on the file confirms clean/no diff after restore); this was a
disposable local probe, not a change to the codebase.

I re-ran the full 43-test file afterward to confirm the restore was clean: 43/43 pass again with
the real fixed code in place.

This directly contradicts the task's own AC item 3 wording — "a new fixture pair … added to cover
this case going forward" — and the charter's Scope section's verify bullet ("3 new fixture tests
added … to `it0-dod-check.test.mjs`") both imply these tests provide regression protection for
this exact defect. They do not. A future regression back to first-match-wins would ship silently
undetected by this test file.

### Finding 2 (CONCERNS, not directly an AC violation but a real correctness gap in the shipped design) — whole-file `matchAll` scan is vulnerable to incidental `milestone:M<N>`-shaped text in task prose, not just real labels

The fix's rationale (charter Scope section: "a task only ever gains higher-numbered labels over
time … never a lower one after landing, so the max is the real/final landing label") is valid
**only if every `milestone:M<N>` match found is a genuine label**. But the implementation scans the
**entire task file text** (`taskText.matchAll(...)`, where `taskText` is the full file content —
frontmatter + `## Proposal` + `## Plan` + `## Acceptance Criteria` + everything), not just the YAML
`labels:` block. The OLD single-`.match()` code was accidentally immune to this because YAML
frontmatter always sits at the top of the file, so "first match in file order" was, in practice,
always a frontmatter label. The NEW MAX-over-whole-file approach loses that accidental immunity: a
task whose own real label is genuinely low (correctly below cutover, correctly N/A) can be flipped
to incorrectly "applies" merely because its body prose quotes a higher `milestone:M<N>`-shaped
string while discussing something else entirely (e.g., citing another task's label for context, as
this very M124 defect task's own `## Proposal` section does — it quotes
`milestone:M37-discover-post-qeng` and `milestone:M51` inline while describing the OTHER 3 tasks'
labels).

I demonstrated this concretely (not hypothetically) using the exported `runDodCheck` directly, on a
synthetic task whose real label is `milestone:M35-real-label` (genuinely below the M40 cutover,
should legitimately N/A-pass) but whose `## Acceptance Criteria` section merely quotes, in prose,
an unrelated task's label `milestone:M9999-other-tasks-label` for context:

```
clause8-related passes: []
clause8-related failures: [
  "clause8-task-canonical-lifecycle-record: no '## Proposal' section found in the task (item 6a requires an embedded proposal) [fixture text — no real task file]",
  "clause8-task-canonical-lifecycle-record: no '## Plan' section found in the task (item 6b requires either N/A-with-reasoning or a resolving docs/plans/*.md reference) [fixture text — no real task file]"
]
```

The task incorrectly FAILS clause8 (forced to "applies" and then dinged for missing sections it
was legitimately exempt from) purely because of an incidental substring match in its own prose,
never a real label of its own. This exact hazard is already latent in-repo: the M124 defect task's
own body currently contains `milestone:M37-...` and `milestone:M51` as quoted prose (not real
labels of that task) — it happens not to misfire today only because that task's own real label
(`M-124` = 124) is already the numeric maximum regardless. This is fragile, not designed-around,
and untested by the 3 new fixtures (which only vary label **order**, never test a prose-embedded
decoy number). None of the charter, task AC, or iteration-0 report discloses this as a known
limitation or scopes it out explicitly — "Not in scope" in the charter only excludes changing the
cutover threshold itself, not this class of false-positive.

I consider this CONCERNS-severity rather than a second REFUTED item because it doesn't falsify any
of the 4 AC items as literally worded (AC item 1's wording — "labels present in a task's text" — is
arguably satisfied by the literal whole-text scan, even though that's not what the charter's own
underlying justification assumes), but it is a genuine unaddressed correctness gap in the shipped
fix that the orchestrator should weigh before treating this defect as fully closed.

## Other adversarial probes that did NOT find fault (reported for completeness)

- **`matchAll` with non-`/g` regex throwing:** N/A — the fix correctly uses the `/gi` flags;
  `matchAll` requires a global regex or it throws, and the code does supply one. No issue.
- **Zero-label task:** `milestoneLabelMatches.length === 0` → `taskMilestoneNum = null` →
  `clause8Applies = false` → N/A-pass with the "no label found" reason string. Correct, unchanged
  from pre-fix behavior for this case.
- **Malformed label `milestone:M` with no digits:** the regex requires `\d+`; a labelless
  `milestone:M` does not match at all (correctly ignored, same as pre-fix).
- **Duplicate labels:** no effect on `Math.max`; degenerate case, harmless.

## AC-by-AC disposition (checklist write-back applied via `task_write`)

- [x] **AC1** — Clause8's label scan considers all `milestone:M<N>` labels, not just the first.
  Confirmed by reading the real source (`matchAll`/`Math.max` present at
  `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts:621-624`). TICKED.
- [x] **AC2** — the 3 named real tasks show clause8 genuinely applying. Independently re-derived
  and matches exactly (see "What I independently verified" #2 above). TICKED.
- [ ] **AC3** — `dod-fixture-selfcheck.sh` passes (confirmed, 17/17) AND a new fixture pair added
  "to cover this case going forward" (the tests exist, but Finding 1 above proves they do NOT cover
  this case going forward — they pass under both the fixed and the pre-fix buggy code). LEFT
  UNCHECKED — the coverage half of this compound criterion is not actually met.
- [x] **AC4** — no other clause's verdict changed as a side effect. Independently re-ran the full
  475-test suite; count matches the claimed delta exactly (472→475, +3, no other change). The
  clause8 diff itself is also textually scoped entirely inside the clause8 block (no shared-helper
  edits), which is corroborating (not sole) evidence. TICKED.

Task write-back applied via `mcp__quay__task_write` on `exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH`
(3 of 4 AC boxes ticked, AC3 left unchecked with an inline note pointing to this report; both DoD
boxes left unchecked per the DoD disposition below and the orchestrator's explicit two-pass
instruction).

## DoD disposition

- [ ] **DoD item 1** ("All 4 AC items above verified true with pasted command output") — NOT met;
  AC3 is not fully confirmed (Finding 1). LEFT UNCHECKED.
- [ ] **DoD item 2** ("it0 DoD meta-enforcer passes all clauses") — left UNCHECKED per explicit
  orchestrator instruction (no real ABSORB-entry exists yet); see mechanical-gate run below for what
  I could evaluate as a stand-in.

## Mechanical gate — stand-in run (iteration-0.md as absorb-entry, per M121/M122/M123 precedent)

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH experiments/quay-perpetual-stream/charters/M124-clause8-multi-label-fix.md experiments/quay-perpetual-stream/milestones/M124/iterations/iteration-0.md
ERROR: absorb-entry-file has no "## Backlog row" section (required to run the impl-row clause against a synthetic milestone)
EXIT: 2
```

This is the EXPECTED failure mode described in the audit brief: iteration-0.md has no `## Backlog
row` section, and Clause 4 (design-only-milestone impl-row gate) throws a hard `DodCheckEnvError`
the moment it can't find one.

**Important detail worth flagging to the orchestrator:** I read `it0-dod-check.ts`'s control flow
directly (not just its output) to characterize this precisely. The script accumulates all
passes/N/A's/failures in memory and only prints them at the very end (after every clause has run);
a `DodCheckEnvError` thrown mid-run is caught by the top-level handler and immediately
`console.error`+`process.exit(2)`s **without ever printing the accumulated buffer**. Clause 4 is
positioned in the source (~line 281) BEFORE Clause 8 (~line 589) — the very clause under audit in
this milestone. This means: (a) clauses 0-3 DID execute cleanly in memory before the throw, but
their results were never surfaced/printed by this run (so I cannot cite their individual verdicts
as "evaluated cleanly" from this run's OUTPUT — only from reading the source flow); and (b) clause 8
itself — the clause this whole milestone changed — **never ran at all** in this stand-in
invocation, because the script aborts at clause 4 before reaching it. So this run provides **zero**
direct evidence about clause 8's real-repo behavior; that evidence is what I re-derived
independently (see "What I independently verified" #2), not what this gate run shows. Once the
orchestrator writes a real ABSORB-entry with a `## Backlog row` section, clause 4 will clear and
clauses 5-12 (including clause 8) will actually execute and print for the first time.

## Session hygiene

This audit ran in an isolated worktree (`.claude/worktrees/agent-a99aeb6dabad6d7b0`), did not touch
`master`, and made no code changes to the repository — the one local file mutation performed
(reverting clause8 to prove Finding 1) was restored immediately and verified clean via `git status
--short` before proceeding. The only durable artifacts from this audit are: this report file, and
the `task_write` checklist tick-writes applied directly to the task store via MCP (not part of this
worktree's git history).

## Second pass — independent re-verification of the orchestrator's same-ABSORB fixes

The orchestrator addressed both findings above in `master` commit `477ac81` and asked me to
independently re-verify before ticking AC3. I did not trust the orchestrator's message — I re-read
both diffs, re-ran the tests myself, and re-derived both fix-boundary claims myself using the same
revert-and-rerun method as my first pass.

**Test-fix verification.** `git diff ab8b6c8 master -- .../test/it0-dod-check.test.mjs` shows the 2
"applies" tests rewritten to assert `hasPass(r, "task carries a real '## Proposal'")` (the
applies-path-specific message) AND `!hasPass(r, "clause8-task-canonical-lifecycle-record: N/A")`
(absence of the N/A message) — this genuinely distinguishes the two outcomes, unlike the original
shared-substring assertion. A 4th test was added that writes a REAL temp task file to
`tasks/<id>.md` (the only way to exercise the real-frontmatter code path) with a real frontmatter
label below cutover and a decoy higher `milestone:M<N>`-shaped string in body prose, cleaning up in
a `finally` block.

**Production-fix verification.** `git diff ab8b6c8 master -- .../scripts/it0-dod-check.ts` shows the
scan now extracts the `---`-delimited frontmatter block first (`taskText.match(/^---\r?\n([\s\S]*?)
\r?\n---\r?\n?/)`) and scans only that substring for real task files, falling back to whole-text
scanning only when no real frontmatter is present (the fixture/charter path) — correctly closing
the pollution gap for real tasks while preserving every existing fixture's convention.

**Re-ran full suite with master's files temporarily overlaid** (copied in, tested, restored —
non-destructive, `git status --short` clean afterward both times):
```
$ node --test experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs   # master's files
tests 44, pass 44, fail 0
```

**Re-derived both fix-boundary claims myself** (not trusting the orchestrator's report of doing this):
- Reverted ONLY the production script to the TRUE pre-M124 original
  (`git show f2c08a7:.../it0-dod-check.ts`), kept master's fixed test file, ran the 4 clause8 tests:
  the low-then-high test **genuinely FAILS** (`AssertionError`, clause8 resolves to N/A via
  first-match on `M5`, not the applies-path message) — confirms it is no longer tautological. The
  other 3 pass (as expected — they either don't depend on the max-vs-first distinction, or the
  frontmatter-scope test happens to still N/A-pass correctly by coincidence under first-match, since
  frontmatter is first in file order).
- Reverted ONLY the production script to the initially-shipped-but-flawed fix
  (`git show ab8b6c8:.../it0-dod-check.ts`, whole-text scan), kept master's fixed test file, ran the
  new frontmatter-scope test alone: it **genuinely FAILS** (clause8 incorrectly resolves to
  "applies" because the decoy `M99` in body prose inflates the max past cutover) — confirms this
  test genuinely catches the exact pollution gap Finding 2 identified, and did not catch it before
  the production fix (`master`) was applied.
- Restored my worktree's script/test files to their pre-this-session state after each probe;
  `git status --short` clean after every restore.

**DEV-14 ledger row.** Read `inherited-core.md`'s DEV-14 row directly (via `git show
master:experiments/quay-perpetual-stream/inherited-core.md`) — it accurately states both findings
(tautological substring-sharing assertion; whole-text-scan body-prose pollution), correctly
attributes origin to m124/iteration-0's own delivery, correctly classifies `caught-by: machine`
(the dispatched audit's own revert-and-rerun, not a human manual check), and correctly marks
disposition `verified-eliminated` with the same-milestone same-ABSORB resolution. No drift found.

**Mechanical gate — full re-run with master's fixed script + the AC3-ticked task body (both
temporarily overlaid into this worktree, then restored — non-destructive)**:
```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH experiments/quay-perpetual-stream/charters/M124-clause8-multi-label-fix.md /tmp/m124-absorb-entry.md
PASS: clause0-ac-dod-present: task AC has 4 checkable clause(s) (checklist-form, 4/4 checked) ...
PASS: clause1 ... PASS: clause2 ... PASS: clause3 ... PASS: clause4 ... PASS: clause5 ...
PASS: clause6 ... PASS: clause7 ... PASS: clause8 ... PASS: clause10 ... PASS: clause11 ...
N/A: clause9
FAIL: clause12-audit-independence: FAIL — audit artifact's session id
("PLACEHOLDER-ORCHESTRATOR-FILLS-IN") is distinct from the orchestrator's own id, but is NOT found
in the supplied dispatch-record ... fail-closed per DIR-034's anti-forgery requirement
FAIL: DoD check failed — 1 clause violation(s) found (see above).
```
Also ran `node packages/quay/bin/quay.ts gate exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH` (runs the
same `extra.acceptance` command against this worktree's own local task store, after I mirrored the
AC3-ticked body into it for this check) → `FAIL — acceptance failed (exit 1)`, same clause12 cause.

**This is the EXPECTED and CORRECT state, not a new problem.** Clause0 now genuinely PASSes with all
4 AC boxes checked (confirms AC3's tick is warranted and clause0 reads it correctly). The sole
remaining failure, clause12, is caused entirely by the literal placeholder string
`PLACEHOLDER-ORCHESTRATOR-FILLS-IN` still sitting at the top of this very report — DIR-034's
anti-forgery design deliberately fail-closes on that placeholder until the orchestrator substitutes
the real dispatch id (explicitly not my job — the task brief says so verbatim). Per the two-pass
audit precedent, DoD item 2 ("it0 DoD meta-enforcer passes all clauses") is therefore correctly LEFT
UNCHECKED at this point; it can only be truthfully ticked after the orchestrator fills in the real
session id and the gate is re-run (by me or a resumed instance) to confirm a genuine full PASS.

### AC3 disposition — TICKED

- [x] **AC3** (revised) — `dod-fixture-selfcheck.sh` still passes (17/17, re-confirmed) AND the new
  fixture tests genuinely cover the case going forward (independently re-verified via the
  fail-then-pass boundary tests above, on BOTH sub-findings). TICKED via `task_write`.

### Verdict — stands as REFUTED (historical record), findings now RESOLVED

Per the orchestrator's own framing (mirroring the M121 CONCERNS precedent): the verdict token on
this audit's historical record remains **REFUTED** — that is what iteration-0's original delivery
actually was when I first read it, and both findings were real, not overclaimed. The fixes landed
same-ABSORB, independently re-verified by me (not just re-asserted), and are now genuinely correct.
I am not changing the verdict token retroactively; I am recording here that both REFUTED findings
are now **RESOLVED** as of the second pass, with 3 of 4 AC boxes ticked and the 4th (AC3) now also
ticked. DoD item 2 remains the sole open item, blocked only on the orchestrator's placeholder
substitution — not on any remaining code or test defect.

## Third pass — final confirmation (real session id synced, both DoD boxes ticked)

The orchestrator synced this report's real dispatch session id (`a99aeb6dabad6d7b0`, replacing the
placeholder) into the **shared checkout**'s copy of this file (`/home/yale/work/quay`, a separate
git tree from this isolated worktree — this worktree's own copy correctly still shows the
placeholder, since a worktree-isolated agent's git operations must stay in its own tree; that is
expected, not drift). I did not trust the orchestrator's pasted output — I ran both commands myself,
from the shared checkout, and cross-checked the underlying gate-event log directly:

```
$ cd /home/yale/work/quay
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH experiments/quay-perpetual-stream/charters/M124-clause8-multi-label-fix.md /tmp/m124-absorb-entry.md
PASS: clause0-ac-dod-present: task AC has 4 checkable clause(s) (checklist-form, 4/4 checked) ...
PASS: clause1 ... PASS: clause2 ... PASS: clause3 ... PASS: clause4 ... PASS: clause5 ...
PASS: clause6 ... PASS: clause7 ... PASS: clause8 ... PASS: clause10 ... PASS: clause11 ...
PASS: clause12-audit-independence: PASS — session id ("a99aeb6dabad6d7b0") is distinct from the
  orchestrator's own id AND is corroborated by the independent dispatch-record — genuinely
  independent (DIR-034 anti-forgery check satisfied)
N/A: clause9
PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared
  self-exemption.
$ echo $?
0

$ node packages/quay/bin/quay.ts gate exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH
PASS
$ echo $?
0
```

Cross-checked `.quay/gate-events.jsonl` directly (not trusting the orchestrator's pasted GateEvent
either): the claimed entry (`item_id: exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH`, `verdict: "pass"`,
`timestamp: "2026-07-23T11:15:03.229Z"`) is genuinely present, and my own `quay gate` invocation just
now appended a SECOND independent pass-verdict GateEvent at `2026-07-23T11:15:35.225Z` — real,
machine-recorded evidence, not narrative.

**Ticked DoD-2** ("it0 DoD meta-enforcer passes all clauses") via `task_write`, citing this
confirmation. DoD-1 was already implied true once all 4 AC boxes were ticked in the second pass, and
is now ticked explicitly too. Both DoD boxes are now `- [x]`. Task `status` field left untouched
(`todo`) as instructed — only the checklist boxes and DoD were written.

**Final state:** all 4 AC boxes ticked, both DoD boxes ticked, mechanical gate genuinely PASSes
end-to-end from the shared checkout, `quay gate` genuinely PASSes with a real GateEvent recorded.
Both REFUTED findings from the first pass are confirmed RESOLVED, independently, twice over (once
against the fix diff/tests directly, once against the live end-to-end gate run). The verdict token
for this audit's historical record remains **REFUTED** (accurately describing what was found), with
this third pass recording that resolution is now complete and independently confirmed.
