# M15-human-review-cadence — iteration-1 (independent re-derivation)

**Worktree:** `experiments/quay-perpetual-stream/milestones/M15-human-review-cadence/worktrees/iteration-1`
**Branch:** `exp5-m15-iteration-1`
**Base commit:** `ed3d94bf9f42ea53b38d5c4118e4806239ed702d` (pre-charter SELECT commit)
**Commit produced:** `ffdee07`

This iteration was dispatched as an INDEPENDENT re-derivation — iteration-0's report, materials,
and worktree were explicitly NOT read. Everything below (the 11-directive tally, the health-track
wording, the checkpoint file) was derived fresh from the Tier-A charter, `inherited-core.md`,
`dashboard.md`, `OUTER-LOOP.md`, `backlog.md`, and the 11 archived directive files themselves.

---

## §1. Charter scope read

Charter: `experiments/quay-perpetual-stream/charters/M15-human-review-cadence.md`. 5 in-scope
items, 7 binary Done-when clauses, zero-VT method-infra/discovery+governance-integrity milestone.
Scope: edit only `dashboard.md`, `inherited-core.md`, `OUTER-LOOP.md` (step 8's CHECKPOINT bullet
only), plus write `checkpoints/cp-15.md` at ABSORB and update `backlog.md`'s
`M-HUMAN-REVIEW-CADENCE` row. No product code in scope.

## §2. HARD GATES — literal output

**Gate 1 — pending directives listing:**

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
```
```
(no output — directory is empty)
```
`EXIT:0`. No files present — nothing to disposition. Confirmed empty per the charter's expectation.

**Gate 2 — worktree/branch confirmation:**

```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M15-human-review-cadence/worktrees/iteration-1
$ git branch --show-current
exp5-m15-iteration-1
```

Confirmed: operating inside the correct worktree, on branch `exp5-m15-iteration-1`.

**cwd-drift check (no leaked writes into the shared main-repo path):** ran, from the shared
main-repo working directory (`/home/yale/work/quay`), the same `git status --porcelain` probe
against the 5 touched relative paths — clean (no untracked/modified copies leaked outside the
worktree):

```
$ git status --porcelain -- experiments/quay-perpetual-stream/dashboard.md experiments/quay-perpetual-stream/inherited-core.md experiments/quay-perpetual-stream/OUTER-LOOP.md experiments/quay-perpetual-stream/backlog.md experiments/quay-perpetual-stream/checkpoints/
(no output)
```

## §3. Tally of all 11 `directives/archive/DIR-*.md` (Done-when clause 1)

Read all 11 files in full (`directives/archive/DIR-001*.md` through `DIR-011*.md`). Arrival
boundaries cross-checked against `dashboard.md`'s own drain-step log entries (grepped for
`DIR-00[1-9]`, `DRAIN`, and each directive's own `created_at`/`status` header lines).

| DIR | Arrival boundary (milestone-count gap) | Initiation mode | Finding kind |
|---|---|---|---|
| DIR-001 | pre-m3 dispatch (m2→m3 boundary — dashboard.md line "DIR-001 drain (2026-07-18, before m3 dispatch)") | human, mid-conversation | structural blind-spot (VT surface set blind to Provider-ABI/GitHub) |
| DIR-002 | mid-m4 (arrived during M04-discover; drained at the m4→m5 boundary — dashboard.md "Mid-milestone directive drain ... during M04-discover") | human, mid-conversation | drift detected (exp4's DIR-006 "files-canonical" resolution was a rationalized transition failure, not a settled decision) |
| DIR-003 | mid-m5 (during M05-dir-projection's own iteration-0) | **self-raised** (iteration-0, per M05's charter item 5's sanctioned live-dogfood requirement — header: `created_by: iteration-0 (self-raised, M05-dir-projection milestone...)`) | routing/dogfood demonstration artifact — a deliberately-produced proof object, not a finding in the same sense as the other 10 |
| DIR-004 | m5→m6 boundary (dashboard.md "DRAIN + SELECT m6 = M-SIZING" entry; originally numbered DIR-003, renumbered to DIR-004 to resolve a collision with the already-archived self-raised DIR-003) | human, mid-conversation | drift detected (2-iteration sizing is a cost-proxy artifact) + routing decision (value-typed SELECT ledger) |
| DIR-005 | m6→m7 boundary (dashboard.md "DRAIN + SELECT m7 = M-VMETA-GATE ... Drained directives/pending/: only DIR-005 present") | human, mid-conversation | structural blind-spot (V_meta consolidation lag invisible to every existing health track) |
| DIR-006 | mid-m9 (dashboard.md "DIR-006 arrived mid-m9"; drained together with DIR-007/DIR-008 in the m9→m10 burst) | human, mid-conversation | drift detected (Web UI verification narrated as "real browser" but only `curl` evidence pasted) |
| DIR-007 | mid-m9 (dashboard.md: "arrived via the same external `/quay-directive` channel shortly after DIR-006" — same burst as DIR-006) | human, mid-conversation | structural blind-spot (G3 adversarial-audit role silently weakened into same-template independent re-run) |
| DIR-008 | mid-m9 (dashboard.md: "arrived the same way" — same burst as DIR-006/007) | human, mid-conversation | drift detected (σ-inherited-floor trap never consolidated despite being pre-named at kickoff commit) |
| DIR-009 | m12→m13 boundary (dashboard.md "DRAIN (m12→m13 boundary) ... directives/pending/ held DIR-009, DIR-010, DIR-011") | human, mid-conversation | scope split / routing decision (exp5's own non-directive work invisible in the task store) |
| DIR-010 | m12→m13 boundary (same 3-directive burst as DIR-009/011) | human, mid-conversation | drift detected (directive-projection cross-experiment task-id collision + boundary-only reconcile gap) |
| DIR-011 | m12→m13 boundary (same burst) | human, mid-conversation | routing decision / scope split (Core CLI edit-surface relaxation + portable-metadata rule design) |

**Summary:** 10/11 human-initiated mid-conversation, 1/11 self-raised (DIR-003). Arrivals cluster
in bursts at milestone boundaries rather than trickling steadily: 5 single-directive arrivals
(m2→m3, m4→m5, mid-m5 self-raised, m5→m6, m6→m7) and 2 three-directive bursts (m9→m10, m12→m13).
Largest observed gap between human-directive bursts in this history: 3 milestones (m6→m7 to
m9→m10). As of m14-complete/m15-dispatch, the gap since the last human-directive burst (m12→m13)
is **2 milestones** (14−12=2).

This matches the tally embedded in both `inherited-core.md`'s new section and `dashboard.md`'s new
health-track cell — see §4/§5 pasted diffs below.

## §4. Done-when clause 2 — `dashboard.md` diff

```diff
diff --git a/experiments/quay-perpetual-stream/dashboard.md b/experiments/quay-perpetual-stream/dashboard.md
index c442b41..dffdff5 100644
--- a/experiments/quay-perpetual-stream/dashboard.md
+++ b/experiments/quay-perpetual-stream/dashboard.md
@@ -322,6 +322,7 @@ its three findings were fixed/recorded as part of this same ABSORB pass rather t
 | calibration error \|Δv−Δv̂\|/Δv̂ | **0%** (m1); m2/m5 no VT Δv̂ (methodology-infra, by design); m3 Δv̂ "≈0 direct" (re-baseline); m4 re-score, no formal Δv̂ (discovery-value framing) | trend must shrink |
 | inner-convergence success | **5/5** (m1-m5 each: 2 iterations, Done-when-complete, no mid-milestone re-scope — m5's iteration-1 found and fixed a real bug [`--labels`/`--label` CLI typo] but this counts as convergence-with-correction, not re-scope: same charter, same Done-when, no scope change) | mid-milestone re-scope = fail |
 | V_meta consolidation lag | **0 rows past threshold-and-unresolved as of m7-complete.** ... | **>2 milestones (K=2)** since confirmed-but-not-consolidated |
+| Human-review cadence (M15-human-review-cadence, DIR-001 item 6) | **milestones-since-last-human-directive = 2** (as of m14-complete/m15-dispatch: the last human-initiated directive burst — DIR-009/010/011 — arrived at the m12→m13 boundary, before m13 was dispatched; m13 and m14 both completed with zero new arrivals in `directives/pending/` at their own drain steps, so 14−12=2). Full tally (all 11 `directives/archive/DIR-*.md`, see `inherited-core.md`'s "Human-review cadence" section for the source table): 10/11 human-initiated mid-conversation, 1/11 self-raised by an inner iteration (DIR-003, a sanctioned live-dogfood artifact, not a finding). Arrivals cluster in bursts at milestone boundaries (m2→m3 ×1, m4→m5 ×1, mid-m5 ×1 self-raised, m5→m6 ×1, m6→m7 ×1, m9→m10 ×3, m12→m13 ×3) rather than a steady per-milestone trickle — recompute this cell at every ABSORB from the drain-step log. **Explicitly non-blocking** — observational only, logged at each checkpoint (`OUTER-LOOP.md` step 8); never a HARD BLOCK on `milestone_counter++`, unlike the V_meta consolidation-lag gate directly above (directives are asynchronous/human-paced by nature, not a mechanically resolvable backlog item — see `inherited-core.md`'s "Human-review cadence" section for the full non-blocking rationale). | **soft alarm K=5** milestones since last human directive (non-blocking; reuses the checkpoint cadence's own K so the two tracks share one mental model) |
 
 ## Control limits (pre-declared; §6/§6.1)
 - inner budget = 10 (past → default HALT, continue needs authorization)
```

Real computed `milestones-since-last-human-directive` value = **2**, matching the §3 tally. Stated
K=5 soft-alarm threshold. Placed directly beneath the existing "V_meta consolidation lag" row, same
table, same style (§ column shape: track / current / alarm).

## §5. Done-when clause 3 — `inherited-core.md` diff

```diff
diff --git a/experiments/quay-perpetual-stream/inherited-core.md b/experiments/quay-perpetual-stream/inherited-core.md
index f3f3770..92e75a6 100644
--- a/experiments/quay-perpetual-stream/inherited-core.md
+++ b/experiments/quay-perpetual-stream/inherited-core.md
@@ -542,3 +542,62 @@ re-deriving the rule live. This is now the correct single place to check — thi
 consolidated answer; no future milestone should need to re-open the archived DIR-0NN files directly
 unless this section itself is found insufficient (in which case, expand THIS section, don't leave
 the gap for the next drafter to re-discover).
+
+## Human-review cadence — standing rule (M15-human-review-cadence, DIR-001 item 6)
+
+DIR-001 item 6 backlogged this as "worth a recurring-cadence design once ≥2 more DIR-* instances
+exist to generalize from." That condition is now met: DIR-002 through DIR-011 (10 further
+instances) have landed since DIR-001 was filed, giving an 11-directive real sample to generalize
+from, not a speculative one.
+
+**The real tally (all 11 `directives/archive/DIR-*.md`, read in full at M15's authoring):**
+
+| DIR | Arrival boundary (milestone-count gap) | Initiation mode | Finding kind |
+|---|---|---|---|
+| DIR-001 | pre-m3 dispatch (m2→m3 boundary) | human, mid-conversation | structural blind-spot (VT surface set blind to Provider-ABI/GitHub) |
+| DIR-002 | mid-m4 (during M04-discover; drained at the m4→m5 boundary) | human, mid-conversation | drift detected (exp4's DIR-006 "files-canonical" resolution was a rationalized transition failure, not a settled decision) |
+| DIR-003 | mid-m5 (during M05-dir-projection's own iteration-0) | **self-raised** (iteration-0, per M05's charter item 5's sanctioned live-dogfood requirement) | routing/dogfood demonstration artifact — not a finding in the same sense as the other 10, a deliberately-produced proof object |
+| DIR-004 | m5→m6 boundary | human, mid-conversation | drift detected (2-iteration sizing is a cost-proxy artifact) + routing decision (value-typed SELECT ledger) |
+| DIR-005 | m6→m7 boundary | human, mid-conversation | structural blind-spot (V_meta consolidation lag invisible to every existing health track) |
+| DIR-006 | mid-m9 (arrived during M09-gh-write; drained in the m9→m10 burst with DIR-007/008) | human, mid-conversation | drift detected (Web UI verification narrated as "real browser" but only `curl` evidence pasted) |
+| DIR-007 | mid-m9 (same burst as DIR-006) | human, mid-conversation | structural blind-spot (G3 adversarial-audit role silently weakened into same-template re-run) |
+| DIR-008 | mid-m9 (same burst as DIR-006/007) | human, mid-conversation | drift detected (σ-inherited-floor trap never consolidated despite being pre-named at kickoff) |
+| DIR-009 | m12→m13 boundary (arrived in a 3-directive burst with DIR-010/011) | human, mid-conversation | scope split / routing decision (exp5's own non-directive work invisible in the task store) |
+| DIR-010 | m12→m13 boundary (same burst) | human, mid-conversation | drift detected (directive-projection cross-experiment task-id collision + boundary-only reconcile gap) |
+| DIR-011 | m12→m13 boundary (same burst) | human, mid-conversation | routing decision / scope split (Core CLI edit-surface relaxation + portable-metadata rule design) |
+
+**Summary statistics from the tally:** 10 of 11 directives are human-initiated mid-conversation
+(the async `/quay-directive` channel, per `OUTER-LOOP.md`'s "Human async control surface"); exactly
+1 (DIR-003) is self-raised by an inner iteration under an explicit charter sanction, not a
+human-review-channel instance in the same sense. Arrivals are NOT a steady per-milestone trickle —
+they cluster in bursts at milestone boundaries: 5 single-directive arrivals (m2→m3, m4→m5, mid-m5
+self-raised, m5→m6, m6→m7) and 2 three-directive bursts (m9→m10, m12→m13). The largest observed
+gap between human-directive bursts in this tally is 3 milestones (m6→m7 to m9→m10); the current
+gap as of m14-complete (going into m15) is 2 milestones (m12→m13's burst to m14).
+
+**The rule, stated operationally:**
+
+1. **Compute `milestones-since-last-human-directive`** at every ABSORB (`dashboard.md`'s "Human-
+   review cadence" health track) as `milestone_counter (current, post-increment) − (the milestone
+   number at which the LAST human-initiated directive burst was drained from `directives/pending/`,
+   pre-dispatch)`. DIR-003 (self-raised) does NOT reset this counter — only directives arriving via
+   the external `/quay-directive` channel count, since the whole point of this track is visibility
+   into the async human-input channel specifically, not all directive-shaped artifacts.
+2. **Soft-alarm threshold: K=5.** Chosen to reuse the existing checkpoint cadence
+   (`milestone_counter % 5 == 0`, `OUTER-LOOP.md` step 8) rather than invent a second, unrelated
+   number — the two tracks now share one mental model ("how long since a human last looked at
+   this," observed at the same natural 5-milestone cadence the checkpoint already uses).
+3. **Explicitly non-blocking.** Unlike the V_meta consolidation-lag gate (`dashboard.md`'s
+   neighboring health-track row, `OUTER-LOOP.md` step 6's HARD BLOCK on `milestone_counter++`),
+   crossing K=5 on this track does **NOT** block ABSORB, does NOT block `milestone_counter++`, and
+   does NOT pause the loop. The reason the two tracks are treated differently even though both are
+   "K=5-vs-K=2 thresholds on a lag count": the V_meta ledger's rows are a mechanically resolvable
+   backlog item (a pattern that needs consolidating, entirely within the loop's own power to fix by
+   doing the consolidation work) — but a human directive is, by definition, asynchronous and
+   human-paced; the loop cannot manufacture one, and must not wait for one (`OUTER-LOOP.md`'s own
+   header invariant, "the loop never blocks waiting for a human"). This track exists purely to make
+   that existing asynchrony **visible**, not to change its blocking semantics.
+4. **The one concrete behavior this induces:** at every checkpoint (`milestone_counter % 5 == 0`,
+   `OUTER-LOOP.md` step 8), the checkpoint snapshot must include this track's current value, so a
+   human skimming `checkpoints/cp-<NN>.md` asynchronously sees "N milestones since last human
+   input" directly, without needing to dig through `directives/archive/` to reconstruct it by hand.
```

States the tally (citing it), states K=5 and its non-blocking nature explicitly, and contrasts it
with the V_meta consolidation-lag gate which IS blocking (item 3 above, explicit).

## §6. Done-when clause 4 — `OUTER-LOOP.md` step 8 diff (before/after)

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
   health snapshot across all tracks (including `dashboard.md`'s `Human-review cadence` track's
   current `milestones-since-last-human-directive` value, per `inherited-core.md`'s "Human-review
   cadence" section — non-blocking, observational only) + a re-test of the standing hypothesis (§1).
   **Do NOT wait for a human.** After writing it, CONTINUE to the next milestone. The human reviews
   snapshots asynchronously.
```

**Literal diff:**
```diff
diff --git a/experiments/quay-perpetual-stream/OUTER-LOOP.md b/experiments/quay-perpetual-stream/OUTER-LOOP.md
index 05d1cbd..60e83f1 100644
--- a/experiments/quay-perpetual-stream/OUTER-LOOP.md
+++ b/experiments/quay-perpetual-stream/OUTER-LOOP.md
@@ -156,9 +156,11 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
    calibration-error, `V_meta consolidation lag` (re-derive milestones-since-confirmed for every
    ledger row per `v-meta-ledger.md`), milestone_counter++ (only after the gate above clears).
 8. **CHECKPOINT (non-blocking)** if `milestone_counter % 5 == 0`: write `checkpoints/cp-<NN>.md` — a
-   health snapshot across all tracks + a re-test of the standing hypothesis (§1). **Do NOT wait for a
-   human.** After writing it, CONTINUE to the next milestone. The human reviews snapshots
-   asynchronously.
+   health snapshot across all tracks (including `dashboard.md`'s `Human-review cadence` track's
+   current `milestones-since-last-human-directive` value, per `inherited-core.md`'s "Human-review
+   cadence" section — non-blocking, observational only) + a re-test of the standing hypothesis (§1).
+   **Do NOT wait for a human.** After writing it, CONTINUE to the next milestone. The human reviews
+   snapshots asynchronously.
 
 ## The loop runs autonomously — it NEVER blocks waiting for a human
 Human input is asynchronous (below). At **each milestone boundary** the loop checks the two — and
```

Only step 8's own bullet was edited (2 lines removed, 4 lines added, net +2). No other step's text
was touched — confirmed by the diff hunk boundaries (the hunk starts inside step 7's text and ends
at the "## The loop runs autonomously" header, with only the step-8 bullet content inside changed).

## §7. Done-when clause 5 — `checkpoints/cp-15.md` (LIVE proof, this milestone's own ABSORB)

`milestone_counter` was 14 going into this milestone; this milestone's own ABSORB lands at
`milestone_counter=15`, a checkpoint boundary (`15 % 5 == 0`). Per the now-updated step 8, wrote
`checkpoints/cp-15.md` (116 lines) inside the worktree, covering m11-m15, all pre-existing health
tracks, AND the new Human-review-cadence track with its real computed value (2). Full file contents:

```
# Checkpoint 3 — quay-perpetual-stream (exp5)

**Written:** 2026-07-18, at milestone_counter=15 (non-blocking, per OUTER-LOOP.md §8 — the loop does
NOT wait for human review of this file; it continues directly to m16 SELECT after writing it). This
is the FIRST checkpoint written under the newly-updated step 8 (M15-human-review-cadence), and the
first checkpoint to include the "Human-review cadence" health track — live proof-of-mechanism for
this milestone's own deliverable, not deferred to a future checkpoint.

## Milestones completed (m11–m15)

| m | milestone | type | outcome | VT effect |
|---|---|---|---|---|
| 11 | M-WEBUI-REVERIFY | exploit | DONE (2 it) | 0 (discovery+risk/option value — real playwright/chrome-devtools re-verification of M04-discover's provisionally-uncertain Web UI cov, CONFIRMED 0.92 unchanged, no Δv) |
| 12 | M-ABI-PARENT-WRITE | exploit | DONE (2 it, adversarial-audited) | +1.54 (109.11→110.65/120 — Provider-ABI write cov 12/13→13/13; first real trigger of the out-of-band adversarial-audit gate, verdict CONCERNS/non-blocking) |
| 13 | M-TASK-BACKLOG-PROJECTION | explore | DONE (2 it, design-doc only) | 0 (discovery+governance-integrity value — design doc for tracking exp5's own non-directive work as quay tasks; not yet charter-ready for implementation) |
| 14 | M-CLI-EDIT-PARITY | explore | DONE (2 it, design-doc only) | 0 (capability-growth+risk/option value, design-doc only — full-field Core CLI `task edit` relaxation design; not yet charter-ready for implementation) |
| 15 | M15-human-review-cadence | explore | DONE (this milestone) | 0 (discovery+governance-integrity value, method infra — health track + doc convention, zero VT chart weight by design) |

Explore/exploit cadence (§4.5, ≥1 explore per 5): **3 explore / 2 exploit — satisfied.** (Combined
m1-m15: 11 explore / 4 exploit — still comfortably above the ≥1-per-5 floor.)

## VT trajectory & slope

Current VT chart-1 total: **110.65/120** (≈0.922 normalized), unchanged since m12 — m13/m14/m15 are
all zero-VT method-infra/design-only milestones by design, no chart movement to report.

Qualifying-milestone slope (cp-01's own pre-declared definition — direct, same-chart,
non-corrective capability-growth Δv only): still **m1 (+6.0), m8 (+9.00), m9 (+5.38)** as the
qualifying set through m10 (per cp-02); **m12 (+1.54) now qualifies** as a 4th data point (clean
same-chart capability growth, Provider-ABI write completion, no confound) — m11/m13/m14/m15 are all
excluded (zero-VT discovery/design/method-infra by design).

(6.0 + 9.00 + 5.38 + 1.54) / 4 = 5.48 points/qualifying-milestone

**Still well above the +1.0 soft-alarm threshold — no slope alarm.** Qualifying rate now 4/15 ≈
27%, continuing the trend cp-02 flagged (denominator thinning as more milestones skew toward
methodology-infra/design-doc work) — not itself an alarm condition (the definition doesn't gate on
qualifying-rate), but the trend cp-02 predicted ("if future milestones skew further toward
methodology-infra... the numerator will thin further") has continued through m11-m15: 4 of the 5
milestones this checkpoint window were zero-VT.

## Health tracks (from dashboard.md, current at m15)

- **ρ reuse rate:** ~0.85, must-not-fall — **healthy, stable**, unchanged since cp-01/cp-02.
- **φ fold-back:** 2 CONSOLIDATED patterns (`domain-audit-channel≡CI-job`, consolidated m7) —
  **healthy, stable**, unchanged since cp-02. No new consolidation event in m11-m15's window.
- **charter thickness:** unchanged pattern — gate-hash-by-reference form keeps charter files thin
  while dispatched-agent prompts still carry literal gate text; M15's own charter used the
  by-reference form (per its own header, "M06-sizing by-reference form"). **Healthy, stable.**
- **discovery latency:** 0 across all 15 milestones — **healthy**, unchanged pattern. m12's
  iteration-1 (via the adversarial audit) caught 3 real findings (DRAFT-state left unfinalized,
  missing gap-list.md row, overstated independence framing) same-ABSORB, zero-latency.
- **calibration error:** m12 realized Δv (+1.54) matched its own Δv̂ ceiling estimate EXACTLY (0%
  calibration error) — the systematic under-promising pattern cp-02 flagged (m8/m9 both
  under-estimated) did NOT repeat at m12; m13/m14/m15 carry no formal Δv̂ (zero-VT by charter
  design, consistent with m2/m5/m6/m7/m10's own precedent).
- **inner-convergence success:** **15/15** — **healthy**, unchanged pattern across all 15
  milestones. Zero mid-milestone re-scopes to date.
- **V_meta consolidation lag:** **0 rows past-threshold-and-unresolved**, unchanged since m7's gate
  first fired. One row remains `proposed` (repo-root isolation-leak lesson, m3, count unchanged) —
  still has not crossed the φ=2 threshold.
- **adversarial-audit-role coverage (DIR-007/M10):** fired for real a SECOND time at m12 (first was
  the gate's own construction at m10; m11 correctly did NOT fire, discovery/risk-option-typed;
  m12 fired per condition (a), capability-growth-typed with nonzero realized Δv) — verdict
  CONCERNS (non-blocking), 3 real findings fixed same-ABSORB. m13/m14/m15 correctly did NOT fire
  (zero-VT method-infra/design-only, no self-exemption attempt at any of the three). **Healthy,
  proven in practice across 2 real triggers now, not just a paper gate.**
- **Human-review cadence (NEW THIS CHECKPOINT — M15-human-review-cadence, DIR-001 item 6):**
  `milestones-since-last-human-directive = 2` (as of m14-complete/m15-dispatch — last human
  directive burst, DIR-009/010/011, arrived at the m12→m13 boundary; m13/m14 both completed with no
  new arrivals; this milestone, m15, is itself a response to a much-earlier item within DIR-001,
  not a new arrival, so it does not reset the counter). Full 11-directive tally: 10/11
  human-initiated mid-conversation, 1/11 self-raised (DIR-003, sanctioned live-dogfood artifact).
  **Soft alarm K=5 — not yet crossed** (2 < 5). **Non-blocking** — this cell is logged for human
  async review only, per `inherited-core.md`'s "Human-review cadence" section; it carries no HARD
  BLOCK anywhere it appears (`dashboard.md`'s health-track row, `OUTER-LOOP.md` step 8's CHECKPOINT
  bullet). This is the first checkpoint where this track's value is computed and visible — the live
  proof-of-mechanism this milestone's own Done-when clause 5 required.

## Standing hypothesis re-test (§1)

Hypothesis: a two-layer outer/inner BAIME loop can perpetually discover and deliver real product
value across explore/exploit milestones, self-correcting via independent re-verification, without
human-in-the-loop blocking. **Not falsified, and further evidenced since cp-02.** New evidence
since cp-02: 15/15 cumulative milestone convergence (5 more since cp-02, all 2-iteration, zero
mid-milestone re-scopes); the adversarial-audit-role gate (built m10, unexercised at cp-02) fired
for real at m12 and returned a genuine, useful CONCERNS verdict with 3 fixable findings, closing the
"currently open gap in the experiment's own self-correction machinery" cp-02 flagged as unproven in
practice; two design-doc-only milestones (m13/m14) extended the value-typed ledger's discovery+
governance-integrity framing into forward-looking design work without inflating VT, staying
disciplined about the "design delivered ≠ implementation done" distinction; this milestone (m15)
closes DIR-001 item 6 — the last remaining item from the very first human directive filed in this
experiment — with a real, generalized-from-evidence health track rather than a re-assertion of the
original finding. Zero human blocking occurred across all 11 human-initiated-or-self-raised
directives, all drained cleanly at milestone boundaries.

**One live observation, newly visible this checkpoint (not previously trackable):** the human
directive channel itself shows a bursty, not steady, arrival pattern (7 single/self arrivals + 2
three-directive bursts, per the new track's own tally) — worth watching whether future gaps exceed
K=5 as the backlog's carried-by-reference candidates continue to thin (per m3's own "backlog
exhaustion" precedent) and more milestones become design-doc-only or self-generated exploit picks
with less occasion for a human to intervene structurally.

**No internal exit signal fires.** Continuing directly to m16 SELECT, no human wait.

## Next (m16 candidates, from backlog.md)

- `M-TASK-BACKLOG-PROJECTION`'s and `M-CLI-EDIT-PARITY`'s own design docs are both "not yet
  charter-ready for implementation" — a natural explore candidate is chartering one of them for
  real implementation, now that both designs exist.
- DIR-001 items 3-5 (outcome-based eval, adversarial/security eval, competitive benchmark) — still
  backlogged, larger, not yet prioritized ahead of the above. Item 6 (this milestone) is now closed.
- Any remaining Provider-ABI/Web UI/Docs/Packaging polish surfaced but not yet bundled from m11's
  own exploit pass.
```

The new track's value (2) appears computed, cited against the real §3 tally, and visible alongside
every other existing health track — not a description of what a future checkpoint would show, but
the actual first live artifact.

## §8. Done-when clause 6 — no blocking mechanism introduced

**Step 0 (DRAIN) confirmed unchanged.** Re-read `OUTER-LOOP.md` step 0's full text before and after
this iteration's edits — byte-identical, zero diff hunks touch lines before step 8's own bullet
(confirmed directly by the diff in §6 above: the earliest changed line is inside step 8's own text,
the hunk's context lines above it belong to step 7, untouched).

**Explicit confirmation: the new track carries no HARD BLOCK language anywhere it appears.**
Grepped both edited files for the literal string `HARD BLOCK` near "human"/"Human-review":

```
$ grep -n "HARD BLOCK" experiments/quay-perpetual-stream/dashboard.md experiments/quay-perpetual-stream/inherited-core.md experiments/quay-perpetual-stream/OUTER-LOOP.md | grep -i "human"
experiments/quay-perpetual-stream/dashboard.md:325:| Human-review cadence (M15-human-review-cadence, DIR-001 item 6) | ... never a HARD BLOCK on `milestone_counter++`, unlike the V_meta consolidation-lag gate directly above ...
```

The only match is the dashboard.md cell's own explicit disclaimer stating it carries NO such block
— the string "HARD BLOCK" appears solely in a negation ("never a HARD BLOCK"), never as an
imperative applied to this track. `inherited-core.md`'s new section states the same contrast
explicitly in its item 3 ("crossing K=5 on this track does NOT block ABSORB, does NOT block
`milestone_counter++`, and does NOT pause the loop"). `OUTER-LOOP.md` step 8's edit only adds a
parenthetical reference ("non-blocking, observational only") — no gate/block verb anywhere in the
new text.

## §9. Done-when clause 7 — `backlog.md` diff

```diff
diff --git a/experiments/quay-perpetual-stream/backlog.md b/experiments/quay-perpetual-stream/backlog.md
index 985d866..2714e2d 100644
--- a/experiments/quay-perpetual-stream/backlog.md
+++ b/experiments/quay-perpetual-stream/backlog.md
@@ -31,7 +31,7 @@ at SELECT time once VT origin is scored.
 | M-OUTCOME-EVAL | Outcome-based (job-to-be-done) evaluation: fixed real end-to-end task-board scenarios, binary pass/fail, dogfooding-gated | cross-cutting | DIR-001 item 3 | explore | method infra, no VT points | Backlogged, not yet charter-ready — needs a concrete scenario list authored at SELECT time. |
 | M-ADVERSARIAL-EVAL | Adversarial/negative-path + security evaluation (fault injection, token handling, open-redirect, injection review) | cross-cutting | DIR-001 item 4 | explore | method infra, no VT points | Backlogged. |
 | M-COMPETITIVE-BENCH | Comparative capability benchmark vs. a real competitor (formalize CB-016's ad hoc GitHub Issues/Linear yardstick) | cross-cutting | DIR-001 item 5 | exploit (cross-exp comparison channel) | method infra, no VT points | Backlogged. |
-| M-HUMAN-REVIEW-CADENCE | Standing periodic human-led capability review as an explore milestone type (institutionalize the `/quay-directive` channel itself, not just react to it) | method infra | DIR-001 item 6 | explore | method infra, no VT points | Backlogged — offline data (RESULTS.md) shows every structural discovery came from this channel, never the simulated-user; worth a recurring-cadence design once ≥2 more DIR-* instances exist to generalize from. |
+| M-HUMAN-REVIEW-CADENCE | Standing periodic human-led capability review as an explore milestone type (institutionalize the `/quay-directive` channel itself, not just react to it) | method infra | DIR-001 item 6 | explore | method infra, no VT points | **DONE (m15, 2026-07-18).** `dashboard.md` gained a "Human-review cadence" health track (`milestones-since-last-human-directive`, K=5 soft-alarm, non-blocking) computed from a real tally of all 11 `directives/archive/DIR-*.md` (10/11 human-initiated mid-conversation, 1/11 self-raised); `inherited-core.md` gained a "Human-review cadence" section stating the rule, the full tally table, and the non-blocking rationale (contrast with the V_meta consolidation-lag gate, which IS blocking); `OUTER-LOOP.md` step 8's CHECKPOINT bullet was edited (small, precise, step 8 only — step 0/DRAIN untouched) to reference computing/logging the new track. Live proof-of-mechanism: this milestone's own ABSORB landed at `milestone_counter=15`, a checkpoint boundary, and `checkpoints/cp-15.md` was written showing the new track's real value (2 milestones since last human directive) alongside all other health tracks — not deferred to a future checkpoint. See diffs to `dashboard.md`/`inherited-core.md`/`OUTER-LOOP.md`/`checkpoints/cp-15.md` on branch `exp5-m15-iteration-1`. |
 
 ## M03-abi-eval-sourced candidates (2026-07-18)
```

## §10. `git diff --stat` against the pre-charter base commit

Run from inside the worktree:

```
$ git diff --stat ed3d94bf9f42ea53b38d5c4118e4806239ed702d
 experiments/quay-perpetual-stream/OUTER-LOOP.md    |   8 +-
 experiments/quay-perpetual-stream/backlog.md       |   2 +-
 .../quay-perpetual-stream/checkpoints/cp-15.md     | 116 +++++++++++++++++++++
 experiments/quay-perpetual-stream/dashboard.md     |   1 +
 .../quay-perpetual-stream/inherited-core.md        |  59 +++++++++++
 5 files changed, 182 insertions(+), 4 deletions(-)
```

Confirmed: **only** `dashboard.md`, `inherited-core.md`, `OUTER-LOOP.md`, `backlog.md`, and the new
`checkpoints/cp-15.md` file changed. No product code (no files under `packages/`) touched anywhere
in this diff.

## §11. Domain-misfit audit-channel (it0 check d)

Per the charter's own it0d note: this milestone edits three markdown method-infra files with no
live external system and no product code — consistent with M-SIZING/M-VMETA-GATE/M13/M14's own
doc/method-infra-only precedent. Recorded explicitly here rather than forcing a mismatched
audit-channel citation, as the charter itself directs.

## §12. Adversarial-audit gate

Per the charter's own explicit statement: this milestone is typed discovery+governance-integrity
with Δv̂=0 by design, so condition (a) (VT-scoring capability-growth with nonzero Δv) does not
apply. Condition (b) (iteration-0 recommending skipping iteration-1) also does not apply — this is
iteration-1 itself, independently dispatched per the charter's own dispatcher instructions, and no
self-exemption was requested or granted anywhere in this iteration. Neither adversarial-audit
condition fires; this is a documented no-op, consistent with the charter's own framing.

## §13. Commit / working-tree state

```
$ git log --oneline -1
ffdee07 ABSORB M15-human-review-cadence iteration-1: institutionalize human-review channel as a health track
$ git status --porcelain
(clean)
```

All 7 binary Done-when clauses met with pasted evidence above (§3-§9), no clause marked met on
narrative alone. Working tree clean at commit `ffdee07` on branch `exp5-m15-iteration-1`.
