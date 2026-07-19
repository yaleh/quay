---
id: exp5-M-DOCS
title: Docs surface hardening (docs_quality sub-dimension) — STALE, not selected
status: todo
labels:
  - milestone-candidate
  - backfill
  - stale
  - surface:docs
parent: null
children: []
extra: {}
---
## Backfill provenance
Backfilled milestone-candidate record (STALE, never selected/dispatched) — one-time migration pass, M13-task-backlog-projection design (DIR-009 item 6), executed by M24-task-backlog-projection-impl. Source: backlog.md row "M-DOCS".

## Source
exp4 gap-list docs_quality

## Value type / cadence
exploit

## Outcome (verbatim from backlog.md STALE note, m3 SELECT 2026-07-18, it0-ceiling-check.sh)
DOC-001..005 (the it18 docs_quality findings this row cites) were already closed in exp4 iteration 19 (gap-list.md, confirmed via mechanized check: all 5 CLOSED). No real Docs-surface milestone-sized scope left. NOT selected.

## Status mirror
todo/stale (backfilled from backlog.md STALE row, m3 SELECT boundary — never dispatched, no milestone directory exists)

---
_2026-07-18T19:18:52.075Z_: Not selected @M24: DIR-015/DIR-016's standing hard floor already committed this SELECT pass to M-TASK-BACKLOG-PROJECTION-IMPL (self-hosting fix, blocks all future SELECT read-path work) — a governance/infra candidate whose own enabling half was itself unselectable until this milestone lands.

---
_2026-07-19 (M37-discover-post-qeng iteration-0 re-triage)_: **Re-examined against current state,
CONFIRMED STILL STALE**, current-state reason (not a re-assertion of the backfill-era text): this
row's own named scope (DOC-001..005, the it18 `packages/quay/README.md` findings) is independently
re-confirmed CLOSED as of this iteration — `grep -n "DOC-00[1-5]" experiments/quay-continuous-bootstrap/
gap-list.md` shows all 5 closed at exp4 iteration 19 (QX-066) with no reopening since. There is no
live docs scope left under THIS row's own title/scope. Separately (NOT a reason to un-stale this row,
since its own named scope is exhausted and dead): this same M37 discovery sweep DID find a fresh,
genuine, currently-live docs gap — `packages/quay/README.md` has ZERO mentions of the entire
QENG-1..4 gate/lifecycle/driver CLI surface (`gate`, `gate-log`, `complete`, `adjudicate`, `promote`,
`retreat`, `run`), a real shipped command family that postdates DOC-001..005's closure entirely and
was never in scope for the exp4-era gap-list this row cites. That new finding is captured as its own
new candidate task (`exp5-M-GATE-README-DOCS`) rather than folded into this row, because this row's
own scope (DOC-001..005) is a distinct, already-fully-closed matter and reusing its id/title for
unrelated new findings would misrepresent both the old and the new work's provenance.
