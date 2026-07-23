# M119 iteration-0 — adversarial acceptance audit

**Audit session id:** a0411e30efff28964
**Orchestrator session id:** 145cc0be-0e0e-4eb4-a1aa-9d47637114c0

**Note (orchestrator-authored, per inherited-core.md's Adversarial-audit role item 5):** the line
above was written by the ORCHESTRATOR, using the `Agent` tool's own returned dispatch id
(`a0411e30efff28964`), recorded in `/tmp/m119-dispatch-record.txt` at dispatch time — not
self-reported by the subagent. This artifact and the task write-back it describes were produced in
the subagent's own isolated worktree (its sandbox declined a direct write to the shared checkout)
and landed into the main tree by the orchestrator afterward, content unchanged.

**Milestone:** M119 — `exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH`
**Charter:** `experiments/quay-perpetual-stream/charters/M119-clause8-hyphen-label-fix.md`
**Audited commit:** `36d2a67578a9348c920f63814f17c7fb70af51e0` (worktree fast-forwarded to this from a stale `ad49578`; see "Environment note" below)
**Auditor:** independent, fresh-context, REFUTE-FIRST stance. No prior involvement in this milestone's work.

## Environment note (housekeeping, not a milestone finding)

My assigned worktree (`/home/yale/work/quay/.claude/worktrees/agent-a0411e30efff28964`) was
initially at `ad4957896` (M117-era), well behind the claimed `36d2a67`. Confirmed `36d2a67` was a
clean fast-forward descendant (`git merge-base --is-ancestor HEAD 36d2a67` → yes, no divergent
local commits, working tree clean) and fast-forwarded with `git reset --hard 36d2a67`. All
verification below was performed after that sync, directly against `36d2a67`.

This report file itself, and the task write-back, could not be written to the shared main-tree
path (`/home/yale/work/quay/...`) via the Write tool (sandbox refused: "Edit the worktree copy of
this file instead"), even though a plain `Bash touch` to that path did succeed moments earlier —
apparently an inconsistency between tool-level and shell-level enforcement. Per the task
instructions' fallback, **both this report and the task write-back landed only in my own worktree**
copy (`/home/yale/work/quay/.claude/worktrees/agent-a0411e30efff28964/...`), not the shared tree.
The orchestrator will need to land them.

## 1. Diff scope — confirmed exactly the claimed one-line change

```
$ git show 36d2a67 --stat
 .../quay-perpetual-stream/scripts/it0-dod-check.ts |  2 +-
 milestones/M119/iterations/iteration-0.md          | 77 ++++++++++++++++++++++
 2 files changed, 78 insertions(+), 1 deletion(-)
```

Full diff on the script:
```diff
-  const milestoneLabelMatch = taskText.match(/milestone:M(\d+)/i);
+  const milestoneLabelMatch = taskText.match(/milestone:M-?(\d+)/i);
```

Confirmed **exactly** the one-line regex change claimed, plus the (expected, non-code) iteration
report. The preceding SELECT commit (`a7ab82e`) touches only the charter + two task-annotation
files (normal bookkeeping). **No scope creep found.**

## 2. AC1 — regex matches both forms — TRUE, re-verified with a wider edge-case sweep

The report's own 3-case test reproduces. I additionally tested 13 more cases the report did not
(cutover boundary M-40/M-39, no-digit label, malformed `MX`/`M-X`, double-hyphen, two-labels-in-
one-string, case-insensitivity, embedded-word false positive, whitespace-after-colon):

```
cutover-boundary-exact-M40: "milestone:M-40" => match num=40
cutover-boundary-below-M39: "milestone:M-39" => match num=39
no-milestone-number-at-all: "milestone:M-something-no-digits" => null
malformed-MX: "milestone:MX" => null
malformed-M-X: "milestone:M-X" => null
negative-like-M-minus-number-typo: "milestone:M--118" => null
number-then-hyphen-then-number: "milestone:M113-118" => matches "milestone:M113" (num=113) — first-only, pre-existing .match() behavior, unaffected by this fix
word-boundary risk 'Xmilestone:M-118': matches "milestone:M-118" (num=118) — no new boundary issue
whitespace 'milestone: M-118' (space after colon): null — correctly does NOT match (no regression)
```

No new false positive is introduced by making the hyphen optional. The malformed/no-digit cases
correctly fall through to null exactly as before. **AC1 holds**, and I could not break it with
adversarial inputs.

## 3. AC2 — clause8 actually applies against a real hyphenated task

Reproduced the report's exact command against `exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE` /
`/tmp/m118-absorb-entry.md` (pre-existing in the repo, confirmed present, untouched by me):

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE experiments/quay-perpetual-stream/charters/M118-arch-audit-post-dir058-explore.md /tmp/m118-absorb-entry.md 2>&1 | grep -i clause8
PASS: clause8-task-canonical-lifecycle-record: task carries a real '## Proposal' (2026 chars) and a well-formed '## Plan' [tasks/exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE.md]
```

Byte-for-byte identical to the claim. **This specific AC2 instance is TRUE.**

### CONCERNS finding — the general narrative behind AC2 does not hold across the repo's real tasks

The charter and report both generalize beyond this one example ("the repo's real, established
convention used on every task since ~M111 ... match", "this is the exact cutover-check behavior
... never actually exercised"). Per the audit brief's instruction (f), I searched all of
`tasks/*.md` for `milestone:M` occurrences. Three real, `status: done` tasks each carry **two**
milestone labels — a discovery label first, a landed label second:

```
tasks/exp5-M-GATE-CLI-ERROR-UX.md:        - milestone:M37-discover-post-qeng / - milestone:M56
tasks/exp5-M-GATE-HELP-SYNOPSIS-GAP.md:   - milestone:M37-discover-post-qeng / - milestone:M51
tasks/exp5-M-GATE-MCP-PARITY-GAP.md:      - milestone:M37-discover-post-qeng / - milestone:M53
```

Since `taskText.match()` (no `/g` flag) returns only the **first** match in file order, and the
discovery label (`milestone:M37...`, num=37, below the N≥40 cutover) appears before the real
landed label (M56/M51/M53, all comfortably above cutover), clause8 resolves the wrong number and
still reports N/A on all three — reproduced directly against the live files:

```
tasks/exp5-M-GATE-CLI-ERROR-UX.md
  real labels present: - milestone:M37-discover-post-qeng, - milestone:M56
  regex first-match: milestone:M37 -> parsed num: 37 -> clause8Applies: false
tasks/exp5-M-GATE-HELP-SYNOPSIS-GAP.md
  real labels present: - milestone:M37-discover-post-qeng, - milestone:M51
  regex first-match: milestone:M37 -> parsed num: 37 -> clause8Applies: false
tasks/exp5-M-GATE-MCP-PARITY-GAP.md
  real labels present: - milestone:M37-discover-post-qeng, - milestone:M53
  regex first-match: milestone:M37 -> parsed num: 37 -> clause8Applies: false
```

Important nuance: this is **not caused by this milestone's fix**. The pre-fix regex
(`/milestone:M(\d+)/i`, no optional hyphen) already matched `milestone:M37` (hyphenless, digits
adjacent to M) identically, so these 3 tasks were N/A both before and after M119. The hyphen fix
neither helps nor hurts them — it simply doesn't reach this second, independent latent defect
(first-match-wins across multiple milestone labels in one task file). I also checked
`tasks/DIR-030.md`, which contains prose mentioning `milestone:M41`/`milestone:M42` (describing
labels written onto *other* tasks, not its own) — another instance of the same "clause8 scans the
whole file text, not a specific label field" fragility, again pre-existing and unrelated to the
hyphen change.

**Net assessment:** AC2 as literally worded ("re-run against A real task... confirm clause8
applies") is satisfied by the one cited example. But the broader claim that clause8 "now genuinely
applies" to the repo's real milestone-labeled population is overstated: at least 3 concrete,
currently-`done` tasks in this same repo still get an incorrect N/A verdict, for a related-but-
distinct reason the milestone did not test for and the report does not disclose. This is a
non-blocking CONCERNS finding (charter explicitly scoped "only the label-matching regex", not the
broader multi-label scan), but the recommendation section's confident "DONE" framing should not be
read as "clause8 is now correct against all real tasks" — it isn't. Recommend a follow-up defect
(not filed by this audit, which is scoped to writing back only to
`exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH`'s own AC/DoD) — e.g.
`exp5-DEFECT-CLAUSE8-MULTI-MILESTONE-LABEL-FIRST-MATCH` — to make the scan label-field-aware or
take the max/last matching label rather than the first.

## 4. AC3 — dod-fixture-selfcheck.sh 17/17, golden-diff unchanged

```
$ bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh
...
PASS: M40C-fake-canonical-violating — exit 1 (expected 1) [fixtures/dod/task-canonical-record-violating-stub.md]
PASS: M40B-fake-canonical-compliant — exit 0 (expected 0) [fixtures/dod/task-canonical-record-compliant-stub.md]
...
PASS: all 17 DoD fixtures behaved as asserted.
```
17/17 confirmed independently, both clause8-relevant fixtures at their exact claimed exit codes.
**AC3 holds.**

## 5. Regression checks — re-verified independently

```
$ node --test experiments/quay-perpetual-stream/test/*.mjs
ℹ tests 343
ℹ pass 343
ℹ fail 0
```
Matches the claimed 343/343 exactly.

```
$ npx tsc --noEmit -p packages/quay-backlog/ ; echo exit=$?   → exit=0
$ npx tsc --noEmit -p packages/quay-github/  ; echo exit=$?   → exit=0
$ npx tsc --noEmit -p packages/quay-native/  ; echo exit=$?   → exit=0
$ npx tsc --noEmit -p packages/quay/         ; echo exit=$?   → exit=0
```
All 4 packages independently confirmed exit 0, matching the claim.

## 6. DoD item 2 ("it0 DoD meta-enforcer passes all clauses") — evidence is indirect

The report offers no direct pasted evidence of a full, all-clauses `it0-dod-check` run against
M119's own charter/task (the milestone hasn't been through its own ABSORB yet — task `status` is
still `todo`). The only clause8-specific run cited (§3 above) exercises M118's materials, not
M119's own. In this repo's established convention, `dod-fixture-selfcheck.sh` is the standard
proxy for "the DoD meta-enforcer script behaves correctly across all clauses" (it golden-diffs
every clause 0-9 against fixtures, not just clause8) — I accept that reading since I independently
confirmed all 17/17 fixtures pass, spanning every clause. Flagging this as a narrower CONCERNS
item: the DoD item's wording is ambiguous between "the script's own clause logic is fixture-
verified" (true, independently confirmed) and "a full M119-self ABSORB-time meta-enforcer run
passes" (not shown, and not attempted by this audit — it requires ABSORB-time context, e.g.
worktree-branch-hygiene and V_meta-ledger state, outside this audit's scope to reconstruct).

## 7. Task bookkeeping — write-back gap confirmed and performed

`exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH` was found with `status: todo`, all 5 AC/DoD checkboxes
unticked, and no `## Resolution` section — the same class of gap flagged for M116/M117/M118. Per
DIR-020 discipline ("the audit is the ONLY writer that ticks boxes"), I performed the write-back
myself: ticked all 5 boxes (each independently re-verified true above), appended a `## Resolution`
section citing this audit's own fresh evidence, and set `status: done`. As noted above, the write
landed only in my own worktree's copy of
`tasks/exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH.md`, not the shared main tree — the orchestrator
needs to land it.

## Verdict: CONCERNS

The core one-line regex fix is real, minimal, exactly as claimed, and independently reproduced
byte-for-byte on every AC. I could not break AC1 with 13 additional adversarial regex inputs, and
AC2/AC3's specific cited evidence reproduces exactly. Findings that keep this at CONCERNS rather
than NO REFUTATION FOUND or REFUTED:

1. **(non-blocking, material)** The milestone's narrative that clause8 "now genuinely applies" to
   the repo's real `milestone:M-NN` task population is falsified by 3 concrete, currently-`done`
   real tasks (`exp5-M-GATE-CLI-ERROR-UX`, `exp5-M-GATE-HELP-SYNOPSIS-GAP`,
   `exp5-M-GATE-MCP-PARITY-GAP`) that still resolve to N/A due to a related, pre-existing (not
   introduced or worsened by this fix) first-match-wins ambiguity when a task carries two
   milestone labels. The literal AC2 wording (one cited example) is technically satisfied; the
   broader claim in the report's prose is not fully accurate.
2. **(weak)** DoD item 2's evidence is indirect (fixture-selfcheck as proxy), not a literal
   ABSORB-time full-clause run against M119 itself.

Neither finding contradicts the specific, narrowly-worded AC/DoD checkboxes as literally written,
which is why this is CONCERNS and not REFUTED — but the report's confident, generalized framing
("DONE... genuinely applies... never actually exercised [until now]") overstates what was actually
fixed, and a reader could reasonably come away believing clause8 now works correctly against all
real repo tasks, which is false for at least 3 of them.
