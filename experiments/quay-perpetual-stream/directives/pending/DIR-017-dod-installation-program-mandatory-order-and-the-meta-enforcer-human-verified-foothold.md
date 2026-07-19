# DIR-017

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Install the missing Definition of Done as an ORDERED program on the running exp5 stream — self-host the record first, then a single standing mechanically-enforced non-self-exemptible DoD meta-enforcer (the load-bearing foothold, human-verified operative before anything else proceeds), then the remaining clauses, then the leakage metrics — resolving the self-referential bootstrapping risk that the drifting mechanism will otherwise install its own DoD as shelfware

## Finding

`docs/proposals/exp6-driving-and-self-correcting-a-perpetual-stream.md` diagnoses
that exp5 has per-charter Acceptance Criteria (Binary Done-when) but no global
Definition of Done, and that this single absence is the root of the post-m9 drift
(Goodhart on "milestones closed" + the "enforcement half never built" pattern). The
same proposal argues — and this conversation confirmed — that **no new experiment
is required; the DoD can be installed incrementally via DIRs on the running exp5
stream** (it is already happening: DIR-016 → M21 landed the first DoD clause, the
`-IMPL`-row enforcer; DIR-014 → m22 is building the task-to-plan skill).

But there is a **self-referential bootstrapping risk**: the mechanism whose disease
is "designs never become operative" is the same mechanism being asked to install
its own cure, so the DoD clauses are at high risk of being delivered as shelfware by
the very drift they are meant to end. Live evidence this session:

- DIR-012 (proposal→plan) fed through exp5 produced M17 *design* + M18 a
  *bypassable* gate — designed-not-wired, the disease reproducing on the cure.
- Even the successful DIR-016/M21, which enforced one clause, immediately re-deferred
  DIR-015 item 2 ("build the self-hosting") to "that new row's own future SELECT" —
  a DoD-clause execution that spawned another deferred-to-never.

Therefore **order is load-bearing**: until a mechanical, standing, non-self-
exemptible enforcer exists and is confirmed operative, every subsequent DoD clause
delivered by DIR is at the mercy of the same drift. You cannot trust the drifting
loop to install its own brakes; it needs one human-verified mechanical foothold
first, after which it can govern the rest autonomously.

## Requested action

Establish DoD installation as an **ordered program with hard prerequisites** (not a
free-for-all of parallel DIRs), and build its load-bearing step. The mandatory
order:

- **Step 0 — self-host the record** (DIR-015 impl / `M-TASK-BACKLOG-PROJECTION-IMPL`,
  already materialized by M21's sweep): one queryable ledger. *You cannot enforce a
  DoD over records you cannot query in one place.* Prerequisite to a standing check.
- **Step 1 — THE META-ENFORCER (this DIR's core, load-bearing):** author a single
  unified **Definition of Done** in `inherited-core.md` that:
  1. **Collects the existing gates as named clauses** — the adversarial-audit gate
     (DIR-007/M10), the V_meta consolidation-lag gate (DIR-005/M07), the plan-time
     line-budget gate (M18), and the `-IMPL`-row enforcer (DIR-016/M21) — so they
     stop being scattered conditional shrapnel and become one checklist.
  2. Adds the **no-self-exemption meta-clause**: no milestone/charter may narrow,
     reinterpret, or exempt itself from the DoD (directly closes the Goodhart hole
     that let M11 argue itself out of the audit gate and let design milestones
     self-certify).
  3. Is a **STANDING mechanical check, not boundary-only** — an `it0`-style script
     (exit 0/1/2, fixture-testable, mirroring `scripts/it0-*.sh`) that any milestone
     must clear, run at ABSORB **and** as a standing check between boundaries, that
     **HARD-BLOCKS `milestone_counter++`** if unmet.
  4. **Governs forward, sweeps backward**: applies to all new milestones; past
     design-only debt is handled by DIR-016's retroactive sweep, so this composes
     cleanly with the still-running stream without invalidating in-flight work.
- **Step 2 — the remaining DoD clauses**, each its own selectable `-IMPL`/charter,
  added only AFTER step 1 is confirmed operative: the **escrow-Δv clause** (a design-
  only milestone's Δv is provisional until its `-IMPL` ships — counters Goodhart at
  the metric), and the **product-work test-floor clause** (product-touching work
  carries real tests ≥80%, actually run). Now safe to add incrementally because the
  step-1 enforcer catches any delivered as shelfware.
- **Step 3 — the leakage metrics** onto `dashboard.md` as homeostatic variables:
  deviations caught by machine vs human; fraction of recorded deviations reaching
  `verified-eliminated`; median deviation age; product-value shipped per K
  milestones (the exp6 meta-objective made measurable).

**Human-verification gate (irreducible, not delegable):** Step 1's meta-enforcer must
be confirmed by a human to be *operative, not merely designed* — i.e. it actually
blocks a synthetic violating milestone — **before** steps 2 and 3 proceed. This is
the one bootstrap step the drifting loop cannot self-guarantee; once the mechanical
foothold is human-confirmed live, the rest can proceed autonomously under it.

## Human verification when exp5 marks this DIR done

Do NOT trust the DONE mark; check that the enforcer is real, not designed:
1. **It exists as executable, not prose.** A new `scripts/it0-dod-*.{sh,mjs}` (or
   equivalent) exists and runs; `inherited-core.md` has a single "Definition of Done"
   section, not scattered gate references.
2. **It actually blocks.** Run it against a *synthetic violating* milestone (e.g. a
   design-only milestone stub with no `-IMPL` row, or one asserting a self-exemption)
   — it must exit non-zero / FAIL. Then a compliant stub — it must PASS. If it only
   ever passes, it is shrapnel, not a gate.
3. **It is wired into the loop as a HARD block.** `OUTER-LOOP.md`'s ABSORB step
   references it as blocking `milestone_counter++`, in the same shape as the existing
   V_meta-lag / audit HARD blocks — not merely "recommended".
4. **The three existing gates are folded in**, not left as separate conditional
   checks (grep `inherited-core.md`: they should now be clauses of the DoD).
5. **The no-self-exempt clause is present and testable** — the synthetic self-
   exemption case in check #2 fails.
6. Only after #1–#5 hold do you greenlight steps 2–3. If any fail, the DoD went in
   as shelfware — the exact failure this DIR exists to prevent; send it back.

## Human-verification gate — CLEARED (2026-07-19, human: Yale Huang)

**The irreducible, non-delegable human-verification gate is PASSED. Steps 2 and 3
are hereby GREENLIT for SELECT.** This DIR's `status:` stays `pending` — clearing
the gate only unlocks Steps 2/3 for a future SELECT; it does not complete them.
Do NOT treat this note as a resolution or move the file to `archive/`.

This clearance is grounded, not a rubber stamp: Step #5 of the checklist above
was found FAILING when first verified (2026-07-19) — the meta-enforcer's clause 5
was blind to a self-exemption of the line-budget and impl-row gates, because those
two clauses were dispositioned unconditionally and clause 5 skipped any already-
dispositioned clause. That defect was filed as **DIR-019**, fixed by
**M30-dod-clause5-blind-spot-fix** (published to `master` at `a96ff23`,
`milestone_counter` 29→30), and re-verified by a human against the published
`master` snapshot before this clearance. The fix landed in the enforcer code, not
the fixtures.

Evidence — all 6 checklist points now hold (re-run 2026-07-19 in a detached
worktree off `master`@`a96ff23`):

- **#1 executable, not prose:** `scripts/it0-dod-check.{sh,mjs}` are a real bash +
  node script pair; `inherited-core.md` has exactly ONE `## Definition of Done`
  section (line ~853).
- **#2 it actually blocks / #5 no-self-exempt is testable:** the external,
  human-authored red test `scripts/dod-fixture-selfcheck.sh` now exits 0 with the
  fixtures UNCHANGED (`git diff 8432a67 HEAD` on both `self-exempt-*` fixtures is
  empty; the fix diff is in `it0-dod-check.mjs`, +15/−9):

  ```
  PASS: M98-fake-compliant — exit 0 (expected 0)
  PASS: M99-fake-violating — exit 1 (expected 1)
  PASS: M96-fake-linebudget-self-exempt — exit 1 (expected 1)
  PASS: M95-fake-implrow-self-exempt — exit 1 (expected 1)
  PASS: all 4 DoD fixtures behaved as asserted.
  ```

  Run singly, each self-exempt fixture now FAILs with clause 5 naming the exempted
  gate (`... exempts "line-budget" ...` / `... exempts "impl-row" ...`, both
  exit 1), and `compliant-stub.md` still exits 0 (legitimate no-ops not
  false-failed).
- **#3 wired as a HARD block:** `OUTER-LOOP.md` step 6 has the "DoD meta-enforcer
  gate (DIR-017 / M25-dod-meta-enforcer, HARD BLOCK on step 7's
  `milestone_counter++`)" sub-step — `milestone_counter++` MUST NOT run until it
  PASSes.
- **#4 the four existing gates are folded in:** `inherited-core.md` has Clause 1
  (adversarial-audit), Clause 2 (V_meta-lag), Clause 3 (line-budget), Clause 4
  (impl-row) as named clauses, plus Clause 5 (no-self-exemption).

The acceptance predicate for any future Step 2/3 work remains external
(`dod-fixture-selfcheck.sh` green with fixtures unchanged); the DoD gate's own
PASS must not be used as evidence that Step 2/3 clauses are wired, per this DIR's
own text.

## Resolution
<!-- added when moved to archive/, or updated in place if deferred:
- resolved_by: iteration-N / milestone M-NN
- outcome: applied | deferred | rejected
- evidence: pointer to the design doc / iteration report section / commit -->

**Disposition note (M23-outer-driver-isolation, both iterations, 2026-07-18, NOT a
resolution — this DIR stays `pending`, status unchanged):** M23's charter
explicitly names this DIR's scope (the Definition-of-Done meta-enforcer program)
as OUT of scope, verbatim in its "Explicitly OUT of scope" section: "Do not touch
DIR-017's scope ... that is a separate, larger, human-verification-gated program;
this milestone is purely the git-topology/process fix DIR-018 names, independent
of DIR-017's own ordering." M23 performs no work toward any of DIR-017's steps
0-3 and does not touch `inherited-core.md` (confirmed by this milestone's own
`git diff --stat` evidence). Deferred, out of scope for M23 — remains open for a
future milestone's own SELECT/charter.

**Disposition note (M32-dod-escrow-testfloor, iteration-0, 2026-07-19, NOT a
resolution — this DIR stays `pending`, status unchanged):** Step 2 is now
**in-progress / delivered by M32** — the two Step 2 clauses named above (escrow-Δv,
product-work test-floor) are authored as Clause 6 and Clause 7 in
`inherited-core.md`'s "Definition of Done" section, mechanically implemented in
`scripts/it0-dod-check.mjs`, and regression-covered by 4 new fixtures under
`fixtures/dod/` wired into `scripts/dod-fixture-selfcheck.sh` (9/9 fixtures PASS,
original 5 unchanged). `OUTER-LOOP.md` step 6's DoD meta-enforcer gate text now
names Clauses 6/7 explicitly. Per this DIR's own clearance-note text, clearing the
human-verification gate only unlocked Step 2 for SELECT — it does not itself
complete Step 2, and this note records that a milestone has now done so; the
external acceptance predicate (`dod-fixture-selfcheck.sh` green, fixtures
unchanged) is the evidence, not this DoD gate's own self-report. **Step 3 (leakage
metrics onto `dashboard.md`) remains open and separately selectable** — M32 does
not touch it. This DIR's `status:` frontmatter stays `pending`; do not archive or
flip to done on the strength of M32 alone.
