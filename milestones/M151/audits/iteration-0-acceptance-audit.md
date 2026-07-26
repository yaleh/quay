# M151 Iteration 0 Adversarial Acceptance Audit — DIR-089

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

**Task:** DIR-089 — Safe JSON parse guard for experiment gate scripts
**Charter:** experiments/quay-perpetual-stream/charters/M151-dir089-safe-json-parse.md
**Date:** 2026-07-25
**Auditor:** adversarial-acceptance-audit agent (DIR-017 Step 1)

## Acceptance Criteria verification

### AC 1: Reusable `safe_json_parse` function exists in `experiments/quay-perpetual-stream/scripts/`

**VERDICT: CONFIRMED**

Evidence:
- File `experiments/quay-perpetual-stream/scripts/safe-json-parse.sh` exists on disk (2077 bytes, committed in `f2c722c`)
- Contains `safe_json_parse` function (lines 21-48): validates file argument, checks file existence, checks non-empty, parses JSON via python3 with try/except
- Contains `safe_json_parse_from_stdin` function (lines 53-67): reads stdin, checks non-empty, parses JSON with try/except
- All 7 independent smoke tests pass: valid file (exit 0), empty file (exit 1, descriptive error), invalid JSON (exit 1, descriptive error), missing file (exit 1, descriptive error), valid stdin (exit 0), empty stdin (exit 1, descriptive error), invalid stdin (exit 1, descriptive error)

### AC 2: All experiment gate scripts that parse JSON use the guard

**VERDICT: CONFIRMED**

Evidence:
- Only one shell script under `experiments/quay-perpetual-stream/scripts/` had inline JSON parsing: `restart-readiness-check.sh`
- `restart-readiness-check.sh` line 46: `source "$SCR/safe-json-parse.sh"` — sources the guard
- `restart-readiness-check.sh` line 56: `| safe_json_parse_from_stdin 2>/dev/null` — uses the guard between quay CLI output and node filter
- No other `.sh` files have the vulnerable `python3 -c "json.load(...)"` pattern (`grep -rn 'python3.*json\.load' --include='*.sh' | grep -v safe-json-parse.sh` returns empty)
- TypeScript gate scripts (`outward-vt-check.ts`, `rolling-slope-check.ts`, `governance-product-ratio-check.ts`, `deliverable-governor.ts`, `drain-scheduler.ts`) each use `try/catch` around `JSON.parse()` — Node.js error handling, not the python3 JSONDecodeError pattern identified in the finding

### AC 3: Meta-cc query for `JSONDecodeError` over 14 days post-fix shows count = 0

**VERDICT: UNVERIFIABLE — forward-looking criterion**

The fix was committed on 2026-07-25 (commit `f2c722c`). The 14-day observation window has not elapsed. This criterion demands future evidence that cannot be supplied at audit time. Same structural pattern as DIR-096 AC-2 (M148 deviation row, dashboard.md line 473: "structurally unverifiable at audit time — the criterion demands future evidence this audit cannot supply").

This criterion should be restructured: either define a pre-fix baseline window + verify the guard was deployed to all vulnerable call sites (already done via AC 1 and AC 2), OR defer the 14-day post-fix check to a follow-up verification pass.

## Definition of Done verification

| DoD item | Verdict | Evidence |
|---|---|---|
| `safe-json-parse.sh` created with both functions | CONFIRMED | File exists; 7 smoke tests pass |
| All identified JSON-parsing gate scripts refactored | CONFIRMED | restart-readiness-check.sh refactored; no other .sh scripts had the vulnerable pattern |
| Selfchecks pass for all modified scripts | CONFIRMED | Iteration report: task-schema-selfcheck (14/14), dod-fixture-selfcheck (17/17), vmeta-lag-selfcheck (8/8) all green |
| AC items independently verified by adversarial audit | IN PROGRESS | This audit |

## Mechanical gate (it0-dod-check.sh)

**Result: FAIL (exit code 1)** — 6 clause violations reported.

However, many failures are pre-existing infrastructure issues, not DIR-089 defects:

| Clause | Result | Assessment |
|---|---|---|
| clause0-ac-dod-present | FAIL | **False positive.** Task lookup at `it0-dod-check.ts:175` uses `milestoneId` as filename (`tasks/M151.md`), but actual file is `tasks/DIR-089.md`. The real task file HAS both AC and DoD sections. Pre-existing infrastructure issue. |
| clause1-adversarial-audit | FAIL | ABSORB entry missing disposition statement. Template deficiency, not DIR-089 defect. |
| clause2-vmeta-lag | FAIL | ABSORB entry missing disposition statement. Template deficiency, not DIR-089 defect. |
| clause3-line-budget | PASS | Charter within small-milestone norm. |
| clause4-impl-row | PASS | Not design-only. |
| clause5-no-self-exemption | PASS | No undeclared self-exemption language. |
| clause6-escrow-delta-v | N/A | Not design-only. |
| clause7-test-floor | FAIL | Expected — no product-touching code in this instrument-correction milestone. |
| clause8-task-canonical-lifecycle-record | N/A | No milestone label on task. |
| clause9-split-or-commit | N/A | No needs-human outcome. |
| clause10-tree-hygiene | PASS | Clean tree. |
| clause11-worktree-branch-hygiene | PASS | Clean branches. |
| clause12-audit-independence | FAIL | Circular — this audit artifact is being written now. |

## Additional finding: Acceptance gate misconfiguration

The `extra.acceptance` field in `tasks/DIR-089.md` passes `DIR-089` (task ID) as the first positional argument to `it0-dod-check.sh`, but the script expects a **milestone ID** (`M151`). When the gate engine runs `quay gate DIR-089`, it executes:

```
bash .../it0-dod-check.sh DIR-089 .../M151-dir089-safe-json-parse.md /tmp/m151-absorb-entry.md
```

This causes `it0-impl-row-check.sh` to search for `DIR-089` in backlog.md, which fails because the backlog row uses `M151` as the milestone column. Running the acceptance gate as configured yields exit code 2:

```
ERROR: no backlog row found for milestone id 'DIR-089'
ERROR: it0-impl-row-check.sh usage/environment error (exit 2)
```

**Root cause:** The implementer set `DIR-089` as the acceptance argument but `it0-dod-check.sh` requires `M151` (the milestone ID, not the task ID).

## Overall verdict

**REFUTED** — The acceptance gate is misconfigured (uses task ID `DIR-089` instead of milestone ID `M151`), causing it to fail with exit code 2 when invoked. AC 3 is structurally unverifiable at audit time (forward-looking 14-day criterion). The core implementation (safe-json-parse.sh library + restart-readiness-check.sh refactoring) is correct and AC 1 and AC 2 are confirmed.

Required fixes:
1. Change `extra.acceptance` in `tasks/DIR-089.md` to use `M151` instead of `DIR-089` as the first argument
2. Consider restructuring AC 3 to use a pre-fix baseline window or defer to a follow-up check
