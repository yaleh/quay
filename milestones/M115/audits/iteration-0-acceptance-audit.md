# M115 Adversarial Acceptance Audit — iteration-0

**Audit session id:** a60bbf314719a587e
**Orchestrator session id:** 4d2e9f2d-31ea-4180-a6b8-e4e7f29236bc

**Note (orchestrator-authored, added per step 3.5 — this line is itself the fix under audit):** the
line above was written by the ORCHESTRATOR, not the subagent, using the `Agent`-tool's own dispatch
id (`a60bbf314719a587e`), recorded in `/tmp/m115-dispatch-record.txt` BEFORE this subagent produced
any output. The subagent below was explicitly instructed not to self-report any session id — see its
own AC3 section for why, and for its independent dry-run confirming this mechanism works.

**Auditor:** independent fresh-context subagent, dispatched as an adversarial acceptance auditor; no
prior conversation context, no relationship to the session that authored M115's work. Explicitly
instructed NOT to self-report a session id (per the M115 fix under audit — see AC3 below).

**Milestone:** M115 — `exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM` (audit-independence dispatch
mechanism fix)

**Date:** 2026-07-22

Stance taken throughout: refute-first. Every claim was checked against the actual file text (quoted
verbatim below) and against live repo state (`git diff`, mechanical gate re-runs), not read off the
task/charter's own prose.

---

## AC1 — `inherited-core.md`'s "Adversarial-audit role" section instructs the ORCHESTRATOR (not the
## subagent) to record the session id

**Attempt to refute:** claim the new item is missing, ambiguous, still tells the subagent to
self-report, or doesn't explain why the env-var approach is unreliable.

**Evidence.** The "Adversarial-audit role" section (`experiments/quay-perpetual-stream/
inherited-core.md`, numbered items 1-5 under "The new role") now reads, item 5 (quoted verbatim):

> **5. Session-id injection is the ORCHESTRATOR's job, never the subagent's self-report (DIR-034
> corroboration, M115 fix — exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM).** Do NOT ask the
> dispatched subagent to determine or write its own "distinct session id" (e.g. by reading
> `CLAUDE_CODE_SESSION_ID` or any other env var from inside its own process) — in the harness this
> project runs on, a subagent dispatched via the `Agent` tool inherits the PARENT session's env, so
> that value reads back identical to the orchestrator's own id, not a fresh one (confirmed at
> M114/M115: the audit-independence gate correctly FAILed on this). The only value that IS a
> reliable, harness-assigned, non-forgeable-by-the-subagent distinct identifier is the dispatch
> handle the orchestrator itself receives back at dispatch time (the `Agent` tool's own returned
> `agentId` / task id). Procedure: (a) dispatch as above; (b) the orchestrator records the returned
> dispatch id in the dispatch-record file (`OUTER-LOOP.md`'s existing "Dispatch-record file"
> procedure, unchanged); (c) the orchestrator ALSO writes (or, if the artifact is edited after the
> fact, corrects) a literal `Audit session id: <that same dispatch id>` line near the top of the
> audit artifact itself — this is a fact the ORCHESTRATOR asserts about how the audit was dispatched,
> not something the subagent verifies about itself. `audit-independence-check.ts` parses this exact
> line out of the artifact and corroborates it against the dispatch-record file; both must carry the
> SAME orchestrator-observed id for Clause 12 to PASS.

This is unambiguous on every point I tried to refute:
- **Who acts:** "the ORCHESTRATOR's job, never the subagent's self-report" — explicit, in the
  section header sentence itself, not buried.
- **Explicitly forbids subagent self-report:** "Do NOT ask the dispatched subagent to determine or
  write its own 'distinct session id'... by reading `CLAUDE_CODE_SESSION_ID` or any other env var" —
  covers not just that one env var but "any other env var," closing the loophole of a future subagent
  trying a different introspection method.
- **Explains WHY:** "a subagent dispatched via the `Agent` tool inherits the PARENT session's env, so
  that value reads back identical to the orchestrator's own id" — the exact root cause named in the
  task body, cited with the concrete M114/M115 precedent.
- **Names the mechanism to use instead:** the `Agent`-tool's own returned `agentId`/task id, with a
  3-step procedure (dispatch → record in dispatch-record file → write/correct the artifact's `Audit
  session id:` line) that matches DIR-034's corroboration requirement exactly (checked against
  `audit-independence-check.ts`'s actual `ID_LINE_RE` regex and `isCorroborated` logic — the line
  format `Audit session id: <id>` and the "both must carry the SAME... id" requirement line up with
  what the code actually parses and compares).

**Also checked:** item 2 of the same section (the DIR-032 vehicle reference the task/charter flagged
as stale) now reads "A fresh-context **generic `Explore`/`general-purpose` subagent**... DIR-032: the
previously-named `baime:iteration-executor` vehicle was never what any working independent audit in
this project's history actually used..." — `git diff` confirms this replaced a prior version that
literally said "A fresh-context `baime:iteration-executor` call (or equivalent fresh-context subagent
dispatch)". Fixed, not merely re-worded elsewhere.

**Verdict: NOT REFUTED.**

---

## AC2 — `OUTER-LOOP.md`'s "Dispatch-record file" procedure updated to match, and the unrelated
## build-dispatch `baime:iteration-executor` references left untouched

**Attempt to refute:** claim the procedure wasn't actually updated, or that the update collaterally
broke the SEPARATE build-dispatch mechanism that legitimately still uses
`baime:iteration-executor`.

**Evidence — the new step exists.** `experiments/quay-perpetual-stream/OUTER-LOOP.md`, "Dispatch-record
file — concrete operator procedure," now reads (quoted verbatim, step 1 and the new step 3.5):

> 1. **Dispatch the audit subagent** (a fresh-context generic `Explore`/`general-purpose` subagent
> per DIR-032, `run_in_background=true`, refutation-focused prompt per `inherited-core.md`'s
> "Adversarial-audit role" section). **Do NOT ask the subagent to self-report its own session id**
> (see that section's item 5, M115 fix, exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM) — in this
> harness a dispatched subagent's own env introspection reads back identical to the orchestrator's,
> not a fresh value.
> 2. **Record the session ID you receive back** from the dispatch (the `Agent` tool's own returned
> `agentId` / task id — the harness-assigned dispatch handle, NOT anything the subagent reports about
> itself).
> 3. **Immediately create the dispatch-record file**...
> **3.5. Write (or, once the subagent's artifact exists, correct) a literal `Audit session id: <the
> SAME id from step 2>` line near the top of the audit artifact itself**
> (`milestones/M<NN>/audits/iteration-N-acceptance-audit.md`) — this is the ORCHESTRATOR asserting a
> fact about how the audit was dispatched, not the subagent verifying itself; `audit-independence-
> check.ts` parses exactly this line out of the artifact and corroborates it against the dispatch-
> record file from step 3.
> 4. **Include `## Audit-independence check` in the ABSORB entry**...

This is distinct from both the dispatch-record file (step 3) and the ABSORB-entry's `##
Audit-independence check` section (step 4) — step 3.5 is a THIRD, separate write target (the audit
artifact itself), exactly what the task's AC1/charter AC2 demanded. `git diff` confirms step 1 was
previously "a fresh-context `baime:iteration-executor` call, `run_in_background=true`, refutation-
focused prompt..." with no self-report warning and no step 3.5 at all — this is a real edit, not
pre-existing text re-read.

**(b) Vehicle-reference correction.** `git diff` on `OUTER-LOOP.md`'s dispatch-record procedure shows
step 1 changed from `baime:iteration-executor` to the generic `Explore`/`general-purpose` subagent —
matching `inherited-core.md`'s item 2 fix. Cross-checked against the OTHER, main-body step-6
reference (line ~293, "Per-milestone acceptance audit... a fresh-context **generic `Explore`/
`general-purpose` subagent**") — that one was NOT touched by this diff (confirmed via `git diff`,
no hunk near that line), consistent with the charter's claim that "`OUTER-LOOP.md` step 6 already
correctly says [this]" — the drift being fixed was specifically in the dispatch-record sub-procedure
(step 415ish), which had its own, separate stale copy of the same instruction. No contradiction
between the charter's claim and the actual diff.

**(c) — the important check — did this touch the UNRELATED build-dispatch mechanism?**
```
$ grep -n "baime:iteration-executor" experiments/quay-perpetual-stream/OUTER-LOOP.md
224:     THEN the implementation iteration (`baime:iteration-executor`) implements **against that checked
236:   Per iteration use `baime:iteration-executor` fed the charter (Tier-A) only (development-class:
```
Both remaining occurrences are in the "5a/5b class routing" section (development-class vs.
methodology/design-class dispatch policy, lines ~215-237) — this is the milestone's OWN
build/implementation iteration dispatch (`quay-task-to-plan` pipeline → `baime:iteration-executor`
implements the checked plan), a completely different mechanism from the ABSORB-time adversarial-audit
dispatch. `git diff experiments/quay-perpetual-stream/OUTER-LOOP.md` shows NO hunk touching lines
215-240 at all — these two references are untouched, exactly as they should be. I also checked
`inherited-core.md` for stray `baime:iteration-executor` references: two remain (lines 541, 1251),
both historical narrative describing PAST events ("dispatched as a fresh
`baime:iteration-executor`", "M32 ran two independent `baime:iteration-executor` iterations") and one
dashboard-log table row (DEV-06) — none of these are live procedure instructions, so they are
correctly left alone; changing historical narrative text would itself be a drift/rewrite-history
problem, not a fix.

**Verdict: NOT REFUTED.** The dispatch-record procedure was genuinely updated with the missing step,
the vehicle-reference drift was genuinely fixed, and the unrelated build-dispatch mechanism's own
`baime:iteration-executor` references were correctly left untouched.

---

## AC3 — live validation: did THIS dispatch actually follow the corrected procedure?

**Attempt to refute:** claim the corrected procedure wasn't actually followed for real — that this
dispatch is dressed up to look compliant after the fact, or that the fix still requires a
post-hoc correction identical in kind to M114's workaround.

**What I was told at dispatch (quoted from my own instructions, verbatim):** *"IMPORTANT: do NOT
attempt to determine or report your own 'session id' via any environment variable... that value is
known to be unreliable in this harness... Simply omit any session-id self-report from your output
entirely; the orchestrator handles that identification separately after you finish."* — this is
EXACTLY item 5's prescription: the subagent is never asked to self-report, and is explicitly told the
env-var route is unreliable, matching the newly-documented rationale word for word (not a
coincidence of phrasing — this prompt was evidently constructed by someone reading item 5 and step 1
directly).

**Independent evidence the orchestrator followed the actual mechanical steps (not just the prompt
wording), checked directly on disk, not taken on faith:**
```
$ cat /tmp/m115-dispatch-record.txt
a60bbf314719a587e
```
A dispatch-record file exists, containing one id, timestamped (per `ls -la`) BEFORE I (the dispatched
subagent) produced any output — satisfying step 2/3 of the corrected procedure and the DIR-034
anti-forgery requirement (the id must be captured at dispatch time, not fabricated after the fact by
whoever writes the artifact).

I then independently re-implemented the check the ABSORB step will run, using the REAL orchestrator
id and REAL dispatch-record file, against a throwaway artifact carrying the same dispatch id (I did
NOT write this into the real audit artifact — I was told not to inject any session-id content into
my own report, and I complied; this was a side, disposable file used only to test the mechanism):
```
$ node experiments/quay-perpetual-stream/scripts/audit-independence-check.ts \
    --orchestrator-id 4d2e9f2d-31ea-4180-a6b8-e4e7f29236bc \
    --dispatch-record /tmp/m115-dispatch-record.txt \
    <throwaway file containing: **Audit session id:** a60bbf314719a587e>

PASS: audit artifact's session id ("a60bbf314719a587e") is distinct from the orchestrator's own id
("4d2e9f2d-31ea-4180-a6b8-e4e7f29236bc") AND is corroborated by the independent dispatch-record —
genuinely independent (DIR-034 anti-forgery check satisfied)
EXIT: 0
```
This demonstrates the mechanism works end-to-end with the REAL ids captured for this real dispatch —
once the orchestrator writes this same `Audit session id: a60bbf314719a587e` line into this artifact
(per step 3.5, a step this artifact deliberately omits per my own dispatch instructions), the real
`audit-independence-check.ts` run at ABSORB will PASS on the strength of a value the orchestrator
captured BEFORE I ran, not a value it had to correct after seeing what I (wrongly) reported — there is
nothing wrong to correct, because I never reported anything. This is the substantive difference from
M114: M114's artifact briefly held a WRONG (identical-to-orchestrator) self-reported line that had to
be overwritten after the fact; M115's artifact (this file) never holds a wrong value in the first
place, because the subagent was never asked to write one.

**Is this "no post-hoc correction," matching the charter's AC3 wording precisely?** The corrected
procedure (item 5c / step 3.5) does have the orchestrator write the `Audit session id:` line into the
artifact AFTER this file is produced (since I, the subagent, do not know the dispatch id and was told
not to guess or self-report one). Read literally, that IS a write that happens after the subagent's
output exists. But it is not a *correction* of anything — there is no wrong value being fixed, only a
value being added for the first time, by the party (the orchestrator) who alone possesses it. I
judge this consistent with the charter's and task's intent ("no orchestrator post-hoc correction... the
M114 workaround pattern should not need to repeat") — the M114 "workaround pattern" specifically was
overwriting a WRONG self-reported value, not "the orchestrator writes a line the subagent could never
have written itself." This is a real, load-bearing distinction, not a rationalization: a mechanism
that requires an subagent-authored value to ever be overwritten is fragile (relies on someone
noticing the wrong value); a mechanism where the subagent is never asked to author that value at all,
and the orchestrator asserts it from data it captured independently before dispatch, has no failure
mode to notice. I flag this reading explicitly so a stricter human reviewer can override it if they
read "no post-hoc correction" as "the artifact must be complete at the moment the subagent stops
writing," which the current design does not achieve.

**Confirms:** this dispatch is genuinely consistent with the newly-documented procedure — the
subagent was told not to self-report (matching item 5's prohibition), a dispatch-record id was
captured before my output (matching step 2/3), and the audit-independence-check.ts mechanism has been
independently verified (via the dry-run above with the real ids) to PASS once the orchestrator
completes step 3.5. No remaining gap was found in the DISPATCH mechanics themselves.

**One residual gap surfaced, not in the dispatch mechanics but in the artifact-completion timing:**
running the actual mechanical DoD gate mid-audit (see below) shows `clause12-audit-independence`
currently FAILing because this artifact does not yet carry the `Audit session id:` line and the
ABSORB entry's own disposition/audit-independence-check output sections are still placeholder text
("[FILLED IN AFTER AUDIT COMPLETES]"). This is EXPECTED at this point in the sequence (my audit is a
prerequisite step; the orchestrator's step 3.5 + ABSORB-entry completion necessarily happen after
this file is written) and is not a refutation of the fix's correctness — but it does mean AC3 as
literally worded ("produces an artifact whose session id is correct... on the FIRST attempt") cannot
be fully closed out by me alone; it is provisionally confirmed by the dry-run, and needs the
orchestrator's subsequent step-3.5 edit + one real re-run of `audit-independence-check.ts` against
THIS file (post-edit) to be fully closed. I recommend whoever finalizes M115's ABSORB paste that real
re-run's output into the ABSORB entry, not just rely on my dry-run above.

**Verdict: NOT REFUTED**, with the residual completion-timing note above (not a defect in the fix
itself, but a reminder that AC3's "first attempt, no correction" claim is only FULLY closed once the
orchestrator's own step 3.5 + a real post-edit gate run are done and pasted as evidence).

---

## A gap found OUTSIDE the orchestrator's 3 mapped ACs: the TASK's own AC2 (M105 investigation) was
## not actually done

The task file `tasks/exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM.md` has its OWN 3-item AC list,
which is the task-canonical source of truth (DIR-028). Its AC2, quoted verbatim:

> Confirmed (by testing or by reading M105's actual dispatch method) whether any OTHER dispatch
> mechanism in current use produces a genuinely fresh `CLAUDE_CODE_SESSION_ID`; documented which
> mechanism is authoritative going forward.

I checked whether this was actually done. It was NOT:
- `grep -rn "M105"` across `inherited-core.md`, `OUTER-LOOP.md`, and the M115 charter finds ZERO
  hits in the two doc files, and exactly one hit in the charter — in its own "Not in scope" line:
  *"any retroactive re-verification of M105's or any other past milestone's audit-independence
  corroboration (noted as an open, unverifiable-post-hoc question in the task Resolution, not chased
  further here)."*
- The task file (read in full) has NO `## Resolution` section yet — so the charter's phrase "noted...
  in the task Resolution" refers to text that does not yet exist anywhere; it is a forward reference
  to what a not-yet-written Resolution is expected to say, not a citation of something already
  recorded.
- `milestones/M105/audits/iteration-0-acceptance-audit.md` (read directly) DOES show a
  genuinely-different-looking session id (`8c2e96ff-5390-47a6-9d9a-f230ebb92335` vs. orchestrator
  `a653b2e9-8c25-4560-8c85-bd3e757e56f3`) — exactly the discrepancy the task's Proposal flagged as
  "worth checking that milestone's actual dispatch method" — but no investigation of HOW that audit
  was actually dispatched (which tool, `claude -p` subprocess vs. `Agent` tool, etc.) appears anywhere
  in the repo. This is a genuinely open question, left open.

The "documented which mechanism is authoritative going forward" half of task AC2 IS indirectly
addressed — item 5 declares the `Agent`-tool's own `agentId` as the reliable mechanism to use — but
the "confirmed... whether any OTHER dispatch mechanism... produces a genuinely fresh
`CLAUDE_CODE_SESSION_ID`" half (the M105 puzzle specifically) was never investigated. The charter
unilaterally narrowed scope past what the task's own AC2 literally requires, without the task's
Resolution actually recording that narrowing decision anywhere yet.

**This does not refute AC1/AC2/AC3 as scoped by the charter and my dispatch instructions** — those
three (which map most directly onto what M115's actual work addressed) hold up under scrutiny. But it
IS a genuine, independently-discovered gap against the task's own literal AC list, which is the
task-canonical source of truth per this repo's own DIR-028 principle. I record this as a **CONCERN**,
not a REFUTED verdict on the doc edits themselves, and leave the task's AC2 box unticked below.

---

## Mechanical gates

```
$ bash experiments/quay-perpetual-stream/scripts/task-schema-check.sh \
    tasks/exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM.md
PASS: tasks/exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM.md — schema v1 conformant (kind=milestone-candidate)
1 total, 1 pass, 0 N/A-legacy, 0 fail
EXIT: 0
```
**PASS.**

```
$ bash experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh \
    experiments/quay-perpetual-stream/charters/M115-audit-session-id-mechanism-fix.md
PASS: ...charters/M115-audit-session-id-mechanism-fix.md — scope within the small-milestone norm
(no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan
required.
EXIT: 0
```
**PASS.**

**Additional, not explicitly requested but run for completeness — the full `it0-dod-check.sh` gate**
(the task's own `extra.acceptance` command), run mid-audit against the still-draft
`/tmp/m115-absorb-entry.md`:
```
FAIL: clause0-ac-dod-present: checklist-form AC has 3 unchecked item(s) remaining
FAIL: clause1-adversarial-audit: NO disposition statement found in ABSORB-entry text
FAIL: clause12-audit-independence: declared audit artifact does not exist on disk:
  milestones/M115/audits/iteration-0-acceptance-audit.md
(all other clauses: PASS or correctly N/A)
```
**Expected at this point in the sequence** — this audit (which produces the file that clause12 checks
for) had not yet been written when I first ran this, the ABSORB entry is still a draft with
placeholder sections, and the AC checkboxes are correctly unticked pending my independent
verification below. This is NOT a refutation; it confirms the mechanical gate is live and will
correctly re-FAIL if the orchestrator forgets any of the remaining steps (writing the
`Audit session id:` line, filling in the ABSORB entry's disposition + audit-independence-check
output, and this audit ticking the boxes it can confirm). I recommend the orchestrator re-run this
exact command after finishing those steps and paste the PASS output into the real ABSORB entry — do
not treat my mechanical-gate section above as a substitute for that final re-run.

---

## Checklist write-back

Task file: `tasks/exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM.md`. All 3 AC boxes and both DoD boxes
were `- [ ]` at audit time (no self-tick, per SELECT-time discipline).

- **AC item 1** ("`inherited-core.md`'s... section... updated to direct the ORCHESTRATOR to record
  the `Agent`-tool `agentId`..."): **TICKED `- [x]`.** Evidence: AC1 section above — item 5's text
  quoted verbatim, matches every element of this AC.
- **AC item 2** ("Confirmed... whether any OTHER dispatch mechanism... produces a genuinely fresh
  `CLAUDE_CODE_SESSION_ID`; documented which mechanism is authoritative"): **LEFT `- [ ]`.** Evidence:
  see the "gap found outside the mapped ACs" section above — the M105 investigation was never done;
  only the "which mechanism is authoritative going forward" half is addressed.
- **AC item 3** ("A future milestone's real audit dispatch, following the corrected instructions,
  produces an artifact whose session id is correct WITHOUT requiring an orchestrator post-hoc
  correction"): **TICKED `- [x]`**, with the caveat recorded in AC3 above. Evidence: my own dispatch
  instructions matched item 5/step 1 verbatim; the dispatch-record file was captured before my
  output; the dry-run of `audit-independence-check.ts` against the real ids PASSed. I read "no
  post-hoc correction" as "no correction of a WRONG subagent-authored value" (M114's actual failure
  mode), which this design structurally avoids — the orchestrator writes a value the subagent never
  authored, which is different in kind from correcting one. A stricter reader could disagree; I've
  flagged the reasoning so this tick can be reviewed/reverted by a human if they read the phrase more
  strictly.
- **DoD item 1** ("All 3 AC items above verified true"): **LEFT `- [ ]`** — AC item 2 is not
  verified true (see above), so this compound clause cannot be ticked.
- **DoD item 2** ("it0 DoD meta-enforcer passes all clauses"): **LEFT `- [ ]`** — the mid-audit run
  above shows 3 clauses still failing (expected at this stage, see Mechanical gates section); this
  box should only be ticked once a genuine post-completion re-run of `it0-dod-check.sh` actually
  exits 0, which is the orchestrator's job to do and paste as evidence at ABSORB, not mine to
  pre-tick on the strength of a dry run.

**2 of 5 boxes ticked** (AC1, AC3). AC2 and both DoD boxes left unticked, with reasons recorded above.

---

## Overall verdict

**CONCERNS**

Summary:
- The charter's own 3 ACs (inherited-core.md item 5, OUTER-LOOP.md dispatch-record procedure + step
  3.5, and this live-dispatch validation) are all **NOT REFUTED** — the instruction fix is real,
  correctly targeted at the orchestrator (never the subagent), explains its own rationale, and this
  very dispatch demonstrably followed it (verified by dry-running the actual corroboration script
  against the real dispatch-record id, not merely reading the docs).
- The unrelated build-dispatch `baime:iteration-executor` references in `OUTER-LOOP.md` (lines
  224/236) were correctly left untouched — confirmed via `git diff` showing no hunk near those lines
  and via direct reading of their surrounding context (a different mechanism, the milestone's own
  implementation-iteration dispatch).
- **However**, the task's OWN literal AC2 ("confirmed... whether any OTHER dispatch mechanism...
  produces a genuinely fresh session id... documented which mechanism is authoritative") was only
  half-addressed: the "authoritative mechanism" half is answered (use the `Agent`-tool's `agentId`),
  but the specific investigation the AC asks for — M105's actually-distinct-looking session id, and
  whether that or any other mechanism (e.g. a `claude -p` subprocess) gets a genuinely fresh
  `CLAUDE_CODE_SESSION_ID` — was never performed. The charter narrows this out of scope citing a task
  "Resolution" that does not yet exist. This is a real, independently-confirmed gap against the
  task-canonical AC list (DIR-028), not a fabricated nitpick — I recommend either (a) actually running
  the M105 investigation before this task is marked done, or (b) a human/orchestrator explicitly
  amending the task's AC2 wording (or adding the deferral to a real Resolution section) to match what
  was actually delivered, rather than leaving a literal unmet AC checked off by implication.
- Also note (not blocking): `it0-dod-check.sh`'s clause8 currently treats this task as
  "legacy/unlabeled" because its `milestone:M-115` label uses a hyphen the clause's
  `/milestone:M(\d+)/` regex doesn't match right after `M` — harmless here (clause8 PASSes as N/A
  either way) but worth a human's attention as a possibly-latent labeling/regex mismatch, unrelated to
  M115's own scope.
