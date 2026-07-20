---
id: exp5-M-GATE-README-DOCS
title: "packages/quay/README.md has ZERO mentions of the entire QENG-1..4
  gate/lifecycle/driver CLI surface (gate, gate-log, complete, adjudicate,
  promote, retreat, run) — a real, shipped, user-facing command family is
  fully undocumented in the package's own README"
status: done
labels:
  - milestone-candidate
  - surface:docs
  - milestone:M37-discover-post-qeng
extra: {}
---
## Provenance
Materialized at the M37-discover-post-qeng discovery milestone (2026-07-19), from a direct grep of
`packages/quay/README.md` against the QENG-1..4 command surface (not from reading commit messages).

## Source
Live verification, this milestone's report (`report.iteration-0.md`, "QENG survey" section).

## Value type / cadence
exploit (docs gap on an already-shipped, user-facing CLI surface).

## Finding (live-reproduced)
`grep -n "quay gate\|quay complete\|quay promote\|quay retreat\|quay adjudicate\|quay run\b\|gate-log"
packages/quay/README.md` returns ZERO matches, over the README's full 276 lines. This is DISTINCT
from the exp4-lineage `DOC-001..005` findings (already closed per `gap-list.md`, confirmed this
milestone — those covered `--provider`, `action list/run`, `task view/edit`, config ordering, and the
releases URL, none of which are QENG-related) — this is a fresh gap in a real, currently-shipped
surface that postdates DOC-001..005's closure entirely. The README's own `## Install` /
`## Configuration` / (implied) command-reference sections give a new user zero indication that
`quay gate`, `quay complete`, `quay promote`, `quay retreat`, `quay adjudicate`, or `quay run` exist
at all — someone learning the CLI from the README alone (a stated persona in this experiment's own
prior M04-discover milestone) would never discover the DoD-gate/lifecycle/autonomous-driver surface,
even though `--help` (once found) documents it reasonably well (modulo the synopsis gap in
`exp5-M-GATE-HELP-SYNOPSIS-GAP`, a separate finding).

## Acceptance Criteria
- [x] `packages/quay/README.md` gains a new section (e.g. "## Gate & lifecycle commands (QENG-1..4)")
  documenting, at minimum: what `quay gate <id> [--gate <name>]` / `quay gate --list` do; the
  `dod`/`acceptance` gates and what `task.extra.acceptance` is (linking to `--acceptance` under
  `task edit`, already documented); the `complete`/`adjudicate`/`promote`/`retreat` lifecycle verbs
  and the `{todo,ready,done,needs-human}` transition model they operate over; `quay run [--once]` as
  the autonomous driver loop; and `quay gate-log` for querying the GateEvent audit trail — with at
  least one concrete worked CLI example (mirroring the existing worked-example style already used for
  `task view`/`task edit`/`action list`/`action run` elsewhere in the README).
- [x] The new section's claims are cross-checked against this milestone's own live survey evidence
  (`report.iteration-0.md`) — i.e. the documented behavior matches what was actually observed running
  the commands, not just restated from the source code's doc comments.
- [x] `packages/quay/README.md`'s existing structure/style (heading levels, code-fence conventions) is
  followed, not a bolted-on inconsistent section.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present, 1
per-milestone acceptance audit, 2 V_meta-lag, 3 line-budget, 4 impl-row, 5 no-self-exemption, 6
escrow-Δv, 7 test-floor — N/A, `surface:docs`, no `packages/quay*` source/test files are touched by
this task, only README.md prose). No task-specific exemption from any clause.
- [x] All standard clauses satisfied or explicitly N/A per their own trigger condition (re-verified at
  ABSORB, not assumed).

## Resolution
Landed at M54 ABSORB (2026-07-20), commit `ef259dd` on branch `milestones/M54-gate-readme-docs`,
merged `--no-ff` into `master`. Independently audited verdict: **PASS-WITH-QUALIFICATIONS** — one
required fix applied pre-merge (see below), all other findings PASS.

Key evidence:
- New `### Gate & lifecycle commands (QENG-1..4)` section added to `packages/quay/README.md`
  (nested under the existing `## Usage` heading, matching the file's existing heading-depth and
  code-fence conventions), documenting `quay gate <task-id> [--gate <name>]` / `quay gate --list`,
  the `dod`/`acceptance` gates and `task.extra.acceptance`, `quay gate-log` (human + `--json`
  forms), the `complete`/`adjudicate`/`promote`/`retreat` lifecycle verbs over the
  `{todo, ready, done, needs-human}` transition model, and `quay run [--once]` as the autonomous
  driver loop — with concrete worked CLI examples throughout.
- Every worked example was live-reproduced against a real task before being written into the
  README; the audit independently re-ran the examples and confirmed they match actual CLI behavior.
- **Required fix applied before merge:** the `gate --list` worked example showed only 2 gates
  (`dod`, `acceptance`), accurate for a fresh/minimal workspace but potentially ambiguous since
  this repo's own `.quay/gates.yml` wires 11 gates. Added a clarifying note directly after the
  example: "(Example output for a fresh/minimal workspace; a workspace with `.quay/gates.yml`
  custom gates — like this repo's own — will list additional named gates beyond
  `dod`/`acceptance`.)" — disambiguating that the example is illustrative, not a literal transcript
  of this repo's own gate list.
- MCP-scoping: the task's AC explicitly names only CLI verbs (`quay gate`, lifecycle verbs,
  `quay run`, `quay gate-log`); excluding MCP tool docs (`gate_run`, `gate_log`, `lifecycle_*`,
  landed M53) from this section was confirmed correctly scoped by the audit, not an
  under-scoped reading.
- No README-content-assertion test precedent exists anywhere in `packages/quay/test/*.mjs`
  (confirmed via grep, zero hits) — audit confirmed no new test is required for this prose-only
  docs change.
- `task-schema-check.sh` result of "N/A legacy (no schema marker)" is correct/acceptable: this
  task predates the `extra.schema:"v1"` marker convention and already carries grandfathered
  checklist-form AC/DoD from its M37-discover-post-qeng origin, per `OUTER-LOOP.md`'s forward-only
  schema-marker note. Not a blocker.
- Full suite (excluding `serve-github`/`provider-abi-conformance`, which require live GitHub):
  257 pass / 3 fail (of 260) — the 3 failures are the documented pre-existing flaky baseline
  (dir032-audit-independence M44 A2/C1, web-ui-browser), no new regressions.
- `dod-fixture-selfcheck.sh` — all 17 fixtures PASS, no regression in the DoD meta-enforcer.
- Smoke test (`delivery-standalone-smoke.sh`) — 0 RED.

## Not selected (M51)
Considered at M51 SELECT (2026-07-20) alongside `exp5-M-GATE-CLI-ERROR-UX` and
`exp5-M-GATE-MCP-PARITY-GAP`, against `exp5-M-GATE-HELP-SYNOPSIS-GAP` (the winner). Per checkpoint
cp-50's recommendation to break a 5-milestone exploit-typed-pick drought, M51 picked the smallest,
most concrete, directly VT-moving exploit-typed fix available — a ~15-line, mechanically-testable
CLI-help synopsis gap. This README-docs gap is real and still exploit-typed, but larger in surface
(a new README section, cross-checked against live survey evidence) and less immediately concrete
than the synopsis fix. Remains a live `milestone-candidate` for a future SELECT.
