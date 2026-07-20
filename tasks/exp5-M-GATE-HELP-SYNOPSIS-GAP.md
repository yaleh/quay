---
id: exp5-M-GATE-HELP-SYNOPSIS-GAP
title: "`quay --help`'s top-level Usage synopsis omits `quay gate <id>` and
  `quay gate-log <id>` entirely — the two QENG-1/2 entry-point commands are
  documented only as passing mentions inside OTHER commands' help text"
status: done
labels:
  - milestone-candidate
  - surface:cli
  - milestone:M37-discover-post-qeng
  - milestone:M51
extra:
  schema: v1
---
## Provenance
Materialized at the M37-discover-post-qeng discovery milestone (2026-07-19), from direct exercise of
`quay --help` against the current QENG-1..4 CLI surface.

## Source
Live CLI reproduction, this milestone's report (`report.iteration-0.md`, "QENG survey" section).

## Value type / cadence
exploit (docs/discoverability fix on an already-shipped CLI surface).

## Finding (live-reproduced)
`quay --help`'s top-level `Usage:` synopsis block (`bin/quay.js`, printed first in the help output)
lists every other QENG-era command explicitly:
```
  quay complete <task-id> [--file <log-path>]
  quay adjudicate <task-id> [--file <log-path>]
  quay promote <task-id> [--file <log-path>]
  quay retreat <task-id> --reason <reason> [--file <log-path>]
  quay run [--once] [--file <log-path>]
```
but has NO line for `quay gate <task-id> [--gate <name>] [--list]` or
`quay gate-log <task-id> [--gate <name>] [--json] [--file <log-path>]` anywhere in that block —
confirmed via `node bin/quay.js --help | grep -c "^  quay gate"` → `0`. Both commands ARE real,
wired, and independently verified working in this milestone's survey (`quay gate --list`,
`quay gate <id> --gate dod|acceptance`, `quay gate-log <id> [--json]` all exercised live with real
output). `gate`/`gate-log` are mentioned only in passing, as prose asides inside the descriptions of
OTHER commands (e.g. `--acceptance <cmd>`'s option text says "run by 'quay gate <id>'", and
`adjudicate`'s Lifecycle-commands paragraph says "see gate-log") — a user or agent running
`quay --help` top-to-bottom to discover the full command surface, exactly the workflow the Usage
synopsis exists to serve, has no way to learn `gate`/`gate-log` exist from the synopsis block itself,
and would need to already know the command names to find their (also-undocumented, see below)
detailed option lists.

Additionally: `gate`'s own detailed options (the `--gate <name>` flag, `--list` flag) and `gate-log`'s
own detailed options (`--gate`, `--json`, `--file`, positional `<task-id>`) are not given a dedicated
"Options for gate" / "Options for gate-log" section either, unlike every other command family
(`task list`, `task create`, `task edit`, etc., each of which gets its own "Options for X" block).

## Proposal
Add the two missing lines (`quay gate <task-id> [--gate <name>]`, `quay gate --list`, and `quay
gate-log <task-id> [--gate <name>] [--json] [--file <log-path>]`) to the top-level `Usage:` synopsis
block in `printHelp()` (`packages/quay/bin/quay.js`), directly adjacent to the existing
`complete`/`adjudicate`/`promote`/`retreat`/`run` lines, matching their exact style. Add a dedicated
"Options for gate / gate-log" section (grouped alongside the existing "Lifecycle commands (QENG-3)" /
"Driver command (QENG-4)" section headers) documenting `--gate <name>`, `--list`, `--json`, and
`--file`. Extend `packages/quay/test/cli.test.mjs`'s existing `--help` content-assertion block with
assertions that the synopsis contains `quay gate` and `quay gate-log`, so a future regression is
caught mechanically. This is a documentation-only change to an already-shipped, already-tested CLI
surface (QENG-1/2) — no behavior change to the gate engine itself.

## Plan
N/A — docs/CLI-help-only fix, no separate plan doc needed.

## Acceptance Criteria
- [x] `quay --help`'s top-level `Usage:` synopsis block gains explicit lines for `quay gate <task-id>
  [--gate <name>]` and `quay gate --list`, and `quay gate-log <task-id> [--gate <name>] [--json]
  [--file <log-path>]`, matching the existing line style/placement used for `complete`/`adjudicate`/
  `promote`/`retreat`/`run`.
- [x] A dedicated "Options for gate" / "Options for gate-log" section (or a combined "QENG-1 gate
  engine commands" section, matching whichever grouping style fits best next to the existing
  "Lifecycle commands (QENG-3)" / "Driver command (QENG-4)" section headers already present) is added,
  documenting `--gate <name>` (default gate per command), `--list`, `--json`, and `--file`.
- [x] `packages/quay/test/cli.test.mjs` (or the relevant existing --help-content test file) gains an
  assertion that `--help` output contains `quay gate` and `quay gate-log` in the synopsis block, so a
  future regression (e.g. a new command added without updating the synopsis) is caught mechanically,
  not just by a future human noticing.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present, 1
per-milestone acceptance audit, 2 V_meta-lag, 3 line-budget, 4 impl-row, 5 no-self-exemption, 6
escrow-Δv, 7 test-floor — APPLIES, `surface:cli`, ≥80% coverage disposition or a stated waiver
required — though this is a small, mostly-string-literal change, the new test assertion itself
satisfies the coverage intent). No task-specific exemption from any clause.
- [x] All standard clauses satisfied or explicitly N/A per their own trigger condition (re-verified at
  ABSORB, not assumed).

## Resolution
Landed at M51 ABSORB (2026-07-20), commit `87303a0` on branch `milestones/M51-gate-help-synopsis`,
merged `--no-ff` into `master`. Independently audited verdict: **PASS**.

Key evidence:
- `quay --help`'s top-level `Usage:` synopsis block now carries explicit lines for `quay gate
  <task-id> [--gate <name>]`, `quay gate --list`, and `quay gate-log <task-id> [--gate <name>]
  [--json] [--file <log-path>]`, in the same style/placement as the existing `complete`/
  `adjudicate`/`promote`/`retreat`/`run` lines.
- A new "Gate engine commands (QENG-1/2)" options section documents `--gate`, `--list`, `--json`,
  and `--file`.
- `packages/quay/test/cli.test.mjs` gained new assertions (~lines 978-1004) isolating the synopsis
  slice and confirming the `gate`/`gate-log` lines are present; audit confirmed these assertions are
  substantive (not tautological) and all pass.
- Full suite (excluding `serve-github`/`provider-abi-conformance`, which require live GitHub):
  253 tests, 250 pass, 3 fail — all 3 are the known pre-existing flaky baseline (audit-independence
  M44 A2/C1, web-ui-browser), no new regressions introduced by this change.
- DIR-014 §5a judgment call to skip the full `quay-task-to-plan` pipeline for this ~15-line
  additive docs/CLI-help fix was independently reviewed and ruled **defensible** given the change's
  small, mostly-string-literal, already-shipped-surface nature.
- `task-schema-check.sh` PASS, schema v1 conformant; Proposal/Plan/AC/DoD consistent, no drift.

## Status mirror
Authored @M37-discover-post-qeng iteration-0 DRAIN sweep, 2026-07-19. SELECTed @M51 (2026-07-20),
landed and audited PASS same milestone.
