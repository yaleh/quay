---
id: exp5-M-DIRTASK
title: Directives-as-quay-tasks single-source-of-truth cutover — STALE, not selected
status: todo
labels:
  - milestone-candidate
  - backfill
  - stale
  - surface:method-infra
parent: null
children: []
extra: {}
---
## Backfill provenance
Backfilled milestone-candidate record (STALE, never selected/dispatched) — one-time migration pass, M13-task-backlog-projection design (DIR-009 item 6), executed by M24-task-backlog-projection-impl. Source: backlog.md row "M-DIRTASK".

## Source
DIR-006 (REOPENED, per row text — later resolved as file-canonical, see below)

## Value type / cadence
explore

## Outcome (verbatim from backlog.md STALE note, m3 SELECT 2026-07-18)
DIR-006 is CLOSED, not reopened, with a formal considered resolution ("Option B: files canonical") that explicitly REJECTS this row's own premise. This backlog row predates that resolution and was never updated. NOT selected — dispatching it would re-litigate a decision already made and documented.

## Status mirror
todo/stale (backfilled from backlog.md STALE row, m3 SELECT boundary — never dispatched, no milestone directory exists)

---
_2026-07-18T19:18:52.072Z_: Not selected @M24: DIR-015/DIR-016's standing hard floor already committed this SELECT pass to M-TASK-BACKLOG-PROJECTION-IMPL (self-hosting fix, blocks all future SELECT read-path work) — a governance/infra candidate whose own enabling half was itself unselectable until this milestone lands.

---
_2026-07-19 (M37-discover-post-qeng iteration-0 re-triage)_: **Re-examined against current state,
CONFIRMED STILL STALE, with a correction to this row's own "Source" field.** This row's "Source"
field ("DIR-006 (REOPENED... resolved as file-canonical)") is itself mis-sourced: exp5's own
`tasks/DIR-006.md` (`git log --oneline -- tasks/DIR-006.md` → commit `86d584b`, "Add DIR-006 + DIR-007:
exp5 Web UI browser-verification regression...") is about the Web-UI browser-verification regression,
NOT directives-as-quay-tasks single-source-of-truth — it has never been about that topic. The actual
"Option B: files canonical" resolution this row is describing is documented in exp4-lineage
`tasks/DIR-004.md` ("Per DIR-006 resolution (Option B: files canonical)..." — referring to
EXPERIMENT-4's own differently-numbered DIR-006, a distinct numbering namespace from exp5's). The
underlying POLICY QUESTION this row asks about (should directives be quay-tasks-canonical or
files-canonical?) is doubly resolved regardless of the citation mix-up: (a) the files-canonical
Option-B policy is confirmed live via `tasks/DIR-004.md`'s own text, and (b) exp5's own
`experiments/quay-perpetual-stream/directives/archive/DIR-009-*.md` (title: "generalize M05's
file-canonical projection beyond directives") independently confirms the file-canonical projection
model (directives-as-files, machine-regenerated `label:directive` task projections, drift-checked via
`it0-dir-projection-check.{sh,mjs}`) is not just decided but ALREADY LIVE and self-hosting in this
very repo (`tasks/DIR-*.md` are regenerated projections today, confirmed by inspection this
iteration). So this row's disposition (NOT selected, re-litigates a settled and now-implemented
decision) is correct and even more strongly grounded than its own backfill-era text states — the
row's citation should read "DIR-004/DIR-009 (exp4/exp5 file-canonical precedent), not DIR-006" for any
future reader, but the underlying disposition does not change.
