# M36-dod-leakage-metrics — iteration-0 report

**Branch:** `exp5-m36-iteration-0` · **Base:** `exp5-outer-driver` @ `9a533d6` · **Commit:** `52b9c49`
**Worktree:** `experiments/quay-perpetual-stream/milestones/M36-dod-leakage-metrics/worktrees/iteration-0`

## 1. HARD GATES

Per the charter's by-reference gate-hash mode, the literal HARD GATES text is at
`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100-131 (not modified). Of the
four sub-gates in that block:

- **`ls experiments/quay-continuous-bootstrap/directives/pending/`** — this is the exp4 pending-
  directives path (referenced by the gate text, which is exp4-authored and applied here by
  reference/hash-pin per M25-M35's own established precedent, not literally re-scoped to exp5). The
  exp5-relevant analog is `experiments/quay-perpetual-stream/directives/pending/`, which contains
  exactly one file: `DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-
  verified-foothold.md`. Disposition: **applied** — this milestone IS DIR-017 Step 3, i.e. this
  milestone's entire scope is the disposition of that directive's remaining open item.
- **manda healthz gate** — **N/A this milestone**, exactly as the charter and task dispatch note
  state (no Web UI surface touched). Confirmed directly: `.manda/hub.addr` does not exist in this
  worktree (`cat` errored "No such file or directory") — there is no manda daemon instance to check
  in this method-infra-only milestone's execution context.
- **port-4173 reachability gate** — **N/A this milestone**, same reasoning. Ran it anyway for
  completeness: `curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"` returned `200`,
  but this is an unrelated process already listening on that port in this shared environment, not
  evidence of anything this milestone did or needs — no Web UI code was touched or needs to be
  verified live.
- **`git worktree add ... -b exp5-m36-iteration-N`** — already provisioned by the dispatcher before
  this iteration began (per the prompt's own stated worktree/branch). All edits in this iteration
  targeted paths under this worktree only; confirmed via `git status`/`git diff --stat` throughout.

## 2. Schema design

**Location: `inherited-core.md`, new "Deviation-record schema" section** (appended immediately after
the existing Definition-of-Done section, not a new sibling file). Reasoning stated in the section
itself: `v-meta-ledger.md` was split out as a sibling file because it has a genuinely DIFFERENT update
cadence than `dashboard.md`'s Log (edited whenever a confirmation count changes). A deviation log does
not share that rationale — by this schema's own design, deviations are discovered/resolved almost
entirely AT ABSORB boundaries, the SAME cadence the seven DoD clauses already collected in
`inherited-core.md` are evaluated at. Keeping the schema adjacent to the DoD clauses it measures also
lets a reader auditing Clause 1/5's real bite without switching files. The backfilled DATA (rows)
lives in `dashboard.md`'s new section; the SCHEMA (definitions) lives in `inherited-core.md` — this
split mirrors how `v-meta-ledger.md`'s own schema/definitions are split from `dashboard.md`'s health
track that reads them.

**Fields:** `id`, `title`, `origin-milestone`, `found-at`, `caught-by` (`machine` = an `it0-*` check
failing at run time OR an adversarial-audit subagent's CONCERNS-or-worse verdict — the audit role is
explicitly grouped under "machine" per DIR-017 Step 3's own wording, since it is a standing,
mechanically-dispatched process per Clause 1, not an ad hoc human read; `human` = a directive like
DIR-019/DIR-020 or a human-verification-gate finding), `status` (`found` → `fixed` →
`verified-eliminated`, where "verified-eliminated" is defined operationally per DIR-019 item 3's own
resolution discipline: fix confirmed by evidence EXTERNAL to the fixing milestone's self-report — a
re-run fixture/regression, a second independent iteration, or an out-of-band audit re-check), `age`.

**Age computation:** milestone-count spans (not calendar-date spans), reusing this stream's existing
`milestone_counter` unit — the same unit Clause 2's `milestones-since-confirmed` and Clause 5 already
use — rather than introducing a second unit of time. `age = found-at − origin-milestone` (latent-defect
span) and `age-to-resolution = verified-eliminated milestone − found-at milestone` (resolution span,
0 if resolved same-ABSORB as found).

**What qualifies as a deviation, explicitly bounded** (not "any bug"): included — a DoD-clause gap
that let a violation through undetected; a charter/ABSORB claim overstating a gate's applicability,
caught and corrected; a real defect found by an audit exercise against shipped work; a self-disclosed
process departure. Excluded — an ordinary same-ABSORB CONCERNS finding with no gate having been
silently bypassed; an honestly-recorded Δv=0/non-finding disposition (e.g. M35's Provider-ABI
ceiling-saturation note — that is accurate reporting, not a deviation).

**Usability self-test (not just curve-fit to the 5 backfilled examples):** I ran two synthetic-case
tests before treating the schema as done — (1) M35's honest "no VT headroom, Δv=0" disposition
correctly classifies as EXCLUDED (not a deviation) per the schema's own boundary test; (2) a
hypothetical future finding ("Clause 6's negation-window has the same regex gap Clause 7 had
pre-M32-fix, never checked") classifies cleanly: `caught-by=machine` (audit CONCERNS), `status`
lifecycle applies unchanged, `age` is computable from Clause 6's own origin milestone (m32). Both
synthetic cases resolved without needing to extend or special-case the schema.

## 3. Backfilled worked examples (5, best-effort — NOT exhaustive, stated explicitly in the artifact)

| id | title | caught-by | status | age-to-resolution |
|---|---|---|---|---|
| DEV-01 | M11 charter conflated "VT-scoring" with the adversarial-audit gate's precise conjunctive test | human (pre-DIR-017-era outer-loop ABSORB adjudication) | verified-eliminated | 0 |
| DEV-02 | ADV-004 path-traversal arbitrary-file-write (M26 adversarial/security audit) | machine (standing DIR-001-item-4 audit exercise) | verified-eliminated | 0 |
| DEV-03 | `it0-dod-check.mjs` Clause-5 carve-out dead code for Clauses 3/4 (DIR-019) | human (DIR-019 directive) | verified-eliminated | 0 (found-at→resolution); origin(m25)→found(m30) ≈ 5 ms latent span |
| DEV-04 | M30 single-commit execution, not standing two-iteration dispatch (self-disclosed) | human (self-disclosure, critically reviewed by the machine-class Clause-1 audit) | **fixed** (deliberately NOT promoted to `verified-eliminated` — the record explicitly declines to settle whether this may recur as policy) | 0 |
| DEV-05 | Clause 7 coverage-disposition regex negation-blind (M32 adversarial-audit fixture construction) | machine (Clause-1 adversarial-audit CONCERNS) | verified-eliminated | 0 |

Each row cites the actual `dashboard.md`/`inherited-core.md` line ranges re-verified directly against
source during authoring (not assumed from the charter's summary) — see the full table in
`inherited-core.md`'s "Deviation-record schema" section for the per-row evidence citations.

**DEV-04 is deliberately the schema's own worked example of a non-terminal `fixed` status** — I did not
force it to `verified-eliminated` just to make the backfill look cleaner; the actual dashboard.md text
explicitly says the process question was left open ("NOT to be codified as a standing exception
without a future consolidation pass explicitly deciding so"), so `fixed` is the honest classification.

## 4. The 4 metrics — real computed values, arithmetic shown

**(a) Deviations caught by machine vs human:** DEV-01=human, DEV-02=machine, DEV-03=human,
DEV-04=human, DEV-05=machine → **machine=2, human=3** (ratio 0.40:0.60, of 5 total).

**(b) Fraction reaching `verified-eliminated`:** DEV-01, DEV-02, DEV-03, DEV-05 are
`verified-eliminated`; DEV-04 is `fixed` → **4/5 = 80%**.

**(c) Median deviation age:** age-to-resolution for all 5 rows = [0, 0, 0, 0, 0] → **median = 0
milestones**. Stated honestly with a caveat, not hidden: this is a real, re-derivable number, but at
N=5 it is a weak signal, partly a selection artifact — the charter's 5 named examples are the
well-documented, already-resolved, same-ABSORB cases. A materially different, non-zero number exists
if the question is "how long did the defect sit latent before being caught" rather than "how long did
resolution take once caught": DIR-019's own origin(m25)→found(m30) span is **5 milestones**. Both
spans are recorded in the artifact so a future reader isn't misled by only the flattering zero.

**(d) Product-value shipped per K=5 milestones**, derived from `dashboard.md`'s own per-ABSORB
Realized Δv entries (I enumerated the ABSORB log for all 35 milestones m1-m35 and extracted every
genuine "Realized Δv" figure, excluding two explicitly-non-shipped-value entries: m3's +13.08 is a
one-time chart-basis expansion from adding the Provider-ABI surface, not delivered milestone work;
m4's −6.60 is an explicitly-stated measurement correction, not a capability regression, per m4's own
ABSORB text):
- Nonzero contributors: m1=+6.0, m8=+9.00, m9=+5.38, m12=+1.54, m29=+0.50, m33=+0.40. All other 27
  counted milestones (of 33 total counted, excluding m3/m4) = 0.
- **Full-stream:** total = 6.0+9.00+5.38+1.54+0.50+0.40 = **22.82**, over 33 counted milestones →
  22.82/33×5 ≈ **3.457 Δv per 5 milestones**.
- **Recent window (m29-m35, 7 milestones, the DIR-017-program-era window):** m29=+0.50, m33=+0.40,
  rest 0 → total = **0.90**, over 7 milestones → 0.90/7×5 ≈ **0.643 Δv per 5 milestones**.
- Both figures are reported (not one cherry-picked) because they answer different questions — the
  full-stream rate is front-loaded by m1/m8/m9/m12's early capability-growth milestones; the recent
  window shows the current rate under the now-mature, mostly-method-infra/governance regime (a
  deliberate cadence choice per `inherited-core.md`'s explore-cadence floor, not a value slowdown).

All four are computed and written directly into `dashboard.md`'s new "Homeostatic variables (DIR-017
Step 3)" section, with the same arithmetic shown above, not left as formulas or TBD.

## 5. Forward-update responsibility

Named explicitly in two places: `inherited-core.md`'s "Forward-update responsibility" subsection (new,
under the Deviation-record schema section) and a new sub-step **1b** inserted into `OUTER-LOOP.md`
step 6, immediately after the existing checklist write-back sub-step (1a). **The standing writer is
the Clause-1 per-milestone acceptance-audit subagent**, at its existing dispatch point (`OUTER-LOOP.md`
step 6, the same pass that already reads the ABSORB record end-to-end) — not a new, separately
scheduled process. This directly mirrors DIR-020/M34's own precedent: that milestone named the SAME
audit subagent as the standing checklist-tick writer at an already-existing dispatch point, rather than
inventing a new job. The same audit is also responsible, at EVERY subsequent ABSORB it runs (not only
the ABSORB where a row was created), for checking whether a `fixed`-status row has since accrued
external verification and should be promoted to `verified-eliminated` — mirroring Clause 2's
every-ABSORB re-check discipline for `v-meta-ledger.md` rows, so promotion is not stranded waiting for
a milestone that happens to reference the row directly.

## 6. Scope-decision confirmation (escrow-Δv N/A)

Per the charter's own explicit scope decision: this milestone ships the real doc/dashboard artifacts
directly — the schema in `inherited-core.md`, the 5 backfilled worked examples, the homeostatic-
variables section with real computed numbers in `dashboard.md`, and the forward-update-responsibility
statement in both `inherited-core.md` and `OUTER-LOOP.md`. This is NOT a design doc for later code —
there is no separate future "-IMPL" milestone that would ship the actual artifact; the artifact IS
what this milestone shipped. Re-confirmed by re-reading the actual diff (`git diff --stat`, below),
not assumed from the charter text. **Escrow-Δv (Clause 6) therefore does not apply, and no `-IMPL`
follow-up backlog row is required or was seeded.** This milestone also claims **no VT Δv** (Δv̂≈0,
methodology/governance-integrity, no VT chart cell — mirrors the DoD-program lineage's own established
precedent, M25/M30/M31/M32/M34), so Clause 6's trigger condition (design-only AND nonzero-Δv-claim)
does not fire on a second, independent basis even setting the design-only question aside.

## 7. Confirmation: no `packages/quay*` files touched (test-floor gate N/A)

```
$ git diff --stat
 experiments/quay-perpetual-stream/OUTER-LOOP.md    | 12 +++
 experiments/quay-perpetual-stream/dashboard.md     | 18 ++++
 .../quay-perpetual-stream/inherited-core.md        | 98 ++++++++++++++++++++++
 3 files changed, 128 insertions(+)
```

Three files, all under `experiments/quay-perpetual-stream/`, none under `packages/quay*`. Confirms
`surface:method-infra` per the charter's own DoD Clause-7 trigger-condition test — this milestone's
scope is exclusively non-product-touching. **Test-floor gate (Clause 7): N/A**, correctly stated, not
a self-exemption dodge (the trigger genuinely does not fire — verified directly from the diff, not
assumed).

## 8. Deviations from the charter's guidance, with justification

None material. Two minor points worth flagging for iteration-1/reconciliation review:

1. **Metric (d)'s two-figure presentation** (full-stream vs. recent-window) is my own addition beyond
   the charter's literal "cite the actual arithmetic" instruction — the charter did not specify which
   window to compute over. I chose to report both rather than picking one, on the reasoning that a
   single figure risks being either misleadingly high (front-loaded by early capability-growth
   milestones) or misleadingly low (the current regime deliberately runs more method-infra/governance
   milestones) in isolation. If iteration-1 computed a single figure differently, this is a genuine
   design choice to reconcile on the merits, not an error to silently prefer one side of.
2. **Median-age caveat (metric c)**: I reported the honest median (0) but flagged its weak-signal
   status at N=5 and cited the alternative origin-to-found span for DIR-019 (5 milestones) rather than
   only reporting the flattering same-ABSORB zero. This is a judgment call about honesty over a clean
   headline number, consistent with the charter's own "real numbers, not hand-waved arithmetic"
   instruction, but it is more caveat text than a bare number — stating this explicitly in case
   iteration-1 or the acceptance audit reads it as scope creep rather than required rigor.

No `packages/quay*` files touched (confirmed above). Manda healthz and port-4173 gates N/A (confirmed
above, no Web UI surface touched). Committed to `exp5-m36-iteration-0`, not pushed, not merged.
