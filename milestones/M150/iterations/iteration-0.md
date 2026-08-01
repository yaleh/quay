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

```
## Pre-Edit freshness check (M150, 2026-07-25)

78% of Edit errors are stale `old_string` matches — the file has changed since you last read it, and the string you are trying to replace no longer exists at the expected location.

**Rule:** before calling `Edit` with an `old_string`, re-read the target region of the file with `Read` to confirm the string you intend to replace is still present exactly as you expect. Do not construct `old_string` from memory or from a stale read earlier in the conversation. A fresh read immediately before the edit is the only reliable source of the current file state.
```

## Outcome

done
