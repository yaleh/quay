# M147 iteration-0 Acceptance Audit -- DIR-095

**Audit session id:** ee05dd8f-1d70-4c6c-bd46-2fcb1299743e

**Date:** 2026-07-25
**Milestone:** M147
**Task:** DIR-095
**Charter:** experiments/quay-perpetual-stream/charters/M147-dir095-version-consistency.md
**Audit type:** adversarial acceptance audit (refute-first)

## Verdict: REFUTED

The technical deliverable (syncing all 8 version-bearing files to v0.3.13) is complete and
independently confirmed. Both AC items and all 3 DoD items are verified. However, the mechanical
gate (`it0-dod-check.sh`) exits 2 (non-zero) -- REFUTED by construction per the audit charge.

Root cause this pass: the absorb entry `/tmp/m147-absorb-entry.md` contains a prose-only
`## Audit-independence check` section describing a prior audit attempt's failure but lacks the
required structured fields (`Artifact:`, `Orchestrator id:`, `Dispatch record:`) that clause 12
of the DoD meta-enforcer requires. This is a DIFFERENT failure mode from the prior audit pass
(2026-07-25 11:10, which reported a backlog-row first-column mismatch: `| M147 | DIR-095 |`
vs expected `^| DIR-095 |`). The absorb entry was partially updated between passes -- the
backlog row now resolves correctly, but the audit-independence section was left as descriptive
prose rather than structured format.

## AC Satisfaction

### AC1: `node --test scripts/version-consistency-check.test.ts` exits 0

**VERDICT: CONFIRMED**

Independent evidence:
- `node --experimental-strip-types --test scripts/version-consistency-check.test.ts` result: **tests 9, pass 9, fail 0, exit 0**
- All 9 test cases pass: readVersions returns 8 entries for the real tree; readVersions returns errors for missing files; check returns all-equal on the real tree post-unification (GREEN); check returns all-equal for a unified fixture; check detects single-entry drift; check handles marketplace.json wrapper; CLI --json exits 0 with JSON output; CLI exits 0 on the real tree; CLI exits 0 on a unified fixture

### AC2: Session-start healthcheck no longer warns about version inconsistency

**VERDICT: CONFIRMED**

Independent evidence:
- `node --experimental-strip-types scripts/version-consistency-check.ts` exits **0**, stderr: `VERSION-CONSISTENCY: OK`
- All 8 files listed at version `0.3.13`
- `node --experimental-strip-types scripts/version-consistency-check.ts --json` outputs: `{"ok":true,"mode":"all-equal","uniqueVersions":["0.3.13"]}`

## DoD Satisfaction

### DoD1: All 8 version-bearing files synced to consistent version

**VERDICT: CONFIRMED**

8/8 files confirmed at v0.3.13 by `scripts/version-consistency-check.ts --json`:

| # | Path | Version |
|---|---|---|
| 1 | packages/quay/package.json | 0.3.13 |
| 2 | packages/quay-native/package.json | 0.3.13 |
| 3 | packages/quay-github/package.json | 0.3.13 |
| 4 | packages/quay-backlog/package.json | 0.3.13 |
| 5 | plugin/.claude-plugin/plugin.json | 0.3.13 |
| 6 | plugin/.claude-plugin/marketplace.json (quay entry) | 0.3.13 |
| 7 | .claude-plugin/marketplace.json (quay entry) | 0.3.13 |
| 8 | plugin/vendor/quay/package.json | 0.3.13 |

### DoD2: Version consistency test passes

**VERDICT: CONFIRMED**

Same evidence as AC1: 9/9 tests pass, exit 0.

### DoD3: No regression in package tests

**VERDICT: CONFIRMED**

Independent evidence:
- `node --test packages/quay/test/gate.test.mjs`: **25 pass, 0 fail** (tests 25)
- `node --test packages/quay/test/lifecycle.test.mjs`: **27 pass, 0 fail** (tests 27)

## Mechanical Gate

**Command:** `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-095 experiments/quay-perpetual-stream/charters/M147-dir095-version-consistency.md /tmp/m147-absorb-entry.md`

**Result: EXIT 2 (REFUTED by construction)**

```
ERROR: '## Audit-independence check' section present but missing required "Artifact: <path>" line
```

**Root cause (this pass):** The absorb entry `/tmp/m147-absorb-entry.md` has an `## Audit-independence check` section but it is prose-only -- it narrates a prior audit attempt's failure (placeholder session ID) without the structured fields clause 12 of the DoD meta-enforcer (`it0-dod-check.ts`) requires:
- `Artifact: <path>` -- missing (no line matching `Artifact: ...`)
- `Orchestrator id: <id>` -- missing
- `Dispatch record: <path or N/A>` -- missing

The clause 12 gate checks for these structured lines under the `## Audit-independence check` heading. When the heading exists but the structured fields are absent, `it0-dod-check.ts` throws `DodCheckEnvError` with the message above (exit 2). This is a **different** failure mode from the prior audit pass (2026-07-25 11:10), which reported:
```
ERROR: no backlog row found for milestone id 'DIR-095' in /tmp/it0-dod-check-backlog-<pid>-<ts>.md
```

The absorb entry was partially updated between passes -- the backlog row issue is resolved (clause 4 processes without error), but the audit-independence section remains in the prose format the outer loop originally drafted (describing the previous failed audit attempt) rather than the structured format clause 12 requires.

**Impact:** The mechanical gate cannot complete evaluation. Non-zero exit = REFUTED per the audit charge. This is a PROCESS/template defect (malformed absorb entry) -- NOT a DIR-095 code defect. The 1-line version bump in `plugin/.claude-plugin/plugin.json` (`0.4.0` -> `0.3.13`) is correct and independently verified.

## Deviation log

Existing deviation row at dashboard.md line 471 (level: CONCERNS, caught-by: machine, M147, DIR-095) described a backlog-row first-column mismatch. That row is updated to reflect the current failure mode: audit-independence section missing structured Artifact:/Orchestrator id:/Dispatch record: fields, not a backlog-row mismatch. Caught-by: machine (this fresh audit pass). The absorb entry defect is a process issue, not a DIR-095 code defect.

---

**Audit concluded at:** 2026-07-25
