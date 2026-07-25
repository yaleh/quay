# M148 Iteration 0 Report

**Task:** DIR-096 — Document Glob unavailability in subagent sessions
**Date:** 2026-07-25
**Outcome:** done

## What was done

Added Glob unavailability documentation to `CLAUDE.md` as a new section alongside the existing M144 workflow resume anti-pattern note.

### Changes

1. **CLAUDE.md** — Added section "Glob tool unavailable in subagent sessions (M148, 2026-07-25)" documenting:
   - Glob is not available in subagent sessions ("Error: No such tool available: Glob")
   - Workaround: use `find` via Bash instead of `Glob`
   - Example: `find . -name '*.js' -not -path '*/node_modules/*'`
   - All Bash tools (`find`, `grep`, `ls`) work normally in subagent sessions

2. **DIR-096 task** — Set `extra.acceptance` to the it0-dod-check.sh gate command.

## Done-when verification

1. CLAUDE.md documents Glob unavailability in subagent sessions. -- DONE
2. Workaround documented (use `find` via Bash). -- DONE
