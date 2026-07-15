# Iteration 8 — Same-Session Mechanical Audit (G3)

**Status: same-session, NOT independent.** Written by the same session that
performed this iteration's execution work. Per this experiment's established
pattern (iterations 0-7), this is the mechanical co-sign only; the
genuinely independent, out-of-band audit (G3's actual requirement) is
dispatched separately, by the orchestrator, after this report is filed.

## Re-verified this iteration

1. **The V_meta formula correction itself.** Independently re-read
   `docs/proposal/quay-bootstrap-experiment.md` line 129 and
   `experiment/README.md` line 96: both genuinely specify
   `V_meta = completeness × effectiveness × reusability × validation` — a
   product. Independently re-derived the historical recomputation in
   `experiment/provenance.md` by hand from each iteration's own reported
   component values (read directly from `experiment/iterations/
   iteration-{0..7}.md`, not merely copied from this iteration's own
   draft): iteration 0 (0.20, 0.0, 0.0, 0.20) → product 0.0000; iteration 4
   (0.60, 0.20, 0.55, 0.45) → product 0.0297; iteration 7 (0.72, 0.20,
   0.55, 0.60) → product 0.0475. All match the published table exactly.
   Confirmed no amendment to the protocol's V_meta formula exists anywhere
   in its own §10 resolved-decisions log — the mean was never a documented
   decision.

2. **QN-019 (author->ready gate checked-state fix).** Re-ran
   `gate-checked-state.test.mjs` fresh: 13/13 pass. Re-ran the `git stash`
   TDD proof fresh this same session (not merely citing the earlier run):
   `git stash push -- packages/quay-native/src/store.js`, re-ran the test
   — genuinely 4 failures (CS-B and CS-C, exactly the intended new-behavior
   cases: "checkboxes present but 0 checked now fails the gate" and
   "partially-checked AC fails the gate"), `git stash pop`, re-ran — 13/13
   green. Re-ran the full existing regression suite fresh: `compound-
   gate.test.mjs`, `compound-gate-recursive.test.mjs`, `abi-symmetry.mjs`
   (all four surfaces symmetric), `gate-correctness.test.mjs`,
   `lock.test.mjs`, `cas-write.test.mjs` — all green.
   - **Verified the GC-C regression-fix claim directly:** read
     `gate-correctness.test.mjs`'s GC-C fixture source, confirmed it now
     uses `- [x] ...` (checked) boxes with an explanatory comment citing
     QN-019/iteration 8, not silently altered without record.
   - **Live re-check of all 17 pre-existing real task files** (QN-001
     through QN-017) via `task check <id> --json`: all report the same
     status/gate outcome as before this iteration's gate change — zero
     regression, confirming the tightened `todo` gate does not
     retroactively affect tasks already past `todo`.

3. **QN-020/QN-021 (executeEpic's needs-human branch).** Independently
   re-ran `quay-native task check QN-021 --json` fresh: reproduces
   `{"id":"QN-021","gate":"author->ready","ok":false,"acTotal":2,
   "acChecked":1,"reason":"1/2 AC checkboxes checked"}` exactly as
   reported. Read the raw markdown of `QN-021.md`'s AC section directly:
   confirmed item 1 is genuinely `- [ ]` (unchecked), item 2 is genuinely
   `- [x]` (checked) — not merely claimed. Independently re-ran
   `quay-native task check QN-020 --json` fresh: reproduces
   `{"id":"QN-020","gate":"none","ok":false,"reason":"soft stop; human
   action required"}` exactly as reported. Confirmed `QN-020.md`'s
   frontmatter `status: needs-human` is a real, valid status
   (`store.js`'s `VALID_STATUSES` array includes it).
   - **Honesty check on the "deliberately unsatisfiable" claim:** re-ran
     `ToolSearch` independently this same session for a subagent-dispatch
     primitive; found none, matching the report's own claim (8th
     consecutive confirmation).
   - **Verified the self-referential 0/2-to-1/2 finding directly:**
     confirmed via the live gate-check output above that `acChecked` is
     genuinely `1`, matching the report's claim that checking QN-021's own
     AC item 2 changed the gate's own live count — not an invented detail.
   - **Verified the "single-child epic, honestly declared exception"
     claim:** read QN-020.md's "Decompose-test honesty note" section
     directly, confirmed it is present and prominently states the
     single-child exception, not silently omitted.

4. **Regression re-run of the complete test suite** (all `.mjs`/`.test.mjs`
   files across both packages, `abi-symmetry.mjs` included): all green.

## Net assessment

No fabricated claims found. QN-019's gate fix is real and TDD-proven;
QN-020/QN-021's `needs-human` outcome is genuinely mechanical, not
narrated — the gate really did block QN-021 at `author->ready`, and
QN-020's status flip to `needs-human` is a real, valid state transition
matching `executeEpic`'s own documented Method. The V_meta formula
correction is arithmetically sound, faithfully sourced from each
iteration's own reported component values, and genuinely traceable to the
ratified protocol text (never amended).

**This is not a substitute for a genuinely independent, out-of-band
audit.** The real check satisfying protocol §7 criterion 4 is dispatched
externally by the orchestrator after this report is filed, per the
established pattern. Given the significance of the V_meta formula
correction, that independent audit should pay particular attention to
independently re-deriving the historical recomputation table from each
iteration's own primary-source component values, not merely trusting this
same-session audit's own re-derivation.
