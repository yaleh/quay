# M181 Iteration-0 Acceptance Audit — exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Audit posture:** adversarial / refute-first. Fresh context — no prior exposure to this build.
**Date:** 2026-07-27

## Verdict: NO REFUTATION FOUND

Every Acceptance Criterion and Definition-of-Done item was independently re-derived from
concrete artifacts (source diff, live test run, live `select-preflight.ts` execution against the
real task store) — not taken from the implementer's self-report. The mechanical gate
(`it0-dod-check.sh`) exits 0. No refutation survived.

---

## 1. AC Satisfaction (refute-first)

### AC1 — "Fixture: an epic with all children done except one human-steered child → NOT in shortlist"

Attempted refutation: does the fixture actually exercise the real DIR-070 shape, or is it a toy
that doesn't generalize?

- `select-preflight.test.mjs` "M181 case 2 (epic-with-human-steered-only-child) GREEN" test
  constructs an epic with one `done` child and one `todo` + `label:human-steered` child, and
  asserts `isEpicBlockedByHumanSteeredChildren(...) === true`. Ran directly:
  `node --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs` → **30/30 pass**,
  including this test.
- Independently re-derived against the REAL DIR-070 data (not the fixture) by calling the
  exported function directly with DIR-070's actual 6 children (`DIR-070-A..E: status=done`,
  `DIR-070-F: status=todo, labels=[human-steered]`, confirmed via `grep "^status:"
  tasks/DIR-070-*.md`):
  ```
  isEpicBlockedByHumanSteeredChildren(...) → DIR-070 epic blocked: true
  ```
- Live full-run confirmation: `node --experimental-strip-types
  experiments/quay-perpetual-stream/scripts/select-preflight.ts --json --workspace-root . --milestone-counter 172`
  against the current, unmodified task store → the `candidates` array (14 entries, the
  already-filtered autonomous shortlist) contains **no DIR-070 entry at all**.

**Could not refute. CONFIRMED.**

### AC2 — "Fixture: a directly-labeled human-steered task in the raw candidate pool → NOT in shortlist"

Attempted refutation: does the OR-in-the-label logic actually fire on a real `label: human-steered`
task, or only on the synthetic fixture string?

- `select-preflight.test.mjs` "M181 case 1 (direct label) GREEN" test: `computeHumanSteered(...,
  ["human-steered"], ...)` → `humanSteered: true`, `detail` matches
  `/label:human-steered \(direct\)/`. Ran and PASSED (part of the same 30/30 run above).
- Independently re-derived against the REAL current candidate pool: DIR-057, DIR-113, DIR-114,
  DIR-115, DIR-116 all carry `label: human-steered` directly (confirmed via `grep -A5
  "^labels:" tasks/DIR-*.md`). Called `computeHumanSteered` directly on each:
  ```
  DIR-057  → humanSteered: true, detail: "...; label:human-steered (direct)"
  DIR-113  → humanSteered: true, detail: "...; label:human-steered (direct)"
  DIR-114  → humanSteered: true, detail: "...; label:human-steered (direct)"
  DIR-115  → humanSteered: true, detail: "...; label:human-steered (direct)"
  DIR-116  → humanSteered: true, detail: "...; label:human-steered (direct)"
  ```
- Live full-run confirmation: the same real `select-preflight.ts --json` run's `candidates` array
  contains **none of DIR-057/DIR-113/DIR-114/DIR-115/DIR-116** — all 5 correctly excluded.
- Regression counter-check (no over-broad exclusion): DIR-099/100/101/103/104/105/110/111/112
  (none carrying `label: human-steered`, confirmed via grep) all appear in the shortlist with
  `humanSteered: false` — the fix does not blanket-exclude unrelated candidates.

**Could not refute. CONFIRMED.**

### AC3 — "Existing select-preflight tests still pass"

Attempted refutation: were any pre-existing tests silently deleted, weakened, or renamed to make
room for the new ones (a common way to fake "tests still pass")?

- `git show a8b3c0f -- experiments/quay-perpetual-stream/test/select-preflight.test.mjs`: diff is
  **strictly additive** — `grep -c "^+test("` = 9 new test blocks, `grep -c "^-test("` = 0 removed.
  No existing `test(...)` block's body was touched.
- Full suite re-run by this audit: `node --test
  experiments/quay-perpetual-stream/test/select-preflight.test.mjs` → **30 pass, 0 fail, 0
  skipped** (21 pre-existing + 9 new M181 tests, all present and green).

**Could not refute. CONFIRMED.**

## 1a. Checklist write-back (DIR-020)

All 3 AC items and all 3 DoD items ticked `- [x]` in
`tasks/exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK.md` with inline evidence citations (this
audit's own edit, not the implementer's). `clause0-ac-dod-present` in the mechanical gate output
below independently confirms "3/3 checked".

---

## 2. DoD Satisfaction

1. **"Fix landed in `human-steered-classify.ts` and/or `select-preflight.ts`, tests green"** —
   commit `a8b3c0f` touches `select-preflight.ts` only (+187/-5 lines); `human-steered-classify.ts`
   is untouched, matching the charter's explicit out-of-scope declaration ("Classifier itself
   untouched per charter scope"). 30/30 tests green (re-run above). CONFIRMED.
2. **"A real select-preflight run against the current task store no longer surfaces DIR-057 or
   DIR-070 in its shortlist"** — live run performed by this audit (not the implementer's report),
   confirmed above; extended to also cover DIR-113/114/115/116 per the milestone charter's wider
   scope. CONFIRMED.
3. **"Satisfies the standard DoD clauses in inherited-core.md's DoD section"** — verified via the
   mechanical gate (§3 below): exit 0, all applicable clauses PASS or correctly N/A. CONFIRMED.

**DoD satisfied.**

## 2a. Disposition append (M180 gap fix)

Before running the mechanical gate, appended to `/tmp/m181-absorb-entry.md`:
```
adversarial-audit disposition: NO REFUTATION FOUND
V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward
```
The second line is the verbatim tail output of the real command this audit ran:
`bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 171
experiments/quay-perpetual-stream/v-meta-ledger.md` (milestone_counter in dashboard.md's header =
172; `172 - 1 = 171`), exit 0. The script's own two ledger-row lines
(`[ok] consolidated ...` / `[ok] proposed ...`) are the underlying detail; the appended summary
line is its final `PASS:` line, copied verbatim, not paraphrased.

---

## 3. Mechanical Gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
    exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK \
    experiments/quay-perpetual-stream/charters/M181-select-preflight-human-steered-leak.md \
    /tmp/m181-absorb-entry.md

PASS: clause0-ac-dod-present: task AC has 3 checkable clause(s) (checklist-form, 3/3 checked); DoD references the standard
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS — scope within the small-milestone norm
PASS: clause4-impl-row: PASS — impl-row gate does not apply
PASS: clause5-no-self-exemption: no undeclared self-exemption language found
PASS: clause6-escrow-delta-v: N/A — milestone is not design-only
PASS: clause7-test-floor: N/A — surface label(s) [method-infra] are exclusively non-product-touching
PASS: clause8-task-canonical-lifecycle-record: N/A — legacy/unlabeled task
PASS: clause10-tree-hygiene: PASS — clean
PASS: clause11-worktree-branch-hygiene: PASS — clean
PASS: clause12-audit-independence: N/A — no '## Audit-independence check' section (documented no-op)
N/A: clause9-split-or-commit: no needs-human outcome declared — N/A

PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
Exit code: 0
```

**Exit 0 → not REFUTED by construction.**

Note on clause12: the absorb entry has no `## Audit-independence check` section pointing at an
audit artifact, because the mechanical gate was deliberately run (per this audit's own step
ordering) *before* this artifact was written. This is expected sequencing, not a defect — the
clause itself treats the absence as an accepted "documented no-op" (N/A, non-blocking), and the
overall gate still exits 0.

---

## 4. Deviation-log write-back

**Not applicable.** Verdict is NO REFUTATION FOUND — no REFUTED/CONCERNS row required per the
audit charge's own conditional ("if you find a REFUTED or CONCERNS").

One process observation, non-blocking, recorded here for completeness rather than as a dashboard
deviation row (does not rise to CONCERNS — task status remaining `todo` on master is the expected
pipeline state at this point: this audit runs *before* Land/lifecycle-promotion in the
execute-milestone pipeline, matching every other milestone's audit-time snapshot).

---

## 5. Regression check (Done-when #5, charter)

Confirmed no over-broad exclusion: candidates without `label: human-steered` and with a clean
classifier verdict (DIR-099, DIR-100, DIR-101, DIR-103, DIR-104, DIR-105, DIR-110, DIR-111,
DIR-112 — none carry the label, confirmed via direct grep of each task file's `labels:` block)
all still appear in the live shortlist with `humanSteered: false`. The fix is precise, not a
blanket exclusion.

---

## Summary

| Item | Result |
|---|---|
| AC1 (epic fixture) | CONFIRMED — fixture + real-data re-derivation + live run |
| AC2 (direct-label fixture) | CONFIRMED — fixture + real-data re-derivation + live run |
| AC3 (existing tests pass) | CONFIRMED — 30/30, diff strictly additive |
| DoD1 (fix landed, tests green) | CONFIRMED |
| DoD2 (real run excludes DIR-057/070) | CONFIRMED (extended to DIR-113/114/115/116) |
| DoD3 (standard DoD clauses) | CONFIRMED via mechanical gate exit 0 |
| Mechanical gate | PASS, exit 0 |
| Regression (no over-broad exclusion) | CONFIRMED |

**Final verdict: NO REFUTATION FOUND.**
