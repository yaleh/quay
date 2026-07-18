---
id: exp5-M12
title: GitHub Provider parent/children WRITE
status: done
labels:
  - milestone-candidate
  - milestone:M12-abi-parent-write
  - backfill
  - surface:provider-abi
parent: null
children: []
extra: {}
---
## Backfill provenance
Backfilled milestone record — one-time migration pass, M13-task-backlog-projection design (DIR-009 item 6). Source: backlog.md row "M-ABI-PARENT-WRITE".

## Source
M09-gh-write's charter Done-when item 4 exclusion note ("parent/children WRITE ... out of scope this milestone ... worth its own future milestone if selected")

## Value type / cadence
exploit

## Outcome (verbatim from backlog.md DONE column, m12 2026-07-18)
iteration-0 (f172b29) and iteration-1 (6d76cdf) both independently implemented and live-verified full bidirectional reassign-parent semantics against real GitHub scratch issues; full scope shipped. Merged to master (a1f581a + 47898fe), iteration-1's implementation kept as canonical on merge conflict. Provider-ABI coverage 12/13 (0.9231) -> 13/13 (1.0000). VT chart-1 109.11 -> 110.65/120. Realized Δv = +1.54. First real trigger of the out-of-band adversarial-audit gate: verdict CONCERNS (non-blocking).

## Status mirror
done (backfilled from backlog.md DONE row, m12 boundary)