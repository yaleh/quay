---
id: exp5-M-CLI-UX
title: CLI usability closeout (UQ-042..046) — STALE, not selected
status: todo
labels:
  - milestone-candidate
  - backfill
  - stale
  - surface:cli
parent: null
children: []
extra: {}
---
## Backfill provenance
Backfilled milestone-candidate record (STALE, never selected/dispatched) — one-time migration pass, M13-task-backlog-projection design (DIR-009 item 6), executed by M24-task-backlog-projection-impl. Source: backlog.md row "M-CLI-UX".

## Source
exp4 gap-list usability_quality

## Value type / cadence
exploit

## Outcome (verbatim from backlog.md STALE note, m2 SELECT 2026-07-18, it0 ceiling check)
UQ-042..046 were already closed in exp4 iteration 15 (gap-list.md lines 35-39/185-189). exp4's true FINAL open-gap set (it19) is only ENV-001/SH-006/NEW-001/PKG-010, all minor/env — no real CLI-surface milestone-sized scope left. NOT selected; retained as a documented dead-end.

## Status mirror
todo/stale (backfilled from backlog.md STALE row, m2 SELECT boundary — never dispatched, no milestone directory exists)

---
_2026-07-18T19:18:52.064Z_: Not selected @M24: DIR-015/DIR-016's standing hard floor already committed this SELECT pass to M-TASK-BACKLOG-PROJECTION-IMPL (self-hosting fix, blocks all future SELECT read-path work) — a governance/infra candidate whose own enabling half was itself unselectable until this milestone lands.

---
_2026-07-19 (M37-discover-post-qeng iteration-0 re-triage)_: **Re-examined against current state,
CONFIRMED STILL STALE**, current-state reason (not a re-assertion of the backfill-era text): this
row's own named scope (UQ-042..046, CLI search-header grammar/synopsis/`--format` normalization
issues) is independently re-confirmed CLOSED as of this iteration — `grep -n "UQ-04[2-6]"
experiments/quay-continuous-bootstrap/gap-list.md` shows all 5 struck through and closed at exp4
iteration 15 (QX-058/QX-059), with zero reopening since. There is no live CLI-UX scope left under
THIS row's own title/scope. Separately (NOT a reason to un-stale this row, since its own named scope
is exhausted and dead): this same M37 discovery sweep DID find fresh, genuine, currently-live CLI-UX
gaps in the NEW QENG-1..4 gate/lifecycle surface (raw stack traces on guarded-error paths, an
exit-code leak in `quay run`, and a missing `--help` synopsis entry for `gate`/`gate-log`) —
those are captured as their own new candidate tasks (`exp5-M-GATE-CLI-ERROR-UX`,
`exp5-M-GATE-HELP-SYNOPSIS-GAP`) rather than folded into this row, because this row's own scope
(UQ-042..046) is a distinct, already-fully-closed matter and reusing its id/title for unrelated new
findings would misrepresent both the old and the new work's provenance.
