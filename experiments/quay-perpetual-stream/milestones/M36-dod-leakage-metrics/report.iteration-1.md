# M36-dod-leakage-metrics — iteration-1 self-report

**Branch:** `exp5-m36-iteration-1` · **Base:** `exp5-outer-driver` @ `9a533d6` · **Commit:**
`05fbdc1` · **Worktree:** `experiments/quay-perpetual-stream/milestones/M36-dod-leakage-metrics/worktrees/iteration-1`

## 1. HARD GATES

- **Gate-hash-by-reference check** (charter cites `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`
  lines 100-131, pinned hash `5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93`):
  re-ran `it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M36-dod-leakage-metrics.md`
  from the worktree root -> **PASS**: `GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93)
  matches current pinned source`. Pinned source unchanged since M06, confirmed unchanged again here.
- **manda healthz gate**: **N/A this milestone** — no Web UI/manda surface touched (method-infra
  doc/dashboard work only, `inherited-core.md`/`dashboard.md`/`OUTER-LOOP.md`), per the charter's own
  explicit N/A statement. Stated explicitly, not silently omitted.
- **Port-4173 reachability gate**: **N/A this milestone** — same reasoning, no Web UI surface touched.
- **`ls directives/pending/`**: `directives/pending/DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md`
  is the only file. Disposition this iteration: **applied** — this milestone IS DIR-017 Step 3, the
  last of DIR-017's three ordered steps; Steps 0-2 already delivered (M21/M25/DIR-019-fix-M30/M32).
  DIR-017 itself is not archived by this iteration (that is an outer-loop/ABSORB-time decision, not an
  in-worktree iteration action) but its Step-3 content is delivered by this commit.

## 2. What was built

### 2.1 Deviation-record schema — location: `inherited-core.md` (new section, "Deviation-record
schema (DIR-017 Step 3 / M36-dod-leakage-metrics)", inserted after the existing DoD-clauses/DIR-017
status block)

**Why `inherited-core.md`, not a new sibling file** (explicit choice, per the charter's "implementer's
choice, state which and why"): `v-meta-ledger.md` was split into its own file because it has a
genuinely different UPDATE CADENCE from `dashboard.md` (edited whenever a confirmation count changes,
independent of ABSORB boundaries — see that file's own stated rationale). A deviation record does NOT
have that property — every deviation is found/caught/resolved strictly as part of some milestone's own
ABSORB (or a directive's DRAIN disposition), i.e. the SAME cadence `dashboard.md` already runs on. So:
the SCHEMA (rarely edited, defines vocabulary) lives in `inherited-core.md` next to the DoD clauses it
measures leakage from; the ROWS (backfilled + future, edited every ABSORB that has a deviation event)
live in `dashboard.md`'s new "Homeostatic variables" section — mirroring exactly how the DoD clauses
are DEFINED in `inherited-core.md` but their per-milestone DISPOSITIONS are logged in `dashboard.md`'s
ABSORB entries.

**Fields:** `id`, `title`, `found-in` (milestone that surfaced it), `origin-milestone` (milestone that
introduced the underlying defect, may differ, may be `unknown`), `caught-by` (`machine`: an `it0-*`
check failing or an adversarial-audit CONCERNS-or-worse verdict; `human`: a directive like DIR-019/
DIR-020, or a human-verification-gate finding), `severity` (`concerns`/`refuted`/`process-deviation`),
`status` (`open` -> `fix-landed` -> `verified-eliminated`, terminal), `found-date`/`verified-date`
(milestone-numbered), `evidence` (citation, never a bare assertion).

**`verified-eliminated` operational definition** (charter required this be defined, not just named):
the fix has been EXTERNALLY re-tested by a party other than the fixer — a live pinned regression
fixture, a second independent adversarial-audit pass, or an out-of-band re-run of the previously-
failing check — mirroring DIR-019 item 3's own "verification (external, not self-report)" discipline,
which I re-read directly and generalized rather than inventing a new standard.

**Age**: milestone-count based (`verified-date` milestone minus `found-in` milestone for terminal rows;
`current milestone_counter minus found-in` for still-open rows, reported separately), not calendar-date
based — exp5's cadence is milestone-paced (many ABSORBs land same-day), so calendar date would be a
noisier unit; recorded as a secondary field only.

**Self-test against a novel case** (per the charter's own Note-for-ABSORB probe (a)): I constructed a
hypothetical — "a future charter claims 'line-budget gate N/A' but is actually over budget, noticed by
a human reviewer, not by `it0-ceiling-line-budget-check.sh` failing." This classifies cleanly:
`caught-by: human`, `severity: concerns`, `status: open` until fixed, `evidence` = the reviewer's
citation. No field is ambiguous or unpopulatable for this novel case — the schema generalizes beyond
the 5 backfilled examples.

### 2.2 Backfill — 5 worked examples (table in `dashboard.md`'s new section, full citations inline
with re-verified line-number anchors, not copied from the charter's summary)

| id | title | caught-by | status | age (milestones) |
|---|---|---|---|---|
| DEV-001 | M11 charter conflated "VT-scoring"/"capability-growth-typed" in Done-when 6, risking an unwarranted audit-gate self-exemption reading | human | verified-eliminated | 14 (m11->m25) |
| DEV-002 | ADV-004 path-traversal arbitrary-file-write | machine | verified-eliminated | 0 |
| DEV-003 | DoD Clause-5 `dispositionedClauses` carve-out blind spot (DIR-019) | human | verified-eliminated | 1 (m29 found->m30 fixed) |
| DEV-004 | M30 single-commit process deviation (self-disclosed) | human | verified-eliminated | 0 |
| DEV-005 | DoD Clause-7 negation-blind coverage regex (M32 acceptance audit) | machine | verified-eliminated | 0 |

Each row's evidence was re-verified directly against `dashboard.md`'s own prior Log text (not assumed
from the charter's summary) — e.g. I confirmed DIR-019 literally arrived as commit `8432a67` mid-M29
and was disposed at m30's ABSORB (age 1, not the charter's looser "found ~m29, fixed M30" framing,
which I made precise); I confirmed M26's ADV-004 was found AND fixed AND independently re-confirmed
(by iteration-1's separately-run audit) all within m26 itself (age 0); I confirmed M32's negation-blind
regex was likewise found-and-fixed within its own ABSORB (age 0, pinned fixture
`test-floor-negation-poison-stub.md`). DEV-001 is flagged in the table itself as the one row with a
weaker sense of `verified-eliminated` — it doesn't have a pinned regression fixture asserting the
EXACT M11 scenario, only Clause 5's general no-self-exemption fixtures (`violating-stub.md`/
`compliant-stub.md`) — stated as a real (mild) limitation, not hidden.

**Limitation stated explicitly** (charter requires this): this is best-effort backfill against the 5
named worked examples only, NOT an exhaustive sweep of exp5's full history for every possible
deviation. A future candidate could extend the backfill.

### 2.3 Homeostatic-variables section — `dashboard.md`, inserted between "Health tracks" and "Control
limits" (a natural fit: the existing Health-tracks table already carries the V_meta-lag and
human-review-cadence homeostatic variables; this is one more, same section, clearly subsectioned)

Live-computed, real numbers (recomputed independently below, not copied from the dashboard prose):

- **(a) machine vs human**: DEV-002, DEV-005 = machine (2); DEV-001, DEV-003, DEV-004 = human (3).
  **2:3** (40% machine / 60% human).
- **(b) fraction reaching `verified-eliminated`**: 5/5 = **100%**. Stated with the caveat that this is
  an expected upper bound — the charter's own "known real deviations already on record" framing
  selects for cases with a DOCUMENTED resolution, biasing the backfilled sample toward resolved cases.
- **(c) median deviation age**: ages sorted `[0, 0, 0, 1, 14]`, n=5 (odd) -> median = 3rd value = **0
  milestones**. Mean = 3.0, given as context (not the requested metric) to show DEV-001 is a genuine
  outlier pulling the mean well above the median.
- **(d) product-value shipped per K=10 milestones**: nonzero Realized Δv entries re-derived by grep
  directly against `dashboard.md` (not copied from any one milestone's own citation): m1 +6.00, m8
  +9.00, m9 +5.38, m12 +1.54, m29 +0.50, m33 +0.40 — sum = **22.82** VT-points. All other 29 of the 35
  completed milestones recorded Realized Δv=0 by explicit charter design (method-infra/discovery-
  typed). `milestone_counter=35` at last ABSORB (m36 itself is in-progress, excluded from the
  denominator). **22.82 / 35 x 10 = 6.52 VT-points per 10 milestones.** K=5 and K=1 variants given for
  reference since DIR-017's own text doesn't pin K.

Independent re-derivation check (shown here, separate from the dashboard prose):
```
python3: sum([6.00,9.00,5.38,1.54,0.50,0.40]) = 22.82
22.82/35*10 = 6.52  (per K=10)
sorted([14,0,1,0,0]) = [0,0,0,1,14]; median (3rd of 5) = 0; mean = 3.0
```

### 2.4 Forward-update responsibility — stated in TWO places, both explicit

1. `inherited-core.md`'s new schema section, "Forward-update responsibility" paragraph: the
   per-milestone acceptance audit (Clause 1, unconditional every milestone) is the standing writer for
   `caught-by: machine` rows (its own CONCERNS/REFUTED verdicts) and for `fix-landed -> verified-
   eliminated` transitions (since that transition requires an external-verification act, which is the
   audit's own job); the outer loop, at the DRAIN step that first processes a directive, is the writer
   for `caught-by: human` rows and for `open -> fix-landed` transitions.
2. `OUTER-LOOP.md`'s ABSORB step, new sub-step **1b** (immediately after the existing 1a checklist
   write-back sub-step, DIR-020/M34's own mechanism) — mechanically wires this into the loop's actual
   procedure text, not just described in prose in `inherited-core.md`. This directly mirrors how
   DIR-020/M34 named the audit as the standing checklist write-back writer, extended to one more
   artifact at the same step.

**Trigger points, stated unambiguously** (per the charter's Note-for-ABSORB probe (c)): every ABSORB
where Clause 1's audit returns CONCERNS-or-worse; the DRAIN step where a human-authored directive is
first processed; any ABSORB where a previously-open row's fix lands or is externally re-verified. Not
a periodic sweep, not deferred to a future consolidation pass — if no such event occurs in a given
ABSORB, no row is written that cycle.

## 3. Escrow-Δv / scope-decision confirmation

Per the charter's explicit scope decision: this milestone ships the REAL doc/dashboard artifacts
directly (the schema in `inherited-core.md`, the backfilled table + computed metrics in
`dashboard.md`, the forward-update wiring in `OUTER-LOOP.md`) — it is NOT a design-only milestone
producing a doc for later code. There is no future "-IMPL" step to escrow Δv against (the
"implementation" IS this diff). **Escrow-Δv clause (6) does not apply.** No `-IMPL` follow-up row
seeded in `backlog.md` — confirmed this is correct per the charter's own explicit non-exemption
reasoning (this is a genuine non-trigger, not a self-exemption dodge; I re-read the charter's own
"Reasoning" sentence on this point before relying on it, did not just assume it).

## 4. Test-floor gate / diff scope confirmation

`git diff --stat` (branch `exp5-m36-iteration-1` vs base `9a533d6`):
```
 experiments/quay-perpetual-stream/OUTER-LOOP.md    |  12 +++
 experiments/quay-perpetual-stream/dashboard.md     |  65 +++++++++++++
 experiments/quay-perpetual-stream/inherited-core.md| 102 +++++++++++++++++++++
 3 files changed, 179 insertions(+)
```
Zero `packages/quay*` files touched. Test-floor gate (Clause 7) is **N/A** — confirmed directly, not
assumed from the charter. Re-ran `dod-fixture-selfcheck.sh` after all edits: **13/13 fixtures PASS**
(no regression introduced to the DoD-enforcer mechanism by these doc edits, since `inherited-core.md`
content changes do not alter `it0-dod-check.mjs`'s own logic).

## 5. Deviations from the charter's guidance

None substantive. Two small precision corrections made beyond the charter's own (looser) framing,
noted for the record:
- DIR-019's deviation age: the charter's Current-state notes say "found ~m29, fixed M30" without
  giving a precise age; I computed it precisely as **1 milestone** (arrival mid-M29 via off-loop
  commit `8432a67`, disposed at m30's ABSORB) rather than leaving it vague.
- DEV-004 (M30's process deviation)'s `status: verified-eliminated` is flagged in the backfill table
  itself as using a WEAKER sense of "terminal" than the other four rows — it means "judged and closed
  as a one-off, not standing precedent" (the audit's own adopted position), not "this practice was
  mechanically prevented from recurring" (no `it0-*` gate polices dispatch-pattern choice at all).
  Stated as a real, load-bearing limitation of applying an artifact-defect-shaped schema to a
  process-choice-shaped deviation, not smoothed over.

## 6. Files changed

- `experiments/quay-perpetual-stream/inherited-core.md` — new "Deviation-record schema" section.
- `experiments/quay-perpetual-stream/dashboard.md` — new "Homeostatic variables" section (backfill
  table + 4 metrics with cited arithmetic).
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` — new ABSORB sub-step 1b (deviation-log
  write-back), wired next to the existing 1a checklist write-back.

Commit: `05fbdc1` on branch `exp5-m36-iteration-1` (not pushed, not merged, per instructions).
