# M140 Acceptance Audit — DIR-070-D (iteration-0)

**Date:** 2026-07-25
**Task:** DIR-070-D
**Charter:** experiments/quay-perpetual-stream/charters/M140-dir070d-routines-skill.md
**Implementation commit:** 2bd9439
**Auditor:** adversarial-acceptance-audit subagent (refute-first stance)
**Verdict:** CONCERNS

## AC Satisfaction

### AC 1: `/routines` skill dispatches `routine-scheduler.ts` -> probe agents -> `routine-file-gate.ts` -> verify

**CONFIRMED (structurally).** The skill at `plugin/skills/routines/SKILL.md` documents all four
pipeline phases: Schedule (Phase 1, lines 27-35), Dispatch (Phase 2, lines 37-56), Gate (Phase 3,
lines 58-67), Verify (Phase 4, lines 69-76). The packaging test confirms these phases are present
(`routines skill (M140) has zero experiment-layer references` test asserts "must document the
Schedule/Dispatch/Gate/Verify phases"). All three referenced scripts
(`routine-scheduler.ts`, `read-probe-spec.ts`, `routine-file-gate.ts`) exist in
`plugin/scripts/`. The `read-probe-spec.ts` implementation (117 lines) correctly parses probe
spec frontmatter with fail-closed semantics.

**Caveat:** The skill is documentation/instruction, not executable code. Actual end-to-end
behavioral verification (invoking the skill against a real workspace) is deferred -- the
iteration-0.md report states: "Standard end-to-end verification (firing the skill against a real
workspace) is deferred to the outer loop's own routine evaluation." The structural pieces
(skill text, referenced scripts, parse logic) are all in place; only the runtime invocation
has not been independently confirmed by this audit.

Evidence:
- `plugin/skills/routines/SKILL.md` -- 107 lines, all 4 phases described
- `plugin/scripts/routine-scheduler.ts` -- EXISTS
- `plugin/scripts/read-probe-spec.ts` -- 117 lines, fail-closed contract implemented
- `plugin/scripts/routine-file-gate.ts` -- EXISTS
- `plugin/test/plugin-packaging.test.mjs` line 209: asserts all four phases present

### AC 2: Skill works with chrome-devtools/playwright MCP available (DIR-069 browser-explorer probe)

**CONCERNS.** The skill's documentation correctly describes the instrument-awareness mechanism:
Phase 2 Step 2 checks MCP server availability by name before dispatching probes with
`instrument !== "none"`. Contract 2: "Instrument-aware. Probe dispatch checks MCP availability
before firing." The Cross-cutting section (lines 98-101) explicitly documents: "When
`chrome-devtools` or `playwright` MCP is available, the `browser-explorer` probe can dispatch."

However, no concrete end-to-end test demonstrates the skill actually dispatching a
browser-explorer probe agent when chrome-devtools/playwright IS available. The iteration-0.md
report explicitly defers E2E verification. The `read-probe-spec.ts` implementation correctly
parses `instrument` and `fallback` fields from probe spec frontmatter, so the structural
support for instrument-awareness exists. This is a behavioral AC that the structural tests do
not cover.

Evidence:
- SKILL.md Phase 2 Step 2: instrument availability check documented
- SKILL.md Contract 2: "Instrument-aware" documented
- SKILL.md Cross-cutting lines 98-101: browser-explorer dispatch path documented
- `read-probe-spec.ts` lines 15-16: returns `{ instrument, fallback, ... }`
- iteration-0.md line 49: "Standard end-to-end verification... is deferred"

### AC 3: Skill works when no MCP instruments are available (skips with `filed: 0`)

**CONCERNS.** Same pattern as AC 2. The skill documents the clean-skip behavior: Phase 2 Step 2
states "If unavailable and `fallback === 'none'`, skip and return `{filed: false}` -- the
routine will fire again on its next trigger." Contract 2: "Unavailable instruments with
`fallback: 'none'` are skipped cleanly (not errors)."

No concrete E2E test verifies graceful degradation in the absence of MCP instruments. The
structural mechanism is documented but not behaviorally verified by this audit.

Evidence: same as AC 2.

### AC 4: `plugin.json` commands[] includes `./skills/routines/SKILL.md`

**CONFIRMED.** Direct file inspection confirms `./skills/routines/SKILL.md` is present in
the `commands[]` array (line 15 of the JSON array). The packaging test confirms:
"plugin.json is valid JSON and declares the 7 bundled skills (M140: +routines)" -- PASS.

Evidence:
- `plugin/.claude-plugin/plugin.json` line 15: `"./skills/routines/SKILL.md"`
- Test output: `plugin.json is valid JSON and declares the 7 bundled skills (M140: +routines)` -- PASS

### AC 5: `plugin-packaging.test.mjs` passes with new skill

**CONFIRMED.** Full test run: **30/30 pass, 0 failures**. The test suite includes:
- Updated "7 bundled skills" assertion including routines skill
- `routines skill (M140) has zero experiment-layer references` test -- PASS
- `no shipped/foreign-workspace-facing file leaks` test including routines SKILL.md -- PASS
- `M143: git-tracked workflows in plugin/workflows/ are byte-identical` test -- PASS

Evidence:
- `node --test plugin/test/plugin-packaging.test.mjs` output: 30 pass, 0 fail, duration 215ms

### AC 6: No `experiments/quay-perpetual-stream` or `exp5` in shipped skill

**CONFIRMED.** `grep -nE 'experiments/quay-perpetual-stream|\bexp5\b' plugin/skills/routines/SKILL.md`
returns exit 1 (no matches). The packaging test's dedicated leak-check test confirms:
"routines skill (M140) has zero experiment-layer references" -- PASS. The skill uses
`${CLAUDE_PLUGIN_ROOT}/scripts/` for all script references (portable, no workspace-local paths).

Evidence:
- grep exit 1 (no matches)
- Test: `routines skill (M140) has zero experiment-layer references` -- PASS
- SKILL.md uses `${CLAUDE_PLUGIN_ROOT}/scripts/` exclusively

## DoD Satisfaction

The task's `## Definition of Done` references the standard 13 DoD clauses from `inherited-core.md`
(enforced by `it0-dod-check.ts`) plus 6 milestone-specific clauses:

1. **Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 2:** CONFIRMED. Task Plan
   section (line 25) includes: "Reference: `docs/proposals/exp5-deliverable-improvements.md` Gap 2."

2. **`plugin/skills/routines/SKILL.md` authored:** CONFIRMED. File exists (107 lines, created
   Jul 25 08:32, committed in 2bd9439).

3. **`plugin.json` updated:** CONFIRMED. `./skills/routines/SKILL.md` added to `commands[]`.

4. **Plugin packaging test updated and passing:** CONFIRMED. 30/30 tests pass.

5. **Depends on DIR-070-B (gates must be in plugin/scripts/ for the skill to reference):**
   CONFIRMED. DIR-070-B is DONE per backlog.md. All referenced scripts
   (`routine-scheduler.ts`, `read-probe-spec.ts`, `routine-file-gate.ts`) are in `plugin/scripts/`.

6. **Enables DIR-069 (browser-explorer probe dispatch path):** CONFIRMED. DIR-069 is DONE per
   backlog.md. SKILL.md Cross-cutting section documents the dispatch path end-to-end:
   skill -> scheduler -> probe -> gate. The `browser-explorer` probe spec exists at
   `plugin/probes/browser-explorer.md`.

## Mechanical Gate

**REFUTED by construction (exit 2).** Running:
```
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-070-D \
  experiments/quay-perpetual-stream/charters/M140-dir070d-routines-skill.md \
  /tmp/m140-absorb-entry.md
```
produces exit code 2:
```
ERROR: backlog file not found: backlog.md
ERROR: it0-impl-row-check.sh usage/environment error (exit 2)
```

This is the **same pre-existing infrastructure issue** documented in the DIR-070-C (M139)
deviation row at dashboard.md line 455: `it0-impl-row-check.sh`'s while-loop argument parser
treats ALL non-flag positional args as MILESTONE_ID, causing the second positional arg (the
synthetic temp backlog file) to overwrite the first. `it0-dod-check.ts` line 304 passes two
positional args (`[milestoneId, tmpBacklog]`), but the script only accepts the backlog path
via `--backlog <file>` flag. This is a call-convention regression introduced during the
DIR-070-C (Tier B gate parameterization), NOT a DIR-070-D defect. The implementer's
iteration-0.md explicitly discloses this: "a pre-existing infrastructure issue... not
introduced by M140."

**Non-zero exit = REFUTED by construction per audit charge clause 3.** However, the root cause
is external to this milestone's deliverable -- the same gate script bug blocks M139 and M140
equally.

## Additional concerns

### C1: Task lifecycle incomplete

The task on master (`tasks/DIR-070-D.md`) has `status: todo` in frontmatter. The implementation
is committed (2bd9439, all deliverable files present on master), but the task was never promoted
through `todo -> ready -> done` lifecycle. All 6 AC checkboxes and all 6 DoD checkboxes in the
task body are unchecked (`- [ ]`). The dashboard counter is at 139; the M140 ABSORB log entry
was not appended.

### C2: No audit directory existed pre-audit

The `milestones/M140/audits/` directory did not exist before this audit pass, confirming that
the adversarial-acceptance-audit step (OUTER-LOOP.md step 6) was not run during the ABSORB
process. The iteration-0.md report exists but no independent audit was performed.

## Deviation rows

Two deviation rows should be written to dashboard.md:

1. **caught-by: machine** -- AC #2/#3 behavioral verification deferred; skill documents
   instrument-awareness but no E2E test confirms runtime behavior with/without MCP instruments.
   (level: CONCERNS)

2. **caught-by: machine** -- Mechanical gate exit 2: inherited `it0-impl-row-check.sh` positional
   arg regression (same root cause as DIR-070-C deviation row, dashboard.md line 455). Not a
   DIR-070-D defect.
   (level: REFUTED, but pre-existing infrastructure issue)

3. **caught-by: machine** -- Task lifecycle incomplete: `status: todo` on master despite
   implementation merge (commit 2bd9439). AC/DoD checkboxes all unchecked. Dashboard counter
   at 139 (M140 ABSORB not recorded).
   (level: CONCERNS)
