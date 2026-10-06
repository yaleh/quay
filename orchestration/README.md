# orchestration/ — what's in here

101 top-level files recording the three-layer (manager/outer/inner) BAIME methodology as it
evolved. This is a working lab notebook, not a curated reference set — most files are dated,
many record a decision that was later revised, and there is no single "current state" document.

**Start here, not by browsing this directory:** `CLAUDE.md`'s "每轮必经" table names the handful of
files that are actually load-bearing today (`fast-mode-tick-core.md`, `manager-tick-core.md`,
`orchestrator-tick-core.md`, the `manager-tick-{criteria,closing,sending}.md` trio, and a few
others). Everything else in this directory is supporting evidence, history, or a superseded
proposal for one of those.

## A correction, in the interest of not shipping a wrong index

An earlier pass at this index classified files as "retired" by grepping for `RETIRED`/`退役`
anywhere in the file body. That overcounts badly: **51 of 101 files matched**, but most of those
matches are a file *discussing* retiring some other mechanism (e.g. `SPEC-quay-init-reconcile-...md`
retiring a shell script, `AC148-inner-core-itemized-attribution.md` being a prerequisite for a
later session retirement) — not the file itself being retired. That is exactly the trap `CLAUDE.md`
硬规则2 names ("按位置判定，不按关键词"): a keyword hit in the body is not a status.

Narrowing to a banner in the first 8 lines (the actual convention used, e.g. `OUTER-LOOP.md`'s
`> **RETIRED (ADR-022, ...)**` blockquote right after the title) and manually reading each hit
leaves a much smaller, verified list:

| File | Status |
|---|---|
| `SPEC-branching-model-integration-branch-2026-08-05.md` | Retired (2026-08-13, AC48) — kept as rationale archive, see `orchestration/archive/AC58-retired-clauses.md#R23`. |
| `SPEC-outer-liveness-productization.md` | Retired (2026-08-06) — its AC20/AC21 approach was overturned; superseded by a shared-event-file-free design. |
| `SPEC-suite-speed.md` | Partially retired (2026-08-06) — the `heavy-op-token.sh` mechanism it specified was deleted outright. |
| `SPEC-tmux-retirement-2026-09-03.md` | Historical first draft — its own framing was overturned by a 2026-09-04 ruling; kept as the historical record, not the current tmux-retirement account. |
| `manager-loop-tick.md` | Superseded as the execution checklist by `manager-tick-core.md` — kept as a 1138-line rationale/evidence archive, not a redo of either. |

This list is **not exhaustive** — it covers the 8 files a narrowed grep flagged, manually verified
one by one; the other 93 files were not individually read for staleness. Don't treat "not in this
table" as "confirmed current" — treat it as "not flagged by this pass."

## Naming conventions in this directory

`SPEC-*` (specifications), `SYNTHESIS-*` (cross-cutting synthesis), `RESEARCH-*` / `FINDING-*` /
`ANALYSIS-*` (one-off investigations), `PROPOSAL-*` (proposals awaiting a ruling), `RUNBOOK-*`
(operational procedures), dated `*-brief-*`/`restart-plan-*`/`recovery-*` (point-in-time session
handoffs). The `archive/` subdirectory holds content explicitly migrated out of `CLAUDE.md` itself
(`archive/AC58-retired-clauses.md`); it is not a general retirement bin for this directory.
