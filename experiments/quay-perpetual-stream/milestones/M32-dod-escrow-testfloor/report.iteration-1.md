# M32-dod-escrow-testfloor — iteration-1 report

Independent-convergence iteration. Did NOT read iteration-0's report or worktree, or the
`exp5-m32-iteration-0` branch, at any point.

## §1. What I built

Two new mechanically-enforced DoD clauses (Clause 6 escrow-Δv, Clause 7 product-work test-floor)
added to `inherited-core.md`'s "Definition of Done" section, following the existing four-field
template (Trigger condition / What it checks / Pass/fail semantics / Current invocation point),
mechanically checked by `it0-dod-check.mjs`, with 4 new fixtures + assertions in
`dod-fixture-selfcheck.sh`, `OUTER-LOOP.md` step 6 text updated to name both, and status-mirror
notes added to `tasks/DIR-017.md` + the DIR-017 pending file (DIR-017's own `status:` left `pending`).

### Design decisions

**Clause 6 (escrow-Δv) — documentation-discipline check, mirroring Clauses 1/2, NOT Clauses 3/4's
shell-out-to-existing-script pattern.** There is no pre-existing standalone script that computes
"is this Δv escrowed" the way `it0-ceiling-line-budget-check.sh`/`it0-impl-row-check.sh` already
existed for Clauses 3/4 to wrap — this clause is genuinely new logic, so I built it directly inside
`it0-dod-check.mjs` as a documentation-discipline check (scans the ABSORB-entry text for a
disposition, does not re-derive the Δv figure's own correctness), same shape as Clauses 1/2.

Trigger: reuses Clause 4's own design-only marker set (`design delivered` / `design-doc only` /
`design only` / `design (doc only)` / "Done-when clauses a future implementing milestone would
need"), scanned **only against the materialized backlog-row text**, never charter prose — this
was a genuine bug I caught during my own fixture testing (see §5 below). Fires only when a nonzero
`Δv=` figure is also present in the ABSORB-entry's VT-curve-append text.

Check: requires escrow/provisional language (`ESCROWED`, `PROVISIONAL`, or `provisional
until ... ship/absorb`) within a 200-character window on either side of each nonzero Δv match.

**Clause 7 (test-floor) — same documentation-discipline pattern.** Trigger: a product-touching
`surface:` label on the backlog row (`cli`, `web-ui`, `provider-abi`, `mcp`, or a composite label
containing any of these as a dash-joined component, e.g. `surface:cli-mcp-webui-docs`). Non-firing
labels: `method-infra`, `docs`, `cross-cutting`, `packaging`. Check: requires either (a) a
coverage-with-evidence statement (a ≥80% figure paired with actually-run test evidence language,
e.g. `node --test` output or a pass count) or (b) a dated `WAIVER: <id> | test-floor | <reason> |
<date>` line, mirroring Clause 5's own waiver-line shape.

Both clauses were added to `it0-dod-check.mjs`'s `dispositionedClauses` set (as `escrow-deltav`
and `test-floor`) but were NOT added to Clause 5's `MECHANICALLY_UNCONDITIONAL_CLAUSES` set — they
are dispositioned *conditionally* (both branches — trigger-fired and trigger-not-fired — call
`dispositionedClauses.add`, same as Clauses 1/2, not Clauses 3/4's unconditional-every-run
pattern), so this mirrors Clauses 1/2's legitimate-non-firing carve-out under Clause 5, not
Clauses 3/4's DIR-019-fixed always-requires-waiver behavior. I judged this correct because a
milestone's genuine non-firing (not design-only, or no product-touching surface) is a real,
independently-recorded state determined by the milestone's own backlog row content — not something
a charter could trivially narrate its way out of the way DIR-019 found for line-budget/impl-row
(those two fire on literally every run, so "already dispositioned" was vacuous; Clauses 6/7's
non-firing is conditioned on real backlog-row content that a self-exemption claim would have to
contradict).

## §2. HARD GATES (literal output)

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md
```
Disposition: DIR-017 — Step 2 in progress via this milestone; DIR stays `pending` per its own
clearance-note text; Step 3 remains open for a future SELECT.

```
$ cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
http://localhost:46215
{"root":"/home/yale/work/quay"}
```

```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```
N/A for this milestone's own scope (no web UI component in M32) — port 4173 is an ambient
pre-existing dev server unrelated to this milestone's work; stated explicitly, not silently
omitted.

```
$ git -C experiments/quay-perpetual-stream/milestones/M32-dod-escrow-testfloor/worktrees/iteration-1 rev-parse --abbrev-ref HEAD
exp5-m32-iteration-1

$ git -C experiments/quay-perpetual-stream/milestones/M32-dod-escrow-testfloor/worktrees/iteration-1 log --oneline -1
135d3ec M32-dod-escrow-testfloor iteration-1: DIR-017 Step 2 — Clause 6 (escrow-Δv) + Clause 7 (product-work test-floor)
```

## §3. Evidence per Done-when clause

**1. Clause 6 (escrow-Δv) authored in `inherited-core.md`.** `experiments/quay-perpetual-stream/inherited-core.md`
lines 1006-1032 (`### Clause 6 — Escrow-Δv gate (DIR-017 Step 2 / M32-dod-escrow-testfloor)`),
four-field template, cross-references DIR-017 Step 2's verbatim text and this milestone.

**2. Clause 7 (test-floor) authored.** Same file, lines 1044-1067 (`### Clause 7 — Product-work
test-floor gate (DIR-017 Step 2 / M32-dod-escrow-testfloor)`), same template.

**3. `it0-dod-check.mjs` mechanically checks both.** `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs`
— Clause 6 block (search `Clause 6: Escrow-Δv gate`), Clause 7 block (search `Clause 7:
Product-work test-floor gate`), both wired into the same `failures`/`passes` arrays and the same
exit-1-on-any-failure contract at the bottom of the script (unchanged). Both are
documentation-discipline checks (see §1 design-decisions above for why, vs. the
mechanically-unconditional shell-out pattern of Clauses 3/4).

**4/5. Fixtures + full suite green, synthetic violating/compliant stubs behave as expected.**
```
$ bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh
PASS: M98-fake-compliant — exit 0 (expected 0) [fixtures/dod/compliant-stub.md]
PASS: M99-fake-violating — exit 1 (expected 1) [fixtures/dod/violating-stub.md]
PASS: M96-fake-linebudget-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-linebudget-stub.md]
PASS: M95-fake-implrow-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-implrow-stub.md]
PASS: M94-fake-missing-ac — exit 1 (expected 1) [fixtures/dod/missing-ac-stub.md]
PASS: M93-fake-escrow-violating — exit 1 (expected 1) [fixtures/dod/escrow-deltav-violating-stub.md]
PASS: M92-fake-escrow-compliant — exit 0 (expected 0) [fixtures/dod/escrow-deltav-compliant-stub.md]
PASS: M91-fake-testfloor-violating — exit 1 (expected 1) [fixtures/dod/test-floor-violating-stub.md]
PASS: M90-fake-testfloor-compliant — exit 0 (expected 0) [fixtures/dod/test-floor-compliant-stub.md]

PASS: all 9 DoD fixtures behaved as asserted.
```
Exit code 0. Existing 5 fixtures' file content confirmed byte-identical (`git diff --stat` on the
5 pre-existing fixture files against the merge-base returns empty). New fixtures:
`fixtures/dod/escrow-deltav-violating-stub.md`, `fixtures/dod/escrow-deltav-compliant-stub.md`,
`fixtures/dod/test-floor-violating-stub.md`, `fixtures/dod/test-floor-compliant-stub.md`. Each
violating fixture was constructed as a SINGLE, ISOLATED violation of exactly one new clause (all
other clauses given explicit clean dispositions), verified by running `it0-dod-check.mjs` on each
standalone and confirming the FAIL line names only the intended clause.

**6. `OUTER-LOOP.md` step 6 updated, no drift.** `experiments/quay-perpetual-stream/OUTER-LOOP.md`'s
"DoD meta-enforcer gate" sub-step now names all 7 clauses by number (`Clause 1
adversarial-audit, Clause 2 V_meta-lag, Clause 3 line-budget, Clause 4 impl-row, Clause 5
no-self-exemption, Clause 6 escrow-Δv, Clause 7 product-work test-floor`) and adds parenthetical
trigger-condition notes for Clauses 6/7 (mirroring the existing Clause-3 parenthetical). Re-read
both files side by side after editing: `inherited-core.md`'s `### Clause N` headings (grep
`^### Clause`) list exactly 0-7 with the same names as `OUTER-LOOP.md`'s prose list — no
renumbering, no name drift.

**7. `git diff --stat` scoped correctly.**
```
$ git diff --stat exp5-outer-driver...HEAD
 experiments/quay-perpetual-stream/OUTER-LOOP.md    |  29 +++--
 .../directives/pending/DIR-017-...-foothold.md     |  18 +++
 .../fixtures/dod/escrow-deltav-compliant-stub.md   |  59 ++++++++++
 .../fixtures/dod/escrow-deltav-violating-stub.md   |  68 ++++++++++++
 .../fixtures/dod/test-floor-compliant-stub.md      |  53 +++++++++
 .../fixtures/dod/test-floor-violating-stub.md      |  62 +++++++++++
 .../quay-perpetual-stream/inherited-core.md        |  96 ++++++++++++++--
 .../scripts/dod-fixture-selfcheck.sh               |   8 ++
 .../scripts/it0-dod-check.mjs                      | 123 ++++++++++++++++++++-
 tasks/DIR-017.md                                   |   9 +-
 10 files changed, 499 insertions(+), 26 deletions(-)
```
All 10 files are in the explicitly permitted scope list. This report is written outside the
worktree per instructions (not counted in the worktree's own diff). Real repo-root `tasks/`
directory confirmed untouched by any test run (`git status --short -- tasks/` at repo root
returns empty before and after all test execution — I used `/tmp/*.md` scratch files for the 3
ad hoc regex-validation probes in §5, never the real `tasks/` dir).

**8. Full test suite green before and after.**
- `dod-fixture-selfcheck.sh`: exit 0, both before my changes (5/5 fixtures) and after (9/9
  fixtures).
- `it0-dir-projection-check.sh experiments/quay-perpetual-stream`: exit 0 before and after my
  `tasks/DIR-017.md` + DIR-017 pending-file edits — `PASS: 19 DIR file(s) checked against 17
  label:directive task(s) ... no divergence`.
- `packages/quay` test suite: no vitest devDependency/config found in this repo (confirmed via
  `packages/quay/package.json` — no `"scripts"` block, no `vitest` dependency); the actual test
  command used throughout this experiment (confirmed against `M31-cli-gate-enforcement`'s own
  iteration-1 report) is `node --test packages/*/test/*.test.mjs`. Ran this BEFORE any of my edits
  (baseline) and AFTER (post-commit): both runs show **51-53 tests, 2-3 failures**, all in
  `provider-abi-conformance.test.mjs` and/or `serve-github.test.mjs` (network/GitHub-API-dependent
  tests — confirmed by inspecting `serve-github.test.mjs`'s own failure output, which shows a
  live-GitHub-content assertion failing while every locally-derivable assertion in the same file
  passes). I touched ZERO files under `packages/` (confirmed: `git status --short --
  packages/` returns empty) — these failures are pre-existing environment noise, not a
  regression I introduced. No new failures appeared after my changes; the exact same two files
  fail in both runs.

## §4. DIR-017 status update

`tasks/DIR-017.md`'s body and status-mirror line, and the pending file's own new "Step 2 status
note" section (added below the existing "Human-verification gate — CLEARED" section, NOT
replacing or editing that section), both record: Step 1 delivered (M25), Step 2 delivered by this
milestone (Clause 6/7 landed + mechanically enforced), Step 3 (leakage metrics) remains open and
separately selectable. DIR-017's own `status:` YAML field and its `extra.dirStatus` remain
`pending`, unchanged, per its own clearance-note text ("clearing the gate only unlocks Steps 2/3
for a future SELECT; it does not complete them"). The file was NOT moved to `archive/`.

## §5. Genuine discovery / self-skepticism (per the charter's explicit instruction)

I deliberately tried to construct violating fixtures rather than fixtures shaped to pass, and this
caught two real bugs in my own first-draft implementation before I finalized anything:

1. **False-negative on Clause 6 (design-only detection matched charter prose, not just the
   backlog row).** My first-draft `escrow-deltav-violating-stub.md` fixture used
   `compliant-stub.md`'s style of writing a charter narrative that explicitly says "this is NOT
   design-only: no 'design delivered' wording..." — when I first ran the compliant-stub.md
   fixture against my draft Clause 6 code, it wrongly reported "milestone IS design-only", because
   my regex was scanning the WHOLE charter text (`charterText`), which contains the negated phrase
   "design delivered" inside a sentence explaining the milestone is NOT design-only. I fixed this
   by restricting Clause 6's design-only detector to `backlogRowText` only — the same restriction
   `it0-impl-row-check.sh` (Clause 4) already correctly applies, which I should have copied more
   carefully the first time rather than reusing the broader `charterText` variable already in
   scope.

2. **False PASS on my own targeted violating fixture (my own explanatory prose leaked escrow
   language into the ABSORB-entry section under test).** My first-draft
   `escrow-deltav-violating-stub.md` was designed to FAIL Clause 6 (nonzero Δv, no escrow
   language) but actually exited 0 (PASS) when I first ran it. The cause: my own commentary
   *inside* the `## ABSORB-entry excerpt` section (the exact text `it0-dod-check.mjs` scans)
   explained, in prose, "deliberately NO escrow/provisional wording appears... (no "ESCROWED",
   "PROVISIONAL"...)" — and my own escrow-detection regex's 200-character proximity window around
   the Δv figure happened to include that meta-commentary, which itself CONTAINS the strings
   "ESCROWED" and "PROVISIONAL" (quoted, in a sentence saying they're absent). This is exactly the
   kind of self-defeating fixture-construction hazard the milestone charter warned about — a naive
   fixture author writes explanatory prose inside the very section under mechanical test, and the
   prose itself satisfies the pattern it's trying to demonstrate the ABSENCE of. I fixed it by
   moving that explanation out of the `## ABSORB-entry excerpt` section into the fixture's
   top-level (extracted-away) commentary, leaving the actual ABSORB-entry text terse and free of
   any escrow-adjacent vocabulary. This is a genuine, reusable lesson for future fixture authors:
   don't describe what a fixture is testing for INSIDE the exact section a text-scanning regex
   will read.

**A design choice I am not fully confident is optimal:** Clause 6's 200-character proximity
window (for "is there escrow language near the Δv figure") is a heuristic, not a precise parse of
which specific Δv figure a given escrow marker modifies. A milestone claiming BOTH an escrowed
design-only Δv AND an unrelated confirmed Δv from a different sub-component in the same ABSORB
entry, with the escrow marker positioned near the wrong one, could produce a false PASS or false
FAIL depending on exact text layout. I judged this an acceptable heuristic (same class of
imprecision Clauses 1/2's own regex-proximity checks already accept, and no real ABSORB entry in
`dashboard.md` currently has this multi-Δv-in-one-entry shape to test against), but flag it
explicitly as a possible refinement point for a future tightening pass, rather than asserting
false confidence that the 200-char window is exactly right.

## §6. Isolation proof (end of iteration)

```
$ git -C experiments/quay-perpetual-stream/milestones/M32-dod-escrow-testfloor/worktrees/iteration-1 status --short
(empty — clean)

$ git -C experiments/quay-perpetual-stream/milestones/M32-dod-escrow-testfloor/worktrees/iteration-1 diff --stat exp5-outer-driver...HEAD
 experiments/quay-perpetual-stream/OUTER-LOOP.md    |  29 +++--
 .../directives/pending/DIR-017-...-foothold.md     |  18 +++
 .../fixtures/dod/escrow-deltav-compliant-stub.md   |  59 ++++++++++
 .../fixtures/dod/escrow-deltav-violating-stub.md   |  68 ++++++++++++
 .../fixtures/dod/test-floor-compliant-stub.md      |  53 +++++++++
 .../fixtures/dod/test-floor-violating-stub.md      |  62 +++++++++++
 .../quay-perpetual-stream/inherited-core.md        |  96 ++++++++++++++--
 .../scripts/dod-fixture-selfcheck.sh               |   8 ++
 .../scripts/it0-dod-check.mjs                      | 123 ++++++++++++++++++++-
 tasks/DIR-017.md                                   |   9 +-
 10 files changed, 499 insertions(+), 26 deletions(-)

$ git status --short -- tasks/   # from repo root, confirming real repo-root tasks/ untouched
(empty)
```

Only in-scope files changed; the repo-root `tasks/` directory (distinct from the worktree's own
`tasks/DIR-017.md`, which IS in scope) is confirmed untouched.
