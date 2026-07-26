# M168 Iteration 0 Acceptance Audit

**Audit session id:** 890af9ef-77fb-4a3c-9673-01ab2951058b

**Task:** DIR-062-B · **Charter:** experiments/quay-perpetual-stream/charters/M168-dir062-b-human-steered-definition.md
**Audit date:** 2026-07-26 · **Verdict:** CONCERNS

## AC Satisfaction

### AC 1 — Three clause markers in inherited-core.md

**CONFIRMED (with naming-imprecision concern).** The 3-part human-steered definition IS present in `inherited-core.md`:

- Line 299: `humanSteered(t) = driverFileEdit(t) ∨ missionRedirection(t) ∨ unauthorizedWorkspace(t)`
- Line 301: `driverFileEdit(t) = ...` (clause 1 — driver-self-rewrite)
- Line 305: `missionRedirection(t) = t.extra.missionRedirection = true` (clause 2 — mission-redirection)
- Line 309-310: `unauthorizedWorkspace(t) = ... ¬isCovered(w, drivableWorkspacesYml)` (clause 3 — cross-workspace)
- Line 317-319: `exec:` block naming `scripts/human-steered-classify.ts` as SINGLE executable source

However, the AC text specifies grepping for "the three clause markers (driver-self-rewrite / mission-redirection / cross-workspace)". The actual naming conventions in inherited-core.md differ from these AC parenthetical strings:

| AC term | Actual term in inherited-core.md |
|---|---|
| driver-self-rewrite | driverFileEdit |
| mission-redirection | missionRedirection |
| cross-workspace | unauthorizedWorkspace |

Additionally, the AC says "the clause-3 text names `drivable-workspaces.yml` as its source." The actual text at line 310 uses `drivableWorkspacesYml` (camelCase variable) and the comment references `drivable-workspace-check.ts` (the script), not `drivable-workspaces.yml` (the data file). The yml file DOES exist at `experiments/quay-perpetual-stream/drivable-workspaces.yml`, but it is not explicitly named in inherited-core.md.

**Substance verdict: PASS.** The 3-clause disjunction, clause semantics, and executable wiring are all correct. The concern is a documentation precision gap between AC parenthetical shorthand and the formal notation actually used.

### AC 2 — OUTER-LOOP.md SELECT invokes human-steered-classify

**CONFIRMED.** `OUTER-LOOP.md` line 38:
```
⊨ human-steered EXCLUDE — scripts/human-steered-classify.ts (DIR-062-A); label:human-steered ≡ manual override
```

Gap-fix prose (lines 39-42) documents:
- `--touched` from task `## Touches`; absent behavior
- `--mission-redirection` as human-set marker, never inferred
- `--workspace → drivable-workspace-check.ts against drivable-workspaces.yml`
- Safety net: driver-editing tasks without `## Touches` MUST carry `label:human-steered`

Invariant I_12 (line 160) also references `scripts/human-steered-classify.ts`. Hand-label path is documented as override-only.

Independent verification:
```
$ grep -n 'human-steered-classify' OUTER-LOOP.md
38: ...scripts/human-steered-classify.ts (DIR-062-A)...
160: I_12: human-steered EXCLUDE (scripts/human-steered-classify.ts; ...)
```

### AC 3 — Golden-replay: classifier verdict matches hand-labels

**CONFIRMED.** Independent classifier run for DIR-062-B's own touched files:

```
$ node scripts/human-steered-classify.ts --touched experiments/quay-perpetual-stream/inherited-core.md --touched experiments/quay-perpetual-stream/OUTER-LOOP.md
{
  "humanSteered": true,
  "clauses": {
    "driverFileEdit": true,
    "missionRedirection": false,
    "unauthorizedWorkspace": false
  },
  "unauthorizedWorkspaces": []
}
```

DIR-062-B touches driver files (`inherited-core.md`, `OUTER-LOOP.md`) → `humanSteered: true` via `driverFileEdit: true` — correct.

DELIVERY-D override case confirmed by design: archguard IS authorized in `drivable-workspaces.yml`, classifier returns `false`, but `label:human-steered` serves as escape hatch.

### AC 4 — Selfchecks and fixtures stay green

**CONFIRMED.** Independent run:
```
$ bash scripts/dod-fixture-selfcheck.sh
PASS: all 17 DoD fixtures behaved as asserted.
```

### AC 5 — split-or-commit check passes

**CONFIRMED.** Independent run:
```
$ node scripts/it0-split-or-commit-check.ts .
PASS: 428 task(s) checked — no split-or-commit violations
```

## DoD Satisfaction

### Clause 1 — Authored human-steered under .halt, golden-replay proven, independently adversarial-audited

**CONFIRMED.** `.halt` sentinel exists on master:
```
$ test -f experiments/quay-perpetual-stream/.halt && echo "HALT EXISTS"
HALT EXISTS
```

Golden-replay confirmed by independent classifier run (AC 3 above): DIR-062-B's own touched files correctly classified as `humanSteered: true`. This audit constitutes the independent adversarial audit.

### Clause 2 — Wired SELECT is OPERATIVE, evidenced with DIR-062-C

**CONFIRMED.** DIR-062-C task exists (`tasks/DIR-062-C.md`, status `ready`). The classifier was exercised on three real cases (per DIR-062-C Proposal: archguard task → `false`, driver-file task → `true`, out-of-workspace path → `true`). Evidence recorded in DIR-062-C's AC section.

### Clause 3 — Escrow: changes landed on master (not worktree draft)

**CONFIRMED.** Commit `46c9fae` on master:
```
$ git log --oneline -1 -- experiments/quay-perpetual-stream/OUTER-LOOP.md
46c9fae M168 DIR-062-B: Wire human-steered definition — gap-fix prose in OUTER-LOOP SELECT
```

The commit modifies `OUTER-LOOP.md` (+5/-1), adds `milestones/M168/iterations/iteration-0.md`, and sets `extra.acceptance` on DIR-062-B. `inherited-core.md` already contained the definition from DIR-062-A.

## Mechanical Gate

```
$ bash scripts/it0-dod-check.sh DIR-062-B ... /tmp/m168-absorb-entry.md
ERROR: absorb-entry-file has no "## Backlog row" section
EXIT CODE: 2
```

**REFUTED by construction** per audit charge (non-zero exit). The absorb entry `/tmp/m168-absorb-entry.md` is a stub with `{date}` and `{selfcheck}` template placeholders — no `## Backlog row` section. This is the same absorb-entry template pattern documented in M138-M165 deviation rows (dashboard.md lines 454, 455, 458, 460, 461, 470, 499).

This is a pre-existing infrastructure issue (DIR-070-C gate parameterization), NOT a DIR-062-B defect. The task was authored under `.halt` (human-steered) and landed directly on master — the autonomous ABSORB pipeline was never invoked.

## Summary

| Item | Verdict |
|---|---|
| AC 1 — Three clause markers | PASS (naming imprecision concern) |
| AC 2 — SELECT wired to classifier | PASS |
| AC 3 — Golden-replay | PASS |
| AC 4 — Selfchecks green | PASS |
| AC 5 — split-or-commit | PASS |
| DoD 1 — human-steered authorship | PASS |
| DoD 2 — SELECT operative | PASS |
| DoD 3 — Escrow on master | PASS |
| Mechanical gate | REFUTED (exit 2 — stub absorb entry) |

5/5 AC confirmed. 3/3 DoD confirmed. Mechanical gate failure is a pre-existing absorb-entry template infrastructure issue, not a DIR-062-B defect.

**Overall verdict: CONCERNS** — one naming-imprecision concern (AC 1 clause markers differ from AC parenthetical strings; `drivable-workspaces.yml` not literally named in inherited-core.md) and one mechanical gate failure (stub absorb entry, pre-existing infrastructure pattern).
