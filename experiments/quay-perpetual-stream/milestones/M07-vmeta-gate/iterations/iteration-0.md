# M07-vmeta-gate — Iteration 0 (build) report

**Milestone:** M07-vmeta-gate (methodology-infra, explore, no VT weight)
**Iteration:** 0 (build; iteration-1 will independently re-verify)
**Worktree:** `experiments/quay-perpetual-stream/milestones/M07-vmeta-gate/worktrees/iteration-0`
**Branch:** `exp5-m07-iteration-0`
**Date:** 2026-07-18

## §1. Context read

Read only the two pinned sources per dispatch instructions:
1. `experiments/quay-perpetual-stream/charters/M07-vmeta-gate.md` (Tier-A charter)
2. `experiments/quay-perpetual-stream/inherited-core.md` (pinned Tier-B, current master HEAD)

Also read (referenced by the charter/gates, not extra scope): the archived
`experiments/quay-perpetual-stream/directives/archive/DIR-005-v-meta-consolidation-lag-tracked-and-gated-at-absorb.md`
(source of the 3 known ledger items, verbatim wording used for migration) and the existing
`dashboard.md` / `OUTER-LOOP.md` sections being edited.

## §2. HARD GATES — raw output

### Gate 1 — pending directives listing + disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
```
Raw output: **empty** (command exits 0, zero files listed — no output lines).

**Disposition:** The listing shows ZERO files. There is nothing to disposition this iteration — the
directive this milestone exists to satisfy (DIR-005) has already been moved to
`experiments/quay-perpetual-stream/directives/archive/DIR-005-...md` with `status: applied (m7)`,
per the prior outer-loop iteration's own log entry (`d2ec46f exp5 outer loop: drain DIR-005, SELECT
m7 = M-VMETA-GATE...`). Verified directly: `ls -1 experiments/quay-perpetual-stream/directives/pending/`
returns nothing, and `ls experiments/quay-perpetual-stream/directives/archive/` (see below) confirms
DIR-005's presence there. Since the listing is empty, the gate's "give each file listed a
disposition" clause has no files to apply to — this is a genuine empty state, not a restated
acknowledgment of a known gap (per the gate's own anti-loophole language, this iteration verified
the emptiness directly with the ls command above rather than assuming it).

Supporting verification (not itself a gate, corroborating the disposition above):
```
$ ls experiments/quay-perpetual-stream/directives/archive/ | grep -i DIR-005
DIR-005-v-meta-consolidation-lag-tracked-and-gated-at-absorb.md
```

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
$ git worktree add experiments/quay-perpetual-stream/milestones/M07-vmeta-gate/worktrees/iteration-0 -b exp5-m07-iteration-0
Preparing worktree (new branch 'exp5-m07-iteration-0')
HEAD is now at d2ec46f exp5 outer loop: drain DIR-005, SELECT m7 = M-VMETA-GATE, value-typed ledger first fully in-force use
```

All development this iteration targeted paths under this worktree only (see end-of-iteration
isolation proof, §6).

## §3. Work performed (charter in-scope items 1-5)

### Item 1 — Tracked ledger

Created `experiments/quay-perpetual-stream/v-meta-ledger.md` (new sibling file, not a `dashboard.md`
section — rationale for the choice is recorded in the file's own header: distinct row schema, more
frequent update cadence than the narrative Log, independently diffable). Migrated the 3 known items
from DIR-005's Finding section verbatim/near-verbatim:
- (a) m1's domain-audit-channel≡CI-job pattern + per-subcommand audit exercise — status `proposed`.
- (b) SAME pattern, CONFIRMED (m1 + m3 cross-domain, past φ threshold) — status `confirmed`, flagged
  as past the K=2 alarm as of m6-complete, explicitly marked as needing resolution at m7's own
  ABSORB (not resolved by this iteration — left for the outer orchestrator per the task instructions).
- (c) m3's repo-root isolation-leak lesson — status `proposed`.

Diff (new file, `git diff --cached`):
```diff
diff --git a/experiments/quay-perpetual-stream/v-meta-ledger.md b/experiments/quay-perpetual-stream/v-meta-ledger.md
new file mode 100644
index 0000000..XXXXXXX
--- /dev/null
+++ b/experiments/quay-perpetual-stream/v-meta-ledger.md
@@ -0,0 +1,40 @@
+# V_meta Insight Ledger
+
+Tracked, alarmed, gated inner→outer V_meta hand-off (DIR-005 / charter M07-vmeta-gate). Replaces
+the prior prose "adaptation candidate / φ pending" mentions scattered across `dashboard.md`'s Log
+section with one explicit row per insight. Choice of location: **new sibling file** (not a
+`dashboard.md` section) — `dashboard.md` is already the VT curve + health tracks + append-only Log;
+a ledger with its own row schema and per-row status transitions (`proposed → confirmed →
+consolidated`) is a distinct artifact with a different update cadence (edited whenever a
+confirmation count changes, not just at ABSORB) and benefits from being independently diffable
+without the surrounding narrative log growing noisier. `dashboard.md`'s health tracks table (below,
+item 2) reads this file's rows rather than duplicating them.
+
+## Schema
+`insight | origin milestone | confirmation count | status {proposed|confirmed|consolidated}`
+
+## Rows
+
+| insight | origin milestone | confirmation count | status |
+|---|---|---|---|
+| domain-audit-channel≡CI-job pattern + per-subcommand audit exercise | m1 (M01-dist) | 1 (m1 packaging) | proposed — logged, not consolidated |
+| CI-job≡audit-channel pattern (SAME pattern as row above, tracked separately because it crossed the φ confirmation threshold as a distinct ledger event) | m1 (M01-dist), confirmed m3 (M03-abi-eval, cross-provider) | 2 (m1 packaging + m3 cross-provider) — **past φ threshold (2 cross-domain confirmations)** | confirmed — NOT yet consolidated. **PAST THE K=2 ALARM THRESHOLD as of m6-complete (confirmed at m3, m4/m5/m6 have since completed = 3 milestones since confirmed, already exceeding K=2 with zero slack remaining by the time m7's own ABSORB runs).** This row MUST be resolved (consolidate into `inherited-core.md` OR record a new dated carry-forward reason in this row) at m7's own ABSORB — the first proof required by charter Done-when clause 4. **Not resolved by this iteration** — iteration-0 only flags/prepares this row; the actual consolidate-or-carry-forward decision is the outer orchestrator's job at ABSORB time, after this report. |
+| repo-root isolation-leak lesson | m3 (M03-abi-eval) | 1 (m3 only — no second cross-domain confirmation yet) | proposed — noted, never applied |
+
+## Definitions
+... (full file, see repo)
```
(Full new-file contents in the worktree at `experiments/quay-perpetual-stream/v-meta-ledger.md`;
truncated above for report length — `git show` in the worktree gives the exact committed bytes.)

### Item 2 — Health track + alarm

Added a `V_meta consolidation lag` row to `dashboard.md`'s health tracks table, symmetric to the
existing `discovery latency` row, with the K=2 threshold written explicitly in the alarm column.

Diff:
```diff
--- a/experiments/quay-perpetual-stream/dashboard.md
+++ b/experiments/quay-perpetual-stream/dashboard.md
@@ -126,6 +126,7 @@ iteration-0's arithmetic slip of 95.83 during iteration-1's independent re-verif
 | discovery latency (mechanizable) | **0** (m1-m5 all — m5's PR-004/PR-005 gap-list findings were logged same-iteration as found, not deferred; PR-005 specifically was iteration-1 catching a bug iteration-0 introduced and shipped in the SAME milestone, zero-latency self-correction) | >~8 iters late |
 | calibration error \|Δv−Δv̂\|/Δv̂ | **0%** (m1); m2/m5 no VT Δv̂ (methodology-infra, by design); m3 Δv̂ "≈0 direct" (re-baseline); m4 re-score, no formal Δv̂ (discovery-value framing) | trend must shrink |
 | inner-convergence success | **5/5** (m1-m5 each: 2 iterations, Done-when-complete, no mid-milestone re-scope — m5's iteration-1 found and fixed a real bug [`--labels`/`--label` CLI typo] but this counts as convergence-with-correction, not re-scope: same charter, same Done-when, no scope change) | mid-milestone re-scope = fail |
+| V_meta consolidation lag | **1 row past threshold, 3 milestones since confirmed** — `v-meta-ledger.md`'s `CI-job≡audit-channel` row is `confirmed` (φ threshold crossed: m1 packaging + m3 cross-provider, 2 cross-domain confirmations) but not `consolidated`; confirmed at m3, m4/m5/m6 have since completed ABSORB = 3 milestones-since-confirmed, already **exceeding the alarm** by the time m7's own ABSORB runs. The other 2 ledger rows (m1's un-confirmed instance, m3's isolation-leak lesson) are `proposed`, not yet past threshold, not counted against this track. Symmetric to the discovery-latency track above: measures milestones-since-confirmed for any ledger row past the φ 2-confirmation threshold but not yet `consolidated`. | **>2 milestones (K=2)** since confirmed-but-not-consolidated |
```

### Item 3 — ABSORB gate

Edited `OUTER-LOOP.md`'s ABSORB step (step 6) to add the hard block, and updated step 7 (UPDATE
DASHBOARD) to include the new track in the update list.

Diff:
```diff
--- a/experiments/quay-perpetual-stream/OUTER-LOOP.md
+++ b/experiments/quay-perpetual-stream/OUTER-LOOP.md
@@ -117,8 +117,19 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
    adaptations to the log; check φ — if a prior adaptation was just reused unchanged by THIS
    (different-domain) milestone, **CONSOLIDATE**: merge it into `inherited-core.md` and retire the
    citation (§4.2).
+   - **V_meta consolidation-lag gate (DIR-005 / M07-vmeta-gate, hard block):** before this milestone
+     may be marked DONE / `milestone_counter` incremented, check `v-meta-ledger.md` for any row whose
+     status is `confirmed` (past the φ 2-cross-domain-confirmation threshold) but not yet
+     `consolidated`, AND whose milestones-since-confirmed exceeds the `dashboard.md` `V_meta
+     consolidation lag` health track's alarm (**K=2**). If any such row exists, this ABSORB may NOT
+     complete until it is resolved by EITHER (a) consolidating the row's pattern into
+     `inherited-core.md` at this ABSORB (pasted diff) OR (b) recording an explicit DATED
+     carry-forward reason directly in the ledger row (no silent deferral — a missing/blank
+     disposition is not a valid resolution). Update the row's status/notes in `v-meta-ledger.md`
+     accordingly as part of this ABSORB step.
 7. **UPDATE DASHBOARD** — VT, slope (marginal Δv), ρ, charter-thickness, discovery-latency,
-   calibration-error, milestone_counter++.
+   calibration-error, `V_meta consolidation lag` (re-derive milestones-since-confirmed for every
+   ledger row per `v-meta-ledger.md`), milestone_counter++.
 8. **CHECKPOINT (non-blocking)** if `milestone_counter % 5 == 0`: write `checkpoints/cp-<NN>.md` — a
```

### Item 4 — first proof readiness

Per the task instructions, iteration-0 does NOT perform the consolidate-or-carry-forward decision
itself — that is the outer orchestrator's job at m7's own ABSORB, after this report. This
iteration's job is to leave ledger row (b) unambiguously ready for that decision. Confirmed ready:
- Row (b) in `v-meta-ledger.md` explicitly states its status is `confirmed`, explicitly states it is
  **past the K=2 alarm threshold as of m6-complete**, explicitly names the required resolution
  (`consolidate into inherited-core.md` OR `record a new dated carry-forward reason`), and explicitly
  states this must happen "at m7's own ABSORB" — the very next ABSORB after this iteration.
- `OUTER-LOOP.md`'s new ABSORB gate (item 3 above) mechanically points at this exact row: any
  `confirmed`-and-past-threshold ledger row blocks milestone-DONE until resolved.
- `dashboard.md`'s new health track (item 2 above) independently corroborates the same
  past-threshold state (3 milestones since confirmed > K=2).
All three artifacts agree and cross-reference each other, so the m7 ABSORB step has an unambiguous,
already-flagged case to resolve — satisfying charter Done-when clause 4's requirement that iteration-0
leave this row "in a state that makes this decision unambiguous and ready."

### Item 5 — non-goal confirmed NOT done

No exploration/reflection iteration was added to the inner loop. The 2-iteration build+verify
template itself (`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`'s HARD GATES block,
this milestone's own charter's §3.2 five termination conditions, `OUTER-LOOP.md` step 5's dispatch
procedure) was not touched by this iteration's edits — only the ABSORB step (step 6/7) and the new
sibling ledger file were edited/created. Confirmed via the diffs above: no edits appear anywhere in
`ITERATION-PROMPTS.md`, no edits to charter step counts, no new "reflection" or "exploration" step
added to `OUTER-LOOP.md`'s inner-dispatch step 5.

## §4. Test suite

No code was touched this iteration — only `.md` files (`v-meta-ledger.md` new,
`dashboard.md`/`OUTER-LOOP.md` edited). Per charter Done-when clause 5 and the task's Done-when
checklist item 5: **no test run required, and none was run.** Confirmed by `git status --short`
below: all changed/added paths end in `.md`.

## §5. Done-when checklist (charter, verbatim)

1. `[x]` The V_meta insight ledger exists with the 3 known outstanding items migrated in (status
   fields populated) — pasted diff above (§3 item 1).
2. `[x]` `dashboard.md` gains a `V_meta consolidation lag` health track with the K=2 threshold
   written explicitly — pasted diff above (§3 item 2).
3. `[x]` `OUTER-LOOP.md`'s ABSORB step contains the gate, referencing the ledger and the track —
   pasted diff above (§3 item 3).
4. `[x]` First proof: ledger row (b) (`CI-job≡audit-channel`) is left clearly flagged/ready for the
   m7 ABSORB's consolidate-or-carry-forward decision — see §3 item 4. **The actual
   consolidate-or-carry-forward decision itself is explicitly NOT performed in this iteration**, per
   the task instructions ("that's the outer orchestrator's job at ABSORB time, AFTER your report") —
   this is a deliberate partial-completion of clause 4 by design, not an oversight. Full clause 4
   completion (the actual consolidation-or-carry-forward act) happens at m7's own ABSORB, outside
   this iteration's scope.
5. `[x]` No code touched ⇒ no test run required — stated explicitly above (§4).

## §6. End-of-iteration isolation proof

Worktree (`experiments/quay-perpetual-stream/milestones/M07-vmeta-gate/worktrees/iteration-0`),
captured pre-commit:
```
$ git status --short
 M experiments/quay-perpetual-stream/OUTER-LOOP.md
 M experiments/quay-perpetual-stream/dashboard.md
?? experiments/quay-perpetual-stream/v-meta-ledger.md
?? experiments/quay-perpetual-stream/milestones/M07-vmeta-gate/iterations/iteration-0.md
```
Post-commit (final state):
```
$ git status --short
(clean — no output)
```

Shared repo root (`/home/yale/work/quay`), captured after the worktree commit:
```
$ git status --short
?? docs/proposals/exp5-concurrent-background-agents-for-milestone-iteration.md
```
This single untracked file is pre-existing (timestamp predates this iteration's work, unrelated
docs/proposals content, nothing under `experiments/quay-perpetual-stream/` paths) — it is NOT a
product of this iteration's edits. Nothing under `experiments/quay-perpetual-stream/` is dirty at
the shared root, confirming isolation: all of this iteration's changes landed only in the worktree.

## §7. Commit

Committed inside the worktree on branch `exp5-m07-iteration-0`:
```
$ git log -3 --oneline
faeb698 M07-vmeta-gate iteration-0: V_meta ledger + consolidation-lag health track + ABSORB gate
d2ec46f exp5 outer loop: drain DIR-005, SELECT m7 = M-VMETA-GATE, value-typed ledger first fully in-force use
cbc5d9d exp5 outer loop: absorb m6 (M-SIZING DONE) — iteration-1 caught self-exemption error, standing lesson recorded
```
Commit `faeb698`, 4 files changed (2 modified: `dashboard.md`, `OUTER-LOOP.md`; 2 added:
`v-meta-ledger.md`, this report), 313 insertions / 1 deletion.

## §8. Reflection / notes for iteration-1

- Item 4's "ready, not resolved" framing is deliberate per task instructions; iteration-1 (or the
  outer orchestrator's ABSORB) should independently re-verify that ledger row (b) is still
  unambiguous before acting on it (re-read `v-meta-ledger.md` fresh, don't trust this report's prose
  alone — consistent with `inherited-core.md`'s verify-iteration size gauge, which expects
  iteration-1 to re-derive rather than trust iteration-0's claims).
- One naming subtlety worth flagging for iteration-1's re-verification: the ledger's rows (a) and (b)
  describe closely related but formally distinct ledger entries for the "same pattern" at different
  confirmation-count states, per the charter's own item 1 wording ("(a) ... (b) same pattern, but
  CONFIRMED"). This iteration kept them as two separate rows (matching the charter's own enumeration)
  rather than collapsing them into one row with a single evolving confirmation count — worth
  iteration-1 double-checking this interpretation matches the charter's and DIR-005's intent, since
  collapsing to one row would also have been a defensible reading.
