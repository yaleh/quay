# DIR-004

- status: applied (m6, 2026-07-18) — see Resolution section below
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Milestone sizing — define the cost band via the build+verify unit, and make SELECT value-typed (VT prices only one of four observed value types; never ship half a value step)

## Finding

Reviewing exp5's first four milestones (m1–m4, all ABSORB DONE) surfaced two
linked gaps in how milestones are sized and selected. The current machinery
handles the COST axis implicitly and the VALUE axis not at all.

### A. "2 inner iterations" is a bad size proxy — real size lives in iteration-0

All four milestones "cost" exactly 2 inner iterations, but that regularity is
an artifact of the template (1 build + 1 independent-verify), not of natural
scope. The verify iteration is a FIXED tax, so the milestone's true weight is
carried entirely by iteration-0. Underneath the constant "2", scope varied
wildly (m1: 13 files, real product code + cross-platform CI debugging; m2: ~5
files, shell scripts; m3: 6 files, an eval matrix + conformance suite; m4: 1
file, review findings). The size signal is therefore NOT the iteration count —
it is "can iteration-0 land ALL Done-when clauses in one pass, and does
iteration-1 have something real to independently re-derive."

- **m1 is the ceiling-brush evidence**: its iteration-1 was NOT verification —
  it was substantive new build work (tag-pushing v0.3.0→v0.3.4, fixing 4
  distinct real CI failures). m1 was mildly OVER-sized; the verify only happened
  folded in. m2/m3/m4 were sized so iteration-0 landed everything and
  iteration-1 was a genuine independent re-derivation (and twice caught real
  errors: m2 a false-FAIL in its own gate-hash script; m4 an arithmetic slip in
  iteration-0's VT total, 95.83→94.73 — which, uncaught, would have poisoned
  every later milestone's baseline). The independent-verify iteration run by a
  separate agent is confirmed effective and is the mechanism that keeps exp5
  from reproducing the "self-check, self-rubber-stamp" failure that MD-001
  showed exp4 fell into.

- **The cost band is squeezed from below**: charter thickness is at the >2K
  alarm on 3/3 milestones, structurally (gate-block transclusion overhead, not
  per-milestone dilution). High fixed overhead creates economic pressure to
  size milestones LARGER to amortize it — directly against the "converge in 2,
  no mid-milestone re-scope" ceiling. M-GATES already built the tooling
  (`it0-gate-hash-check.sh` — hash verification) that would let charters cite a
  gate block by hash instead of transcribing it verbatim, but the charter
  template does not yet use it, so the overhead persists.

### B. VT prices only ONE of four observed value types → SELECT degenerates to prose

Ranking m1–m4 by realized value rather than cost inverts the VT ordering:

| milestone | Δv (VT) | real value type | VT captured it? |
|---|---|---|---|
| m1 M-DIST | +6.0 | capability growth on an existing surface | yes |
| m2 M-GATES | 0 | risk/option value (pre-empted 3 wasted SELECTs) | no — scored 0 |
| m3 M-ABI-EVAL | +13.08 (explicitly "re-baseline, not growth") | discovery value (blind spot + 2 real bugs) | no — points are a new ruler, not growth |
| m4 M04-discover | **−6.60** | instrument-correction value (exposed exp4's false "closed" ledger, MD-001) | no — **the more valuable, the more NEGATIVE VT went** |

The two most important milestones in hindsight (m2 pre-empting waste, m4
correcting a measurement error carried since m1) score ≤0 on VT. This is the
memorized instrument-blindness principle in action: a metric cannot price the
milestone that corrects the metric. VT sees only **capability growth**; it is
blind to **discovery value**, **instrument-correction value**, and
**risk/option & governance-integrity value**.

Consequence: m5 SELECT is already stuck weighing three candidates whose value is
of three incommensurable types — M-DIR-PROJECTION (governance-integrity, VT 0),
M-MERGE-RECOVER (instrument-correction, likely VT-negative), M-GH-WRITE
(capability growth, the only VT-positive one). Steering on VT alone would
systematically always pick M-GH-WRITE and permanently defer the self-correcting
milestone type — exactly the failure a blind value function produces. The
current SELECT reasoning compensates with prose ("governance-drift risk
outranks provider-capability gaps") precisely because there is no common,
typed value ledger to reason over.

### C. DIR-006 was a value-axis sizing failure

The transition failure this session already remediated (DIR-002) is, in this
frame, a SIZING failure on the value axis: a governance/infra milestone sized
to its cost-cheap half (the cutover) rather than its value-complete whole
(cutover + enabling tooling + drift enforcement). Under-sizing an infra/
governance milestone does not merely leave value on the table — it produces
NEGATIVE value (dual-representation drift). So for that milestone class the
value-complete scope is a hard floor, not a target.

## Requested action

Adopt an explicit milestone-sizing-and-selection rubric in the method's own
substrate (`inherited-core.md` and/or `OUTER-LOOP.md`'s SELECT step), and back
it with the small tooling change that removes the cost-band squeeze. This is a
methodology-infrastructure change; it likely warrants its own explore milestone
(suggested id `M-SIZING`) or can be folded into the next methodology-infra
milestone if one is selected first.

Scope:

1. **Size definition (cost × value, one sentence, to live in `inherited-core.md`):**
   > A milestone is the smallest scope that carries a coherent, {user- or
   > method-}visible VALUE STEP AND fits the build+verify COST band (iteration-0
   > lands all Done-when in one pass; iteration-1 has real material to
   > independently re-derive; no mid-milestone re-scope). When a coherent value
   > step is too big for one cost unit, split along a DIFFERENT seam into a
   > smaller coherent step, or explicitly budget a multi-build milestone (m1's
   > real shape) — NEVER resolve the conflict by shipping half a value step.

2. **Use the verify iteration as the size gauge** (make explicit in the SELECT/
   charter guidance): verify-has-nothing-real-to-re-derive ⇒ under-sized, bundle
   it; verify-is-forced-to-do-new-build-work or mid-milestone-re-scope ⇒
   over-sized. "Independent re-derivation catches a real error sometimes"
   (m2, m4) is the in-band signal.

3. **Value-typed SELECT**: replace VT-only ranking at SELECT with an explicit,
   named value-type ledger so cross-type comparisons are structured, not ad hoc.
   At minimum name and record, per candidate: capability-growth (VT Δv̂),
   discovery value, instrument-correction value, risk/option value,
   governance-integrity value. VT Δv̂ remains ONE input, never the sole ranker —
   a milestone whose value is entirely off the VT axis (m2, m4 class) must be
   rankable without being forced to a fake VT number.

4. **Governance/infra hard floor**: for methodology/governance/infra milestones,
   the value-complete scope (enabling half + mechanical enforcement) is a
   size FLOOR — if the milestone cannot include it within budget, do NOT start a
   partial version (the DIR-006/DIR-002 lesson, generalized).

5. **Remove the cost-band squeeze**: update the charter template to cite the
   HARD-GATES block by hash (verified via the already-built
   `it0-gate-hash-check.sh`) instead of transcribing it verbatim, bringing
   charter thickness back under the 2K alarm so sizing is driven by the value
   unit, not by pressure to amortize fixed overhead.

Binary Done-when (mandatory, §3.4):
1. `[ ]` The size definition (item 1) and the verify-iteration size gauge
   (item 2) are written into `inherited-core.md`, and `OUTER-LOOP.md`'s SELECT
   step references them — pasted diff, not prose.
2. `[ ]` The next SELECT after this directive applies the value-typed ledger
   (item 3): its dashboard log entry names each candidate's value TYPE(s) and
   ranks across types explicitly, with VT Δv̂ shown as one input among several —
   pasted log entry as evidence.
3. `[ ]` Charter thickness for the first charter authored after this directive
   is under 2K with the HARD-GATES block cited by verified hash (item 5) —
   pasted `it0-gate-hash-check.sh` PASS + token/line count.
4. `[ ]` Governance/infra hard floor (item 4) recorded as a SELECT-time check
   (a candidate of that class with no enforcement half is rejected or resized,
   not dispatched partial).
5. `[ ]` Full existing test suite still passes (pasted raw output) — for any
   code touched (e.g. the charter-template / gate-hash tooling change).

This continues the same human-insight-frontier thread as DIR-001 and DIR-002:
milestone sizing and cross-type value comparison are exactly the judgments the
VT value function cannot make about itself — they must enter through the
`/quay-directive` channel at a milestone boundary, and terminate in the concrete,
falsifiable substrate changes enumerated above rather than in a sizing manifesto.

## Resolution (added when moved to archive/, or updated in place if deferred)

Renumbered DIR-003→DIR-004 at drain time (2026-07-18): this file's original id (DIR-003) collided
with the already-archived `DIR-003-m05-dir-projection-dogfoods-directive-task-projection.md`, a
different directive created earlier the same day as M05-dir-projection's own live dogfood
demonstration artifact. Content/scope otherwise unchanged from the original submission.

Applied immediately (not deferred) at the m5→m6 boundary: no inner milestone was in-flight when
this arrived (m5/M-DIR-PROJECTION had just been absorbed and checkpoint-1 written), so per the
standing rule ("pivot immediately if pre-dispatch, defer if mid-milestone with real work already
done", established at m4's drain), this went straight to SELECT rather than sitting in the backlog.

Opened as milestone **M-SIZING** (m6), charter at `charters/M06-sizing.md`, covering all 5 requested
scope items (size definition + verify-iteration gauge → `inherited-core.md`; value-typed SELECT
ledger + governance/infra hard floor → `inherited-core.md`/`OUTER-LOOP.md`; gate-hash-by-reference
charter template change demonstrated on a real charter) and all 5 Done-when clauses verbatim. See
`dashboard.md`'s m6 SELECT log entry for the value-typed reasoning applied to THIS SELECT itself
(dogfooding the very mechanism DIR-004 requests, one milestone ahead of the directive's own m7
target — the boundary where M-SIZING is being authored is itself a natural point to start using the
ledger informally, even before M-SIZING's own Done-when 2 formally requires it starting m7).
