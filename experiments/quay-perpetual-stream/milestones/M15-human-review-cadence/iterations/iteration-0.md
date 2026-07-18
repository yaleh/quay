# M15-human-review-cadence — iteration-0

**Worktree:** `experiments/quay-perpetual-stream/milestones/M15-human-review-cadence/worktrees/iteration-0`
**Branch:** `exp5-m15-iteration-0`
**Commit:** `cc145ec` — "M15-human-review-cadence iteration-0: institutionalize human-review channel as a health track"
**Status:** All 7 binary Done-when clauses met. Working tree clean.

## §1 Scope

Per charter `charters/M15-human-review-cadence.md`: tally the 11 archived directives as the
generalization evidence base for DIR-001 item 6; add a "Human-review cadence" health track to
`dashboard.md`; add a matching rule section to `inherited-core.md`; make a precise edit to
`OUTER-LOOP.md` step 8's CHECKPOINT bullet only; write `checkpoints/cp-15.md` as live proof at this
milestone's own ABSORB (milestone_counter 14→15, a checkpoint boundary); update `backlog.md`'s
`M-HUMAN-REVIEW-CADENCE` row to DONE. No product code touched. No blocking mechanism introduced.

## §2 HARD GATES — literal pasted output

**Pending directives (expected empty):**
```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
```
(no output — directory is empty; confirmed disposition of all 11 archived directives is unaffected,
nothing new to disposition this iteration)

**Worktree/branch confirmation:**
```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M15-human-review-cadence/worktrees/iteration-0

$ git branch --show-current
exp5-m15-iteration-0
```

**No cwd-drift / no duplicate write into the shared main-repo path** — verified by checking the
main-repo checkout's own `checkpoints/` directory contains no `cp-15.md` (it was created only inside
the worktree, then committed there):
```
$ ls experiments/quay-perpetual-stream/checkpoints/     # run from /home/yale/work/quay (main repo)
cp-01.md
cp-02.md
```
(cp-15.md is NOT present in the main repo — confirms all writes stayed inside the worktree; it will
appear in the main tree only once the outer loop performs its own merge, which is out of scope for
this inner iteration.)

## §3 Done-when clause 1 — tally of all 11 directives

Read all 11 files under `directives/archive/DIR-001*.md` through `DIR-011*.md` in full (headers +
Finding + Resolution sections). Arrival boundary determined by cross-referencing each directive's
own header against `dashboard.md`'s Log section entries (grep for `DIR-NNN` mentions + drain/SELECT
log lines).

| DIR | arrival boundary | initiation mode | finding kind |
|---|---|---|---|
| 001 | pre-m3 SELECT (before m3 dispatch) | human, mid-conversation | structural blind-spot (VT value function blind to Provider-ABI surface) |
| 002 | pre-m5 SELECT (after cp-01, before m5) | human, mid-conversation | drift/rollback-failure (exp4 directives-as-tasks carry-forward regression) |
| 003 | during m5 (self-raised by iteration-0, charter-sanctioned dogfood) | self-raised (NOT human) | dogfood confirmation finding |
| 004 | pre-m6 SELECT (after cp-01, before m6) | human, mid-conversation | scope/process gap (milestone sizing + value-typed SELECT) |
| 005 | m6→m7 boundary | human, mid-conversation | structural blind-spot (V_meta absorption never tracked) |
| 006 | mid-m9 (live arrival, logged mid-milestone, drained at m9→m10 boundary) | human, mid-conversation | drift detected (Web UI browser-verification regression) |
| 007 | mid-m9, same burst as 006 | human, mid-conversation | routing/process gap (G3 adversarial-audit role silently dropped) |
| 008 | mid-m9, same burst as 006/007 | human, mid-conversation | drift detected (σ-inherited-floor consolidation debt + citation drift) |
| 009 | m12→m13 boundary (burst, routed design-doc-only) | human, mid-conversation | scope split (task-board self-hosting / backlog-primitive projection design) |
| 010 | m12→m13 boundary, same burst as 009 | human, mid-conversation | drift detected (directive-projection mechanism: id-collision + boundary-only reconcile gaps) |
| 011 | m12→m13 boundary, same burst as 009/010 | human, mid-conversation | scope split (CLI edit-surface parity + portable-metadata rule) |

**Summary:** 10 of 11 directives (all except self-raised DIR-003) are human-initiated —
confirms DIR-001's original claim ("every structural discovery came from the human-directive
channel") held up under the larger sample, not just the founding single instance. Arrivals cluster
in **bursts at milestone boundaries** (DIR-006/007/008 together mid-m9; DIR-009/010/011 together at
the m12→m13 boundary) rather than a steady one-per-milestone rate — this is why the new health track
measures elapsed milestones since the last arrival, not a per-milestone frequency.

## §4 Done-when clause 2 — dashboard.md diff

```diff
--- a/experiments/quay-perpetual-stream/dashboard.md
+++ b/experiments/quay-perpetual-stream/dashboard.md
@@ -322,6 +322,7 @@
 | calibration error \|Δv−Δv̂\|/Δv̂ | **0%** (m1); m2/m5 no VT Δv̂ (methodology-infra, by design); m3 Δv̂ "≈0 direct" (re-baseline); m4 re-score, no formal Δv̂ (discovery-value framing) | trend must shrink |
 | inner-convergence success | **5/5** (m1-m5 each: 2 iterations, Done-when-complete, no mid-milestone re-scope — m5's iteration-1 found and fixed a real bug [`--labels`/`--label` CLI typo] but this counts as convergence-with-correction, not re-scope: same charter, same Done-when, no scope change) | mid-milestone re-scope = fail |
 | V_meta consolidation lag | **0 rows past threshold-and-unresolved as of m7-complete.** ... | **>2 milestones (K=2)** since confirmed-but-not-consolidated |
+| Human-review cadence (M15-human-review-cadence, DIR-001 item 6) | **milestones-since-last-human-directive = 3** (as of m15 ABSORB, milestone_counter→15). Last human-initiated directive was DIR-011, arriving at the m12→m13 boundary in the same burst as DIR-009/DIR-010 (this dashboard's own `directives/pending/` log: all three dispositioned at the "DRAIN (m12→m13 boundary)" entry, `pending/` re-drained empty at every boundary since — m13→m14, m14→m15, and m15's own SELECT). Count = milestone_counter(15) − arrival milestone(12) = 3. Recomputed at each ABSORB purely from the drain evidence step 0 already produces — no new instrumentation. Full generalization tally of all 11 directives (arrival boundary / initiation mode / finding kind) recorded in `milestones/M15-human-review-cadence/iterations/iteration-0.md`. **Explicitly NON-BLOCKING** — observational only, logged at each checkpoint (`OUTER-LOOP.md` step 8); carries no HARD BLOCK language anywhere it appears and must never gate `milestone_counter++`, unlike the V_meta consolidation-lag gate above (deliberate contrast — directives are asynchronous/human-paced by nature, not a mechanically resolvable backlog item). | **soft-alarm only, K=5** milestones since last human directive (recommend a human skim `checkpoints/cp-<NN>.md`; never blocks the loop) |
```

Real computed value: **3** (milestone_counter 15 − arrival milestone 12, DIR-011 being the last
human-initiated directive, arrived before m13). K=5 threshold stated, matching the tally.

## §5 Done-when clause 3 — inherited-core.md diff

Full new section appended at end of file (52 inserted lines), in the same style as the file's other
consolidated sections (e.g. "Adversarial-audit cadence rule", "manda-dispatch discipline"). Full
diff:

```diff
--- a/experiments/quay-perpetual-stream/inherited-core.md
+++ b/experiments/quay-perpetual-stream/inherited-core.md
@@ -536,3 +536,55 @@
 consolidated answer; no future milestone should need to re-open the archived DIR-0NN files directly
 unless this section itself is found insufficient (in which case, expand THIS section, don't leave
 the gap for the next drafter to re-discover).
+
+## Human-review cadence (M15-human-review-cadence, DIR-001 item 6)
+
+Generalizes DIR-001 item 6's original finding ... into a citable standing rule, using the real
+11-directive sample that now exists (DIR-001 through DIR-011, all archived under
+`directives/archive/`) instead of the speculative "once ≥2 more DIR-* instances exist" placeholder
+DIR-001 itself shipped with.
+
+**Evidence — real tally of all 11 directives** (arrival boundary / initiation mode / finding kind;
+full per-directive detail in `milestones/M15-human-review-cadence/iterations/iteration-0.md`):
+
+| DIR | arrival boundary | initiation mode | finding kind |
+|---|---|---|---|
+| 001 | pre-m3 SELECT | human, mid-conversation | structural blind-spot (VT value function) |
+...
+| 011 | m12→m13 boundary, same burst as 009/010 | human, routed design-doc-only | scope split (CLI edit surface parity) |
+
+**10 of 11 (all but DIR-003) are human-initiated**, confirming DIR-001's original claim held up
+under the larger sample, not just the single founding instance. Arrivals cluster in **bursts at
+milestone boundaries** ... rather than one-per-milestone steadily — the cadence track below measures
+elapsed milestones since the last arrival, not a per-milestone rate, precisely because of this bursty
+pattern.
+
+**The rule:**
+1. **Track `milestones-since-last-human-directive`** as a `dashboard.md` health track ...
+   recomputed at each ABSORB from the same `directives/pending/`/`directives/archive/` drain
+   evidence step 0 of the outer loop already produces — no separate instrumentation.
+2. **Soft-alarm threshold K=5** — reusing the existing checkpoint cadence ...
+3. **Explicitly NON-BLOCKING.** Unlike the V_meta consolidation-lag gate (DIR-005/M07-vmeta-gate),
+   which IS a HARD BLOCK on `milestone_counter++` ... this track carries no blocking language
+   anywhere and must never gate advancement. ... The one concrete behavior this rule induces in the
+   outer loop is visibility, not gating: at each checkpoint (`milestone_counter % 5 == 0`), the
+   `checkpoints/cp-<NN>.md` snapshot must include this track's current value ...
```
(Full untruncated text is committed in the worktree at `inherited-core.md` lines 546-597; the diff
above elides the repeated 11-row tally table already shown in full in §3 above to avoid duplication.)

States explicitly: the K=5 threshold, the non-blocking nature (contrasted directly against the
V_meta consolidation-lag gate's HARD BLOCK), and the one concrete outer-loop behavior induced
(checkpoint snapshots must include the current value).

## §6 Done-when clause 4 — OUTER-LOOP.md step 8 before/after

**Before:**
```
8. **CHECKPOINT (non-blocking)** if `milestone_counter % 5 == 0`: write `checkpoints/cp-<NN>.md` — a
   health snapshot across all tracks + a re-test of the standing hypothesis (§1). **Do NOT wait for a
   human.** After writing it, CONTINUE to the next milestone. The human reviews snapshots
   asynchronously.
```

**After:**
```
8. **CHECKPOINT (non-blocking)** if `milestone_counter % 5 == 0`: write `checkpoints/cp-<NN>.md` — a
   health snapshot across all tracks (including `dashboard.md`'s "Human-review cadence" track's
   current `milestones-since-last-human-directive` value, per `inherited-core.md`'s Human-review
   cadence rule) + a re-test of the standing hypothesis (§1). **Do NOT wait for a human.** After
   writing it, CONTINUE to the next milestone. The human reviews snapshots asynchronously.
```

Literal diff (`git diff ed3d94bf HEAD -- experiments/quay-perpetual-stream/OUTER-LOOP.md`):
```diff
@@ -156,9 +156,10 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
    calibration-error, `V_meta consolidation lag` (re-derive milestones-since-confirmed for every
    ledger row per `v-meta-ledger.md`), milestone_counter++ (only after the gate above clears).
 8. **CHECKPOINT (non-blocking)** if `milestone_counter % 5 == 0`: write `checkpoints/cp-<NN>.md` — a
-   health snapshot across all tracks + a re-test of the standing hypothesis (§1). **Do NOT wait for a
-   human.** After writing it, CONTINUE to the next milestone. The human reviews snapshots
-   asynchronously.
+   health snapshot across all tracks (including `dashboard.md`'s "Human-review cadence" track's
+   current `milestones-since-last-human-directive` value, per `inherited-core.md`'s Human-review
+   cadence rule) + a re-test of the standing hypothesis (§1). **Do NOT wait for a human.** After
+   writing it, CONTINUE to the next milestone. The human reviews snapshots asynchronously.
```
Only the step 8 hunk is touched — no other step (confirmed by the diff stat below: exactly 1 hunk in
this file).

## §7 Done-when clause 5 — LIVE proof: checkpoints/cp-15.md

Written at `experiments/quay-perpetual-stream/checkpoints/cp-15.md` (95 lines), inside the worktree,
committed in `cc145ec`. It follows the cp-01/cp-02 format (milestones-completed table,
health-tracks section, standing-hypothesis re-test, next candidates) and includes the new track:

> **NEW this checkpoint — Human-review cadence** (M15-human-review-cadence, DIR-001 item 6):
> `milestones-since-last-human-directive = 3` (last human-initiated directive: DIR-011, arrived at
> the m12→m13 boundary; `directives/pending/` re-drained empty at every boundary since — m13→m14,
> m14→m15, m15's own SELECT). Soft-alarm threshold **K=5**, not yet crossed. **Explicitly
> non-blocking**...

Also includes the standard cross-track snapshot: VT (110.65/120, unchanged since m12), ρ (~0.85),
φ fold-back (2 consolidated), charter thickness (~1.8-2.1K band, unchanged), discovery latency (0),
calibration error (m12 exact match, first 0% miss), inner-convergence success (15/15), V_meta
consolidation lag (0 rows past-threshold), and adversarial-audit-role coverage (fired correctly at
m12, correctly no-op at m11/m13/m14/m15).

## §8 Done-when clause 6 — no blocking mechanism confirmation

**Step 0 (DRAIN) re-read, confirmed unchanged:**
```
$ git diff ed3d94bf9f42ea53b38d5c4118e4806239ed702d HEAD -- experiments/quay-perpetual-stream/OUTER-LOOP.md
```
produced exactly one hunk (shown in §6 above), scoped to step 8's CHECKPOINT bullet only. Step 0's
own text (`0. **DRAIN human inbox** — read directives/pending/ ...`) is byte-identical before and
after this milestone — confirmed by the diff producing zero hunks anywhere outside the step-8 range.

**Explicit statement:** the new "Human-review cadence" track, in every place it appears
(`dashboard.md`'s health-tracks table row, `inherited-core.md`'s new section, `OUTER-LOOP.md` step
8's edited bullet, `checkpoints/cp-15.md`), carries no "HARD BLOCK", "MUST NOT execute", or gating
language of any kind — every occurrence explicitly says "non-blocking"/"soft-alarm"/"observational
only". This is a deliberate, stated contrast against the V_meta consolidation-lag gate (DIR-005),
which IS a HARD BLOCK on `milestone_counter++`. No change was made to that existing gate, to step 0
(DRAIN), or to any other blocking mechanism in the loop.

## §9 Done-when clause 7 — backlog.md diff

```diff
--- a/experiments/quay-perpetual-stream/backlog.md
+++ b/experiments/quay-perpetual-stream/backlog.md
@@ -31,7 +31,7 @@
 | M-OUTCOME-EVAL | ... |
 | M-ADVERSARIAL-EVAL | ... |
 | M-COMPETITIVE-BENCH | ... |
-| M-HUMAN-REVIEW-CADENCE | Standing periodic human-led capability review as an explore milestone type (institutionalize the `/quay-directive` channel itself, not just react to it) | method infra | DIR-001 item 6 | explore | method infra, no VT points | Backlogged — offline data (RESULTS.md) shows every structural discovery came from this channel, never the simulated-user; worth a recurring-cadence design once ≥2 more DIR-* instances exist to generalize from. |
+| M-HUMAN-REVIEW-CADENCE | Standing periodic human-led capability review as an explore milestone type (institutionalize the `/quay-directive` channel itself, not just react to it) | method infra | DIR-001 item 6 | explore | method infra, no VT points | **DONE (m15, 2026-07-18)** — real 11-directive tally (DIR-001 through DIR-011) generalizes DIR-001 item 6's finding; `dashboard.md` gained a "Human-review cadence" health track (`milestones-since-last-human-directive`, K=5 soft-alarm, non-blocking — diff in `milestones/M15-human-review-cadence/`); `inherited-core.md` gained a matching "Human-review cadence" section stating the rule + tally + non-blocking contrast with the V_meta consolidation-lag gate; `OUTER-LOOP.md` step 8's CHECKPOINT bullet edited to reference the new track (step 0/DRAIN untouched); live-proven at this exact ABSORB via `checkpoints/cp-15.md` (milestone_counter=15, a checkpoint boundary). See `milestones/M15-human-review-cadence/iterations/iteration-0.md` for full diffs/evidence. |
```

## §10 git diff --stat against pre-charter base

Run from inside the worktree:
```
$ git diff --stat ed3d94bf9f42ea53b38d5c4118e4806239ed702d HEAD
 experiments/quay-perpetual-stream/OUTER-LOOP.md    |  7 +-
 experiments/quay-perpetual-stream/backlog.md       |  2 +-
 .../quay-perpetual-stream/checkpoints/cp-15.md     | 95 ++++++++++++++++++++++
 experiments/quay-perpetual-stream/dashboard.md     |  1 +
 .../quay-perpetual-stream/inherited-core.md        | 52 ++++++++++++
 5 files changed, 153 insertions(+), 4 deletions(-)
```
Confirms exactly the 5 expected files (dashboard.md, inherited-core.md, OUTER-LOOP.md, backlog.md,
new checkpoints/cp-15.md) — **no product code touched**.

## §11 Adversarial-audit gate — explicit adjudication (charter §, not expected to trigger)

Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a
capability-growth-typed milestone with nonzero realized VT Δv — this milestone's value hypothesis
is typed discovery+governance-integrity, Δv̂=0 by design, and this iteration's `git diff --stat`
confirms zero VT-chart-relevant files (`dashboard.md`'s only change is the new health-track row, not
a VT-table cov/weight edit) — condition (a) does NOT fire. Condition (b) requires iteration-0 to
recommend skipping iteration-1 — this report makes NO such recommendation; iteration-1 has real
independent-re-derivation material (the 11-directive tally, the K-threshold reasoning, and whether
any track wording anywhere accidentally implies blocking behavior are all independently checkable).
**Neither condition fires — the adversarial-audit dispatch is correctly NOT required for this
milestone**, consistent with the charter's own pre-analysis.

## §12 Domain-misfit audit-channel — explicit statement (it0 check d)

This milestone edited three markdown method-infra files (`dashboard.md`, `inherited-core.md`,
`OUTER-LOOP.md`) plus `backlog.md` and a new checkpoint file, with no live external system and no
product code — consistent with M-SIZING/M-VMETA-GATE/M13/M14's own doc/method-infra-only precedent.
Recorded explicitly per the charter's own instruction, rather than forcing a mismatched
audit-channel citation.

## §13 Commit and working-tree state

```
$ git log --oneline -1
cc145ec M15-human-review-cadence iteration-0: institutionalize human-review channel as a health track

$ git status --short
(empty — clean)
```

All work committed on branch `exp5-m15-iteration-0` inside the worktree at
`experiments/quay-perpetual-stream/milestones/M15-human-review-cadence/worktrees/iteration-0`. This
report (`iteration-0.md`) was written directly via file tools to the shared main tree path
`experiments/quay-perpetual-stream/milestones/M15-human-review-cadence/iterations/iteration-0.md`,
outside the worktree, per instruction — not committed from inside the worktree.
