# M148 Acceptance Audit -- DIR-096

**Audit session id:** ee05dd8f-1d70-4c6c-bd46-2fcb1299743e

**Task:** DIR-096 -- Document Glob unavailability in subagent sessions
**Charter:** experiments/quay-perpetual-stream/charters/M148-dir096-glob-doc.md
**Verdict:** CONCERNS

## AC Satisfaction

### AC-1: CLAUDE.md documents Glob unavailability in subagent sessions

**VERDICT: CONFIRMED**

Concrete evidence: CLAUDE.md lines 80-84 (read directly from `/home/yale/work/quay/CLAUDE.md`):

```
## Glob tool unavailable in subagent sessions (M148, 2026-07-25)

The `Glob` tool is **not available in subagent sessions**. Calling `Glob` from a subagent
produces "Error: No such tool available: Glob". This has been observed in meta-cc session
history as a recurring error pattern.

**Rule:** when you need file-pattern matching in a subagent, use `find` via Bash instead of
`Glob`. Example: `find . -name '*.js' -not -path '*/node_modules/*'` instead of
`Glob({pattern: '**/*.js'})`. All Bash tools (including `find`, `grep`, `ls`) work normally
in subagent sessions.
```

The section:
- States Glob is unavailable in subagent sessions
- Shows the exact error pattern ("Error: No such tool available: Glob")
- References meta-cc session history as the discovery source
- Documents the workaround rule
- Provides a concrete example
- Notes that all Bash tools work normally

This is a complete, actionable documentation entry. No refutation possible.

### AC-2: Meta-cc query for `No such tool available: Glob` over 7 days post-fix shows count <= 2

**VERDICT: UNVERIFIED (forward-looking)**

This criterion specifies a 7-day post-fix window. The fix was applied today (2026-07-25), so
the 7-day window has not elapsed. This is a forward-looking criterion that cannot be confirmed
or refuted during this audit.

Current baseline (for reference): meta-cc `query_session_signals` for Glob errors since
2026-07-18 returned 6 occurrences of "No such tool available: Glob" across 319 total errors:
- 2 on 2026-07-24 (session 7a82bb15, not sidechain)
- 2 on 2026-07-25T01:42 (session 7a82bb15, sidechain -- agent a627dc76430faa044)
- 2 on 2026-07-25T04:52 (session 99d4e63c, not sidechain)

All 4 July-25 occurrences predate the CLAUDE.md documentation fix. Post-fix data is not yet
available.

The criterion as written is a valid long-term quality metric but structurally cannot be an
acceptance gate at audit time -- it requires a future observation window.

## DoD Satisfaction

### DoD-1: Glob unavailability documented in CLAUDE.md

**VERDICT: CONFIRMED**

Same evidence as AC-1. CLAUDE.md lines 80-84.

### DoD-2: Workaround documented (use `find` via Bash)

**VERDICT: CONFIRMED**

CLAUDE.md line 84: "when you need file-pattern matching in a subagent, use `find` via Bash
instead of `Glob`. Example: `find . -name '*.js' -not -path '*/node_modules/*'` instead of
`Glob({pattern: '**/*.js'})`."

Provides both a rule and a concrete example. Complete and correct.

## Mechanical Gate

**EXIT CODE: 2 (REFUTED by construction)**

Command run (as specified in task instructions):
```
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-096 \
  experiments/quay-perpetual-stream/charters/M148-dir096-glob-doc.md \
  /tmp/m148-absorb-entry.md
```

Error output:
```
ERROR: no backlog row found for milestone id 'DIR-096' in /tmp/it0-dod-check-backlog-<pid>.md
ERROR: it0-impl-row-check.sh usage/environment error (exit 2)
```

Root cause: the absorb entry `/tmp/m148-absorb-entry.md` `## Backlog row` section has:
```
| M148 | DIR-096 | discovery | Glob doc | CLAUDE.md |
```

`it0-dod-check.ts` clause 4 (design-only-milestone impl-row gate) invokes
`it0-impl-row-check.sh DIR-096 <tmp-backlog-file>`, which greps for `^\| DIR-096 \|` (first-
column exact match). The absorb entry's backlog row has `M148` as the first column, so the
match fails with exit 2 (usage error -- row not found).

This is NOT a DIR-096 implementation defect. The CLAUDE.md documentation is correct. The
failure is a porcelain issue in the absorb entry template: the `## Backlog row` section uses
`M148` as the first column, but the mechanical enforcer passes the task ID (`DIR-096`) to
`it0-impl-row-check.sh` which matches against first-column position. The real `backlog.md`
uses `| DIR-096 |` as the first column for this task.

This is the SAME pattern documented in the M144 deviation row (dashboard.md line 466):
"absorb-entry `## Backlog row` has `M144` as the first column... but `it0-impl-row-check.sh`
is invoked with milestone ID `DIR-086` and searches for `^| DIR-086 |`."

## Summary

| Item | Status |
|------|--------|
| AC-1: Glob doc in CLAUDE.md | CONFIRMED |
| AC-2: <=2 Glob errors over 7d post-fix | UNVERIFIED (forward-looking) |
| DoD-1: Glob unavailability documented | CONFIRMED |
| DoD-2: Workaround documented (find via Bash) | CONFIRMED |
| Mechanical gate (it0-dod-check.sh) | REFUTED (exit 2, absorb-entry format mismatch) |

**Overall verdict: CONCERNS** -- The implementation (CLAUDE.md documentation) satisfies all
verifiable AC and DoD items. The mechanical gate is REFUTED by construction (exit 2) due to
an absorb-entry `## Backlog row` first-column mismatch (`M148` vs `DIR-096`), a recurring
porcelain pattern (M144, M145, M139 derivate). AC-2 is forward-looking and cannot be
verified at audit time.
