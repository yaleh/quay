# M150 Iteration 0 — Pre-Edit freshness check documentation

**Milestone:** M150 · **Task:** DIR-088 · **Date:** 2026-07-25

## Summary

Added pre-Edit freshness-check discipline to CLAUDE.md: before constructing `old_string` for Edit, re-read the target region to confirm the string still matches. 78% of Edit errors are stale matches.

## Changes

- `CLAUDE.md`: Added "Pre-Edit freshness check (M150, 2026-07-25)" section (5 lines, lines 86-90)

## Verification

- [x] CLAUDE.md documents pre-Edit freshness discipline
- [x] Pattern: re-read target region before constructing old_string
- [x] extra.acceptance set on DIR-088

## Outcome

done
