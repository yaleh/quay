# M152 iteration-0 acceptance audit — DIR-091

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

**Date:** 2026-07-25
**Auditor:** adversarial-audit (Claude subagent via execute-milestone.js)
**Task:** DIR-091 — Extract shared gate-script framework
**Charter:** experiments/quay-perpetual-stream/charters/M152-dir091-gate-script-framework.md
**Implementation commit:** c379bda (M152 (DIR-091): extract shared gate-script framework)

## Verdict: CONCERNS

## AC Satisfaction

### AC 1: At least 5 check scripts refactored — CONFIRMED

8 scripts refactored to use the shared framework, confirmed via `git show c379bda --stat`:

| Script | Type | Framework usage |
|--------|------|-----------------|
| `task-schema-check.sh` | Thin wrapper | `source gate-script-lib.sh` + `gate_delegate_ts` |
| `vmeta-lag-check.sh` | Thin wrapper | `source gate-script-lib.sh` + `gate_delegate_ts` |
| `it0-dod-check.sh` | Thin wrapper | `source gate-script-lib.sh` + `gate_delegate_ts` |
| `audit-independence-check.sh` | Thin wrapper | `source gate-script-lib.sh` + `gate_delegate_ts` |
| `loadbearing-test-gate.sh` | Thin wrapper | `source gate-script-lib.sh` + `gate_delegate_ts` |
| `task-schema-selfcheck.sh` | Selfcheck | `source gate-script-lib.sh` + `gate_run_selfcheck` |
| `vmeta-lag-selfcheck.sh` | Selfcheck | `source gate-script-lib.sh` + `gate_run_selfcheck` |
| `audit-independence-selfcheck.sh` | Selfcheck | `source gate-script-lib.sh` + `gate_run_selfcheck` |

Evidence: file contents read directly from disk, all 8 scripts contain `source "$(dirname "$0")/gate-script-lib.sh"` and delegate to framework functions.

### AC 2: Framework includes reusable selfcheck test harness — CONFIRMED

`gate-script-lib.sh` lines 49-107 define `gate_run_selfcheck` — a complete fixture-based selfcheck harness. Supports:
- 3-field CASES format: `"id|fixture-file|expected-exit-code"` (no per-case extra args)
- 4-field CASES format: `"id|fixture-file|extra-args|expected-exit-code"` (with per-case extra args)

The harness auto-discovers the experiment root, validates the check command is executable, runs each fixture, asserts exit codes, prints PASS/FAIL per fixture, and exits 0/1 accordingly.

Evidence: `gate_run_selfcheck` is used by all 3 refactored selfcheck scripts (task-schema-selfcheck.sh, vmeta-lag-selfcheck.sh, audit-independence-selfcheck.sh) and they all pass their respective fixture suites (14/14, 8/8, 7/7).

### AC 3: New gate scripts created post-milestone use the framework — UNVERIFIABLE

No post-milestone gate scripts exist yet. The milestone created the framework files themselves (`gate-script-lib.sh`, `gate-script-base.ts`) and refactored 8 existing scripts — it did not create any net-new gate scripts that leverage the framework. This criterion is forward-looking and structurally unverifiable at audit time, matching the pattern of DIR-096 AC-2 (M148) and DIR-089 AC-3 (M151). The framework is well-documented and functional, but the criterion demands future evidence this audit cannot supply.

### AC 4: Line-count reduction >=200 — CONFIRMED

Independently verified via `git show c379bda --numstat -- experiments/quay-perpetual-stream/scripts/`:

| Script | Additions | Deletions | Reduction |
|--------|-----------|-----------|-----------|
| audit-independence-check.sh | 10 | 34 | 24 |
| audit-independence-selfcheck.sh | 17 | 59 | 42 |
| it0-dod-check.sh | 6 | 30 | 24 |
| loadbearing-test-gate.sh | 10 | 30 | 20 |
| task-schema-check.sh | 6 | 24 | 18 |
| task-schema-selfcheck.sh | 23 | 60 | 37 |
| vmeta-lag-check.sh | 6 | 27 | 21 |
| vmeta-lag-selfcheck.sh | 15 | 51 | 36 |
| **Total (refactored only)** | **93** | **315** | **222** |

222 >= 200. Confirmed. The two framework files (gate-script-lib.sh 137L, gate-script-base.ts 127L) are excluded from the reduction count as per the criterion's wording ("across refactored scripts").

## DoD Satisfaction

### Per-task DoD items:

1. `gate-script-lib.sh` created with arg parsing, YAML reading, and output formatting — **CONFIRMED**. 137 lines, contains `gate_delegate_ts` (arg parsing + delegation), `gate_read_yaml_field` (YAML frontmatter reading), `gate_emit_pass`/`gate_emit_fail` (output formatting), plus `gate_run_selfcheck` (reusable selfcheck harness).

2. `gate-script-base.ts` created with equivalent TS primitives — **CONFIRMED**. 127 lines, contains `parseArgs` (CLI arg parsing with flag support), `readFrontmatter` (YAML frontmatter reading), `emitPass`/`emitFail` (output formatting), `requireArg` (argument validation), `isDirectEntry` (CLI entry detection).

3. At least 5 check scripts refactored — **CONFIRMED**. 8 scripts refactored.

4. All refactored scripts pass their selfchecks — **CONFIRMED**. Live-run results:
   - `task-schema-selfcheck.sh`: PASS (14/14 fixtures)
   - `vmeta-lag-selfcheck.sh`: PASS (8/8 fixtures)
   - `audit-independence-selfcheck.sh`: PASS (7/7 fixtures)
   - `dod-fixture-selfcheck.sh`: PASS (17/17 fixtures — depends on refactored `it0-dod-check.sh`)

5. Line-count reduction >=200 — **CONFIRMED**. 222 lines reduced.

6. AC items independently verified by adversarial audit — **CONFIRMED for items 1, 2, 4**. AC item 3 is forward-looking and unverifiable; logged as a deviation.

### inherited-core.md DoD clauses:

| Clause | Verdict | Notes |
|--------|---------|-------|
| 0 (AC+DoD checklist) | PASS | Checkboxes written back by this audit |
| 1 (adversarial audit) | PASS | This audit |
| 2 (V_meta) | N/A | Task declares N/A; no disposition in absorb entry (see deviation) |
| 3 (line budget) | N/A | Methodology milestone, no code budget |
| 4 (impl-row) | N/A | Task declares N/A |
| 5 (no-self-exemption) | PASS | No undeclared self-exemption language found |
| 6 (escrow Δv) | N/A | Task declares N/A |
| 7 (test floor) | CONCERNS | Selfchecks pass but no test-coverage disposition or WAIVER in absorb entry (see deviation) |
| 8 (canonical-lifecycle-record) | N/A | Task lacks `milestone:M<N>` label — legacy/unlabeled, predates DIR-014 item 6 |
| 9 (needs-human) | N/A | Task declares N/A |
| 10 (tree-hygiene) | PASS | No un-gitignored scratch in main tree |
| 11 (worktree-branch-hygiene) | PASS | No orphaned milestone evidence in un-merged iteration branches |
| 12 (audit-independence) | PASS | Audit artifact exists at milestones/M152/audits/iteration-0-acceptance-audit.md; session ID 28186b2d-f609-457d-8a6e-0b74f410e3be |

## Mechanical Gate

`it0-dod-check.sh DIR-091 ...` exits **1** with 5 FAILs:

1. **clause0-ac-dod-present** — AC checkboxes were unchecked (expected; this audit writes them back)
2. **clause1-adversarial-audit** — No disposition in ABSORB entry (expected; this IS the adversarial audit)
3. **clause2-vmeta-lag** — No disposition in ABSORB entry (task declares N/A but absorb entry needs explicit N/A statement)
4. **clause7-test-floor** — No test-coverage disposition or WAIVER (methodology milestone with no product-touching code needs explicit WAIVER)
5. **clause12-audit-independence** — Audit artifact did not exist (expected; this audit creates it)

Failures 1, 2, 12 are chicken-and-egg — addressed by this audit pass. Failures 2 (clause 2) and 4 (clause 7) are genuine gaps: the ABSORB entry needs explicit N/A or WAIVER disposition statements for these clauses.

## Deviations

See dashboard.md "Homeostatic variables (DIR-017 Step 3)" table for logged deviation rows:

1. **CONCERNS / machine / M152** — AC #3 forward-looking and unverifiable (same pattern as DIR-096 AC-2, DIR-089 AC-3)
2. **CONCERNS / machine / M152** — Mechanical gate clauses 2 (V_meta) and 7 (test-floor) need WAIVER/disposition in ABSORB entry
