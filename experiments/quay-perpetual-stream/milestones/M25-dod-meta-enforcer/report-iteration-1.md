# M25-dod-meta-enforcer — iteration-1 report

Independent re-derivation pass. Built entirely from `charters/M25-dod-meta-enforcer.md` alone —
iteration-0's report/materials/commits were never read or referenced during this build.

## Hard gates (literal output, gathered before any edits)

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md
```
Only DIR-017 pending, as the charter's "Note for ABSORB" requires.

```
$ pwd && git branch --show-current
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M25-dod-meta-enforcer/worktrees/iteration-1
exp5-m25-iteration-1
```

Correct worktree, correct branch, off `exp5-outer-driver` HEAD `e3d31ec`, before any edits.

## What was built, per phase

Phase 1: `inherited-core.md` gained a new `## Definition of Done` section (138 inserted lines) with
Clauses 1-4 (adversarial-audit / V_meta-lag / line-budget / impl-row, each with
trigger/what-it-checks/pass-fail/invocation-point) and Clause 5 (no-self-exemption meta-clause,
defining the waiver-line shape `WAIVER: <milestone-id> | <clause-name> | <one-line reason> |
<date>`).

Phase 2: `scripts/it0-dod-check.mjs` (278 lines) + `.sh` wrapper (30 lines) + fixtures under
`fixtures/dod/`: `violating-stub.md` (61 lines, triple violation), `compliant-stub.md` (51 lines,
all clauses PASS).

Phase 3: new "DoD meta-enforcer gate" sub-step wired into `OUTER-LOOP.md` step 6, positioned after
the impl-row gate and before the driver→master publish sub-step (28 changed lines); end-to-end
re-verification against both fixtures plus a self-check against M25's real charter via a drafted
ABSORB-entry excerpt (`fixtures/dod/m25-self-check-absorb-entry.md`, 36 lines).

## Done-when clauses — evidence

1-2. `git diff --cached --stat inherited-core.md` → `138 insertions(+)`, containing Clauses 1-5.
PASS.

3-4. `wc -l scripts/it0-dod-check.mjs` → 278, executable; `wc -l scripts/it0-dod-check.sh` → 30,
executable, thin wrapper delegating to the `.mjs`. Usage error exits 2:
```
$ ./scripts/it0-dod-check.sh
Usage: ./scripts/it0-dod-check.sh <milestone-id> <charter-file> <absorb-entry-file>
EXIT=2
$ ./scripts/it0-dod-check.sh foo /nonexistent/file /nonexistent/file2
ERROR: charter-file not found: /nonexistent/file
EXIT=2
```
PASS.

5. `wc -l fixtures/dod/violating-stub.md fixtures/dod/compliant-stub.md` → 61, 51. PASS.

6. Violating fixture:
```
$ ./scripts/it0-dod-check.sh M99-fake-violating fixtures/dod/violating-stub.md fixtures/dod/violating-stub.md
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS — PASS: fixtures/dod/violating-stub.md — scope within the small-milestone norm ...
FAIL: clause1-adversarial-audit: NO disposition statement found in ABSORB-entry text ...
FAIL: clause4-impl-row: FAIL — FAIL: M99-fake-violating is design-only (row text contains 'design delivered'), but no 'M99-fake-violating-IMPL' row was found ...
FAIL: clause5-no-self-exemption: charter's "Explicitly OUT of scope" section exempts "adversarial-audit" with NO matching WAIVER line found ...
FAIL: DoD check failed — 3 clause violation(s) found (see above).
EXIT=1
```
Triple violation (exceeds the charter's required double-violation minimum: impl-row FAIL +
undeclared self-exemption FAIL, plus an independently-real adversarial-audit disposition-missing
FAIL). PASS.

7. Compliant fixture:
```
$ ./scripts/it0-dod-check.sh M98-fake-compliant fixtures/dod/compliant-stub.md fixtures/dod/compliant-stub.md
PASS: clause1-adversarial-audit: disposition statement present (documented no-op)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS ...
PASS: clause4-impl-row: PASS ...
PASS: clause5-no-self-exemption: no undeclared self-exemption language found ...
PASS: DoD check passed — all clauses satisfied (5 disposition(s) confirmed), no undeclared self-exemption.
EXIT=0
```
PASS.

8. `OUTER-LOOP.md` diff:
```
$ git diff --cached --stat experiments/quay-perpetual-stream/OUTER-LOOP.md
 experiments/quay-perpetual-stream/OUTER-LOOP.md | 28 ++++++++++++++++++----
 1 file changed, 22 insertions(+), 6 deletions(-)
```
New "DoD meta-enforcer gate" sub-step inserted between the impl-row gate and the driver→master
publish sub-step; publish sub-step's own header prose and step 7's dashboard-update text updated to
reference the new gate consistently. PASS.

9. Re-ran both fixtures post-Phase-3 — identical output to clauses 6 and 7 above (the invocation
shape referenced by the new `OUTER-LOOP.md` sub-step is exactly what was run). PASS.

10. Self-check against M25's own real charter:
```
$ ./scripts/it0-dod-check.sh exp5-M-DOD-META-ENFORCER charters/M25-dod-meta-enforcer.md fixtures/dod/m25-self-check-absorb-entry.md
PASS: clause1-adversarial-audit: disposition statement present (documented no-op)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS ...
PASS: clause4-impl-row: PASS ...
PASS: clause5-no-self-exemption: no undeclared self-exemption language found ...
PASS: DoD check passed — all clauses satisfied (5 disposition(s) confirmed), no undeclared self-exemption.
EXIT=0
```
Cross-checked directly against the two underlying scripts:
```
$ ./scripts/it0-impl-row-check.sh exp5-M-DOD-META-ENFORCER backlog.md
PASS: exp5-M-DOD-META-ENFORCER is not design-only per its backlog row text ... EXIT=0
$ ./scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M25-dod-meta-enforcer.md   # run from worktree root
PASS: ... GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source ... EXIT=0
```
PASS.

11. Full test suite. A fully concurrent run showed a single failure
(`packages/quay/test/cli-edit-parity-conformance.test.mjs`); isolated re-run of that file passed
cleanly (1/1, 0 fail). To rule out a concurrency flake decisively, re-ran the full suite
sequentially:
```
$ node --test --test-concurrency=1 "packages/quay/test/**/*.test.mjs" "packages/quay-github/test/**/*.test.mjs" "packages/quay-native/test/**/*.test.mjs" 2>&1 | grep -E "^(✔|✖)"
✔ packages/quay-github/test/cli.test.mjs (9767.846482ms)
✔ packages/quay-github/test/compound-gate.test.mjs (54.544109ms)
✔ packages/quay-github/test/gate-gameability.test.mjs (55.817817ms)
✔ packages/quay-github/test/gate.test.mjs (59.706447ms)
✔ packages/quay-github/test/mcp-server.test.mjs (16060.85316ms)
✔ packages/quay-github/test/pagination.test.mjs (54.575906ms)
✔ packages/quay-github/test/task-check-passthrough.test.mjs (15614.453898ms)
✔ packages/quay-github/test/view-model.test.mjs (77.665948ms)
✔ packages/quay-github/test/write.test.mjs (74.13819ms)
✔ packages/quay-native/test/cas-write.test.mjs (410.488683ms)
✔ packages/quay-native/test/compound-gate-recursive.test.mjs (182.733603ms)
✔ packages/quay-native/test/compound-gate.test.mjs (160.016284ms)
✔ packages/quay-native/test/create-validation.test.mjs (585.735678ms)
✔ packages/quay-native/test/edit-validation.test.mjs (693.331594ms)
✔ packages/quay-native/test/gate-checked-state.test.mjs (154.402938ms)
✔ packages/quay-native/test/gate-correctness.test.mjs (198.941758ms)
✔ packages/quay-native/test/gate-gameability.test.mjs (172.790717ms)
✔ packages/quay-native/test/lock.test.mjs (538.65296ms)
✔ packages/quay/test/action-mock-delivery.test.mjs (98.796581ms)
✔ packages/quay/test/cli-edit-parity-conformance.test.mjs (48253.355244ms)
✔ packages/quay/test/cli.test.mjs (52202.704057ms)
✔ packages/quay/test/config.test.mjs (152.942591ms)
✔ packages/quay/test/core-three-way-symmetry.test.mjs (7681.35639ms)
✔ packages/quay/test/mcp-server.test.mjs (39262.369251ms)
✔ packages/quay/test/provider-abi-conformance.test.mjs (54442.935406ms)
✔ packages/quay/test/provider-env-symmetry.test.mjs (1889.962598ms)
✔ packages/quay/test/serve-action-delivery.test.mjs (134.59118ms)
✔ packages/quay/test/serve-browser-render.test.mjs (1338.574106ms)
✔ packages/quay/test/serve-github.test.mjs (3759.329947ms)
✔ packages/quay/test/serve.test.mjs (27445.866748ms)
✔ packages/quay/test/task-check.test.mjs (2448.141541ms)
✔ packages/quay/test/web-ui-browser.test.mjs (5270.881595ms)
```
All 32 files `✔`, 0 `✖`, process exit 0. `cli-edit-parity-conformance.test.mjs` passes cleanly
under `--test-concurrency=1`, confirming the earlier concurrent-run failure was a
concurrency/timing flake, not a regression. No product/test files were touched by this milestone's
changes. PASS, no regressions.

12. `git diff --cached --stat`:
```
 experiments/quay-perpetual-stream/OUTER-LOOP.md                            |  28 ++-
 .../fixtures/dod/compliant-stub.md                                         |  51 ++++
 .../fixtures/dod/m25-self-check-absorb-entry.md                            |  36 +++
 .../fixtures/dod/violating-stub.md                                         |  61 +++++
 experiments/quay-perpetual-stream/inherited-core.md                        | 138 ++++++++++
 experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs                | 278 +++++++++++++++++++++
 experiments/quay-perpetual-stream/scripts/it0-dod-check.sh                 |  30 +++
 7 files changed, 616 insertions(+), 6 deletions(-)
```
Exactly the expected files, plus one additional fixture (`m25-self-check-absorb-entry.md`) needed
to supply the drafted ABSORB-entry excerpt for Done-when clause 10's real-charter self-check (the
charter's Stage 3.3 explicitly calls for a drafted excerpt of this kind, since the outer loop's own
ABSORB has not yet run). No unrelated product code touched. PASS.

## Explicit ABSORB-style gate dispositions (charter-required)

**Adversarial-audit gate:** documented no-op. Condition (a) (VT-scoring, nonzero realized Δv) does
not apply — this milestone is typed governance-integrity with Δv̂=0 by design, no VT chart cell,
realized Δv confirmed zero. Condition (b) (iteration-0 recommending skipping iteration-1) did not
fire — this iteration ran regardless per the standard 2-iteration pattern, and never read
iteration-0's materials (consistent with independent re-derivation). Neither condition fired; gate
is a documented no-op for this ABSORB.

**V_meta consolidation-lag gate:** clear. `v-meta-ledger.md` has 2 rows: domain-audit-channel≡CI-job
pattern (`consolidated`, m7) and repo-root isolation-leak lesson (`proposed`, 1 confirmation only).
No row is `confirmed`-but-not-`consolidated`, so nothing to check against K=2. Gate clears.

**Design-only-milestone impl-row gate:** N/A — this milestone is NOT design-only; it ships
operational artifacts (working DoD section, script pair wired as HARD BLOCK, fixtures), not a
design doc with a follow-up checklist. `it0-impl-row-check.sh exp5-M-DOD-META-ENFORCER backlog.md`
→ PASS (N/A), pasted above under clause 10. No `-IMPL` row created or needed.

**DIR-017 disposition:** Step 1 artifact delivered (`inherited-core.md` DoD section, `it0-dod-check`
script pair, 3 fixtures, `OUTER-LOOP.md` wiring) — awaiting human confirmation per DIR-017's own
irreducible verification-gate clause before Steps 2-3 may be SELECTed. DIR-017 remains `pending`;
this iteration did not mark it applied/archived and did not create/SELECT any Step-2/3 candidate
row — confirmed unchanged by the `ls -1 directives/pending/` hard gate.

## Deviations, difficulties, and judgment calls (honest notes)

The charter explicitly asked for genuine adversarial construction on the fixtures. Real findings
surfaced during the build, not hypothetical risks:

1. **Ambiguous no-op phrasing caused a false PASS on the violating fixture initially.** "does not
   apply" near "adversarial-audit" appeared both in the deliberate self-exemption line and an
   unrelated explanatory note, so clause 1 wrongly passed. Fixed by rewording so the self-exemption
   line is purely exemption-shaped and the explanatory note carries no no-op trigger words.

2. **File-aliasing caused a false PASS on clause 5.** When charter-file and absorb-entry-file point
   at the same combined-fixture file, an early version scanned the whole file for both roles,
   letting the charter's exemption language and the ABSORB-entry's disposition text bleed together
   and hide a real gap. Fixed with `extractSection()`, isolating each role's own sub-section.

3. **`extractSection()` had a truncation bug**: stopping at ANY heading depth truncated the
   "Charter excerpt" section at its own nested `### Deliverable` subheading, dropping the
   "Explicitly OUT of scope" content the self-exemption scan needed. Fixed by tracking the matched
   heading's own depth and stopping only at a same-or-shallower heading.

4. **My own fixture prose accidentally satisfied its own waiver-pattern regex** — an illustrative
   sentence literally contained the string `WAIVER: M99-fake-violating | adversarial-audit | ...`
   as an example of what's absent, which the detection regex then matched, falsely passing clause
   5. Fixed by describing the absence without using the literal waiver-line syntax.

5. **Most significant finding — the real-charter self-check (Done-when clause 10) exposed a real
   gap in the original clause 5 heuristic**, not just a fixture artifact. Against M25's own real
   charter, clause 5 flagged its legitimate line ("the design-only-milestone impl-row gate does not
   apply to it (self-check per Phase 3)") as an undeclared self-exemption, even though this is a
   textbook-legitimate non-firing statement, and the drafted ABSORB-entry text correctly
   dispositions the impl-row clause as N/A for the same reason. Pure textual pattern-matching
   cannot distinguish justified non-firing from narrated-away exemption on text alone. Fixed by
   adding a `dispositionedClauses` Set, populated whenever clauses 1-4 record ANY outcome (pass,
   fail, or N/A) — clause 5 now skips flagging a clause that already has a recorded disposition
   anywhere, mechanizing `inherited-core.md`'s own stated distinguishing test. Verified via
   mutation testing (stripping the disposition back out) that clause 5 still correctly fires when a
   clause is exempted AND has no disposition recorded anywhere. This finding came directly from
   testing against a REAL charter rather than only synthetic fixtures, exactly why the charter's
   Stage 3.3 required it.

6. **Test-suite flake investigation** required an extra full sequential re-run beyond the isolated
   single-file pass to decisively rule out regression, in the spirit of the charter's own
   skepticism instruction (documented under Done-when clause 11 above).

7. **`it0-ceiling-line-budget-check.sh` reports "No phase/stage plan required"** even though the
   charter explicitly declares and uses the ceiling-expansion regime — because the script's
   item-count proxy counts the charter's top-level "In-scope work" list, compressed to 3 items by
   phase-grouping. Not a bug (script logic was explicitly out of scope to modify); noted as a real
   observation from running the check against a real charter.

No blocking difficulties. All 12 Done-when clauses satisfied with pasted evidence above.
