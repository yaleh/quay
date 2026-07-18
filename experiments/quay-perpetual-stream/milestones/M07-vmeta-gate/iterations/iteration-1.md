# M07-vmeta-gate — Iteration 1 (independent re-verification) report

**Milestone:** M07-vmeta-gate (methodology-infra, explore, no VT weight)
**Iteration:** 1 (independent re-verification of iteration-0's build)
**Worktree:** `experiments/quay-perpetual-stream/milestones/M07-vmeta-gate/worktrees/iteration-1`
**Branch:** `exp5-m07-iteration-1` (based on `d2ec46f`, the same pre-iteration-0 commit iteration-0
used — independently re-derived, not inherited from `exp5-m07-iteration-0`)
**Date:** 2026-07-18

## §1. Context read

Per dispatch instructions, read ONLY:
1. `experiments/quay-perpetual-stream/charters/M07-vmeta-gate.md` (Tier-A charter)
2. `experiments/quay-perpetual-stream/inherited-core.md` (pinned Tier-B, current master HEAD)
3. iteration-0's report (`git show exp5-m07-iteration-0:...iterations/iteration-0.md` — the file
   does not exist at repo-root/master since iteration-0's branch was never merged)
4. iteration-0's actual diff: `git diff cbc5d9d..8776471 -- v-meta-ledger.md OUTER-LOOP.md
   dashboard.md`
5. (Referenced by the re-verification task, not extra scope) the archived
   `directives/archive/DIR-005-v-meta-consolidation-lag-tracked-and-gated-at-absorb.md` — read
   closely, per instruction 1, not just skimmed.
6. `dashboard.md`'s actual m1 and m3 ABSORB log entries — to check instruction 2 (m3 row accuracy)
   and instruction 1 (whether (a)/(b) are one insight or two) against primary evidence, not
   iteration-0's paraphrase of them.

## §2. HARD GATES — raw output (re-run fresh this iteration, not copied from iteration-0)

### Gate 1 — pending directives listing + disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
```
Raw output: **empty** (zero files, exit 0). Same result iteration-0 found. No files to disposition.

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
$ git worktree add experiments/quay-perpetual-stream/milestones/M07-vmeta-gate/worktrees/iteration-1 -b exp5-m07-iteration-1 d2ec46f
Preparing worktree (new branch 'exp5-m07-iteration-1')
HEAD is now at d2ec46f exp5 outer loop: drain DIR-005, SELECT m7 = M-VMETA-GATE, value-typed ledger first fully in-force use
```

All edits this iteration target paths under this worktree only (see end-of-iteration isolation
proof, §7).

## §3. Independent re-verification findings

### Check 1 — ledger structure: one row or two for the CI-job≡audit-channel pattern? **DEFECT FOUND, FIXED.**

Re-read DIR-005's Finding section closely (not iteration-0's summary of it). The directive's Finding
numbers three items, but items 1 and 2 read as follows:

> 1. m1's `domain-audit-channel ≡ CI-job` pattern + per-subcommand audit exercise — "logged but NOT
>    yet consolidated".
> 2. φ fold-back: the `CI-job ≡ audit-channel` pattern has CROSSED the §4.2 confirmation threshold
>    (2 cross-domain confirmations: m1 packaging, m3 cross-provider) yet "consolidation ... still
>    pending".

Item 2 explicitly says "**the** `CI-job ≡ audit-channel` pattern" (definite article, same pattern
named in item 1) "has CROSSED" the threshold — this is the SAME pattern's status changing, narrated
across two sentences of one Finding paragraph, not a second distinct insight. I then went to primary
evidence — `dashboard.md`'s actual ABSORB log entries, not paraphrase — to confirm:

- m1's ABSORB entry (line 178): "Two adaptation candidates (domain-audit-channel≡CI-job pattern;
  per-subcommand audit exercise) logged but NOT yet consolidated — only 1 milestone's evidence, need
  a 2nd confirming instance per φ threshold (§4.2)." → ORIGIN, confirmation count 1.
- m3's ABSORB entry (line 285): "φ: CI-job≡audit-channel pattern (from `inherited-core.md`,
  **validated once at M01-dist**) gets its **2nd confirming instance here** ... this crosses the φ
  confirmation threshold ... worth folding into `inherited-core.md` as a **confirmed, not just
  proposed, pattern**." → explicitly the SAME pattern ("validated once at M01-dist") gaining its
  2nd confirmation, i.e. a STATUS TRANSITION of one insight, not a new insight.

`inherited-core.md`'s own φ definition (line 5): "a milestone adaptation is reused UNCHANGED by a
later different-domain milestone" — reuse-unchanged accrues evidence to ONE adaptation over time;
it is not a mechanism that spawns a new tracked entity per reuse event.

**Verdict: this is ONE insight whose confirmation status evolved (1→2, proposed→confirmed), not two
distinct insights.** iteration-0 modeled it as two separate ledger rows and explicitly flagged this
as an open question for iteration-1 (its report §8: "worth iteration-1 double-checking this
interpretation ... since collapsing to one row would also have been a defensible reading"). Having
now checked the primary sources directly, collapsing to one row is not merely "also defensible" — it
is the reading DIR-005's own item 2 and `dashboard.md`'s m3 log entry both state directly ("the...
pattern... validated once... gets its 2nd confirming instance"). **Fixed**: rewrote
`v-meta-ledger.md` with the `domain-audit-channel≡CI-job` insight as a SINGLE row (confirmation
count 2, status `confirmed`, origin m1, confirmed-at m3), with an explicit "Note on row count"
section in the ledger documenting the correction and citing the exact log lines relied on, so future
readers don't have to re-derive this.

This also resolves why keeping two rows would have been actively harmful, not just imprecise: the
K=2 alarm health track (item 2) walks "every ledger row past threshold" — with two rows for the same
underlying pattern, a naive implementation would either double-count one real debt item as two
alarms, or require an undocumented dedup rule nowhere stated. One row removes the ambiguity
entirely.

### Check 2 — m3 isolation-leak row accuracy. **VERIFIED CORRECT, no change needed.**

Re-read `dashboard.md`'s actual m3 ABSORB log entry directly (lines 252-262), not iteration-0's
summary:

> "Mid-iteration self-caught a repo-root isolation leak (2 files) and recovered inside the worktree
> before finishing — logged as an adaptation-log finding recommending `inherited-core.md` flag
> dashboard.md/gap-list.md/backlog.md as standing risk paths for this exact mistake (**noted for a
> future consolidation pass, not applied this milestone — out of scope**)."

Ledger row: `origin milestone = m3 (M03-abi-eval)`, `confirmation count = 1 (m3 only)`, `status =
proposed — noted, never applied`. This matches the primary source exactly: correct origin milestone
(m3, not m1 or elsewhere), correct confirmation count (1, no second cross-domain reuse recorded
anywhere in the log), correct status (`proposed`, matching "noted... not applied"). **No defect —
kept unchanged from iteration-0's version** (only the surrounding ledger structure changed per
Check 1, not this row's content).

### Check 3 — is the K=2 alarm math mechanically computable? **GAP FOUND, FIXED.**

iteration-0's ledger defined "milestones-since-confirmed" narratively ("confirmed at m3, m4/m5/m6
have since completed = 3 milestones since confirmed") but did not give a formula tying it to a
concrete, re-derivable quantity — a future ABSORB doing this mechanically would have to recount by
hand from prose each time, which is exactly the kind of soft, restatement-prone check DIR-009/the
gate-hash mechanism exists to avoid elsewhere in this experiment.

Checked whether the needed inputs actually exist in the record: `dashboard.md`'s own log entries
explicitly state `milestone_counter → N` at every ABSORB (grepped: m1→1, m2→2, m3→3, m4→4, m5→5,
m6→6, confirmed via `grep -n "milestone_counter" dashboard.md`). This means "confirming milestone
number" is a concrete, citable integer (3, for the CI-job≡audit-channel row) and "current
milestone_counter" is likewise concrete (6, dashboard.md line 4) — so the quantity IS mechanically
computable as a plain subtraction.

**Fixed**: added an explicit formula to both `v-meta-ledger.md`'s Definitions section and the
`dashboard.md` health track row: `milestones-since-confirmed = milestone_counter (current,
pre-increment) − confirming milestone number (recorded in the row)`. For the current row: 6 − 3 = 3
> K=2. This is now something a future ABSORB step can literally compute from two integers already
present in the record, not something requiring re-reading and recounting narrative log paragraphs.

### Check 4 — OUTER-LOOP.md ABSORB gate: real block or prose? **GAP FOUND, FIXED (tightened).**

Re-read iteration-0's `OUTER-LOOP.md` diff directly. It added the gate as a sub-bullet under step 6
(ABSORB) and updated step 7 (UPDATE DASHBOARD) to mention the new track, but the gate's own wording
used "may NOT complete until it is resolved" without explicitly tying that "may NOT" to a concrete,
literal thing the loop does next (step 7's `milestone_counter++`) — leaving room for a future reader
to treat it as descriptive ("this ABSORB step conceptually includes this consideration") rather than
enforced ("do not execute this specific subsequent action").

**Fixed**: reworded the gate to explicitly name what it blocks — "HARD BLOCK on step 7's
`milestone_counter++`" in the gate's own heading, and added "(only after the gate above clears)" to
step 7's `milestone_counter++` clause itself, so the block target is named on both ends (the gate
declares what it blocks; the blocked action references back to the gate). This makes the constraint
mechanically actionable by an executor following the numbered steps literally: step 6 contains an
explicit precondition on entering step 7's increment, not a free-floating consideration elsewhere in
the document.

Confirmed this is placed correctly in the control flow: step 6 (ABSORB) precedes step 7 (UPDATE
DASHBOARD, which contains `milestone_counter++`) in the numbered list, so a gate inside step 6 that
blocks proceeding functionally gates step 7's execution — this was already structurally correct in
iteration-0's placement; the wording tightening in this iteration makes the enforceability explicit
rather than relying on the reader to infer it from step ordering alone.

### Check 5 — Done-when 4: ledger row unambiguous and both options open? **VERIFIED CORRECT.**

Re-read the (now single, corrected) ledger row's text fresh, independent of iteration-0's framing.
It states: status `confirmed`, explicitly past K=2 (3 > 2, with the formula from Check 3), and "This
row MUST be resolved (consolidate into `inherited-core.md` OR record a new dated carry-forward
reason in this row) at m7's own ABSORB" — both options are named side-by-side with "OR", neither is
pre-selected, and the row explicitly states "**Not resolved by this iteration**" — the actual
consolidate-or-carry-forward act is left open for the outer orchestrator. Checked this wasn't
accidentally narrowed by my Check 1 fix (collapsing two rows to one): the corrected single row
preserves the identical "MUST be resolved... consolidate OR record..." language iteration-0 used, so
the decision surface for the orchestrator's forthcoming ABSORB is unchanged in substance, only
de-duplicated in ledger structure. **Confirmed unambiguous, both options genuinely still open.**

### Check 6 — all 5 binary Done-when clauses genuinely met (re-derived, not iteration-0's self-report)

1. **Ledger exists, items migrated, status populated** — `git diff --cached
   experiments/quay-perpetual-stream/v-meta-ledger.md` (new file, this iteration's corrected
   version) shows 2 rows (not 3 — see Check 1 for why 2 is the correct count, both faithfully
   migrated from DIR-005's Finding with status fields populated: `confirmed`/`proposed`). MET, with
   the structural correction from Check 1.
2. **`dashboard.md` health track, K=2 explicit** — `git diff --cached
   experiments/quay-perpetual-stream/dashboard.md` shows the new row with "**K=2**" written literally
   in the alarm column and a mechanical formula in the current-value cell (Check 3 fix). MET.
3. **`OUTER-LOOP.md` ABSORB gate, referencing ledger + track** — `git diff --cached
   experiments/quay-perpetual-stream/OUTER-LOOP.md` shows the gate naming both
   `v-meta-ledger.md` and the `dashboard.md` `V_meta consolidation lag` track by name, with an
   explicit block target (Check 4 fix). MET.
4. **Ledger row (b)/the single confirmed row unambiguously ready for m7's own ABSORB** — Check 5
   above, re-verified independently. MET. (The actual consolidate-or-carry-forward act itself is
   explicitly NOT this iteration's job, same as iteration-0 correctly scoped it — that's the outer
   orchestrator's next step after this report.)
5. **No code touched ⇒ no test run** — `git status --short` in this worktree (§7 below) shows only
   `.md` paths changed/added. MET, no test run performed, none required.

All 5 Done-when clauses are met, with 3 of them requiring a real, evidenced fix on re-verification
(Checks 1, 3, 4) rather than a rubber-stamp of iteration-0's draft.

## §4. Test suite

No code was touched this iteration either (same as iteration-0) — only `.md` files
(`v-meta-ledger.md` rewritten, `dashboard.md`/`OUTER-LOOP.md` edited). Per charter Done-when clause
5: **no test run required, and none was run.**

## §5. Done-when checklist (charter, verbatim)

1. `[x]` V_meta insight ledger exists, 3 known items migrated **correctly restructured to 2 ledger
   rows** (the CI-job≡audit-channel pattern is one insight with an evolving confirmation history,
   not two — see §3 Check 1), status fields populated — pasted diff below (§6).
2. `[x]` `dashboard.md` gains `V_meta consolidation lag` health track, K=2 threshold explicit AND
   mechanically computable (formula added, §3 Check 3) — pasted diff below (§6).
3. `[x]` `OUTER-LOOP.md` ABSORB step contains a REAL, enforceable gate (explicit block target named,
   §3 Check 4) — pasted diff below (§6).
4. `[x]` Ledger row for the CI-job≡audit-channel pattern unambiguously ready for m7's own ABSORB
   decision, both resolution options genuinely open (§3 Check 5).
5. `[x]` No script touched ⇒ no test run required — stated explicitly above (§4).

## §6. Diffs (pasted, final state this iteration)

```diff
diff --git a/experiments/quay-perpetual-stream/OUTER-LOOP.md b/experiments/quay-perpetual-stream/OUTER-LOOP.md
index 3768575..0cefb00 100644
--- a/experiments/quay-perpetual-stream/OUTER-LOOP.md
+++ b/experiments/quay-perpetual-stream/OUTER-LOOP.md
@@ -117,8 +117,21 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
    adaptations to the log; check φ — if a prior adaptation was just reused unchanged by THIS
    (different-domain) milestone, **CONSOLIDATE**: merge it into `inherited-core.md` and retire the
    citation (§4.2).
+   - **V_meta consolidation-lag gate (DIR-005 / M07-vmeta-gate, HARD BLOCK on step 7's
+     `milestone_counter++`):** before this milestone may be marked DONE / `milestone_counter`
+     incremented in step 7 below, check every row in `v-meta-ledger.md`. For each row whose status is
+     `confirmed` (past the φ 2-cross-domain-confirmation threshold) but not yet `consolidated`,
+     compute `milestones-since-confirmed = milestone_counter (current, pre-increment) − confirming
+     milestone number (recorded in the row)`. If this exceeds the `dashboard.md` `V_meta
+     consolidation lag` health track's alarm (**K=2**), step 7's `milestone_counter++` MUST NOT
+     execute until the row is resolved by EITHER (a) consolidating the row's pattern into
+     `inherited-core.md` at this ABSORB (pasted diff) OR (b) recording an explicit DATED
+     carry-forward reason directly in the ledger row (no silent deferral — a missing/blank
+     disposition is not a valid resolution). Update the row's status/notes in `v-meta-ledger.md`
+     accordingly as part of this ABSORB step, before proceeding to step 7.
 7. **UPDATE DASHBOARD** — VT, slope (marginal Δv), ρ, charter-thickness, discovery-latency,
-   calibration-error, milestone_counter++.
+   calibration-error, `V_meta consolidation lag` (re-derive milestones-since-confirmed for every
+   ledger row per `v-meta-ledger.md`), milestone_counter++ (only after the gate above clears).
 8. **CHECKPOINT (non-blocking)** if `milestone_counter % 5 == 0`: write `checkpoints/cp-<NN>.md` — a
    health snapshot across all tracks + a re-test of the standing hypothesis (§1). **Do NOT wait for a
    human.** After writing it, CONTINUE to the next milestone. The human reviews snapshots

diff --git a/experiments/quay-perpetual-stream/dashboard.md b/experiments/quay-perpetual-stream/dashboard.md
index 40d40e6..59b4a6e 100644
--- a/experiments/quay-perpetual-stream/dashboard.md
+++ b/experiments/quay-perpetual-stream/dashboard.md
@@ -126,6 +126,7 @@ iteration-0's arithmetic slip of 95.83 during iteration-1's independent re-verif
 | discovery latency (mechanizable) | **0** (m1-m5 all — ...) | >~8 iters late |
 | calibration error \|Δv−Δv̂\|/Δv̂ | **0%** (m1); ... | trend must shrink |
 | inner-convergence success | **5/5** (m1-m5 each: ...) | mid-milestone re-scope = fail |
+| V_meta consolidation lag | **1 row past threshold, milestones-since-confirmed = current `milestone_counter` (6) − confirming milestone number (3) = 3** — `v-meta-ledger.md`'s single `domain-audit-channel≡CI-job` row is `confirmed` (φ threshold crossed at m3: m1 packaging origin + m3 cross-provider 2nd instance, 2 cross-domain confirmations, one row whose confirmation count evolved 1→2, not two separate rows) but not `consolidated`; mechanically re-derivable each ABSORB as `milestone_counter − confirming_milestone_number`, currently 6−3=3, already **exceeding the alarm** by the time m7's own ABSORB runs. The ledger's other row (m3's isolation-leak lesson) is `proposed`, not yet past threshold, not counted against this track. Symmetric to the discovery-latency track above: measures milestones-since-confirmed for any ledger row past the φ 2-confirmation threshold but not yet `consolidated`. | **>2 milestones (K=2)** since confirmed-but-not-consolidated |

 ## Control limits (pre-declared; §6/§6.1)
```

`v-meta-ledger.md` is a new file (79 lines) — full contents committed in the worktree; see §3 Check
1 for the row-count correction rationale that replaces iteration-0's 3-row draft with a 2-row
version, and §3 Check 3 for the mechanical formula added to its Definitions section.
```

## §7. End-of-iteration isolation proof

Worktree (`experiments/quay-perpetual-stream/milestones/M07-vmeta-gate/worktrees/iteration-1`),
captured pre-commit:
```
$ git status --short
 M experiments/quay-perpetual-stream/OUTER-LOOP.md
 M experiments/quay-perpetual-stream/dashboard.md
?? experiments/quay-perpetual-stream/v-meta-ledger.md
```
(This report itself is added in the commit below.)

Shared repo root (`/home/yale/work/quay`):
```
$ git status --short
(clean)
```

## §8. Reflection

- **iteration-0's self-flagged ambiguity (its report §8) was the right call to escalate, and the
  concern was substantive**, not a false alarm: re-checking DIR-005's primary text and
  `dashboard.md`'s actual m1/m3 log entries (not iteration-0's paraphrase of them) confirmed the
  two-row draft was a real structural defect, not merely "also defensible." The definite-article
  phrasing in DIR-005 ("**the** CI-job≡audit-channel pattern ... has CROSSED the threshold") and
  `dashboard.md`'s own "validated once at M01-dist ... gets its 2nd confirming instance" language
  both directly state a status transition of one entity, not the birth of a second one.
- **The K=2 alarm's mechanical-computability gap (Check 3) would not have surfaced without
  explicitly asking "can a future ABSORB literally compute this from two integers, or does it have
  to re-read and recount prose."** iteration-0's version was correct in its stated conclusion (3 >
  K=2) but didn't wire that conclusion to a reusable formula — worth flagging as a general pattern
  for future health-track additions in this experiment: state the arithmetic, not just its result.
- **Both structural fixes (Checks 1, 3) reduce, rather than expand, this milestone's footprint** —
  net effect is a smaller, tighter ledger (2 rows instead of 3) and a more precisely-worded gate,
  consistent with the charter's own non-goal (item 5: do not expand scope, only instrument the
  hand-off).
