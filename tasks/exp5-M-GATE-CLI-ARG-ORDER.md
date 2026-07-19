---
id: exp5-M-GATE-CLI-ARG-ORDER
title: "Fix flag-before-positional-id crash across the 6 QENG verb-less
  commands (gate/gate-log/complete/adjudicate/promote/retreat) — a leading
  flag is silently misread as the task id, producing a raw stack trace or a
  silent empty result instead of a usage error"
status: done
labels:
  - milestone-candidate
  - surface:cli
  - milestone:M42-gate-cli-arg-order
extra: {}
---
## Provenance
Found during M37-discover-post-qeng's functional QENG survey (iteration-1, 2026-07-19) — direct
command exercise of `packages/quay/src/gate/*.js` and its CLI wiring in `packages/quay/bin/quay.js`,
not inferred from reading code alone.

## Source
Live reproduction, this milestone's survey (see `report.iteration-1.md` for full transcripts). Root
cause: `bin/quay.js` line 287, `const [, , cmd, sub, ...rest] = process.argv;` — `sub` is the RAW
`process.argv[3]` token (positional-index-only), not a flag-aware extraction. The 6 QENG verb-less
commands (`gate`, `gate-log`, `complete`, `adjudicate`, `promote`, `retreat`) all read the task id
directly off `sub` (e.g. `bin/quay.js` line ~798 `const id = sub;` in the `gate` branch; mirrored in
the `complete`/`adjudicate`/`promote`/`retreat`/`gate-log` branches). By contrast, `task view`/`task
edit`/`task create` read the id from `positional[0]`, a value produced by `parseFlags()` which strips
recognized `--flag value` pairs out first — those commands do NOT have this bug. `run` also avoids it
because it explicitly re-parses `[sub, ...rest]` through `parseFlags` (bin/quay.js line ~894) since it
takes no positional id at all.

## Proposal
(Reconciled via the quay-task-to-plan pipeline — OUTER-LOOP step 5a — from 2 independent
blank-slate proposals; DIR-014 item 4 dogfood, see milestone iteration-0.md.)

Root cause is deeper than "read the wrong variable": for the 6 verb-less commands the top-level
`const {flags,positional} = parseFlags(rest)` parses only `argv[4:]`. When a flag leads
(`quay gate --gate dod ID`), `--gate` sits in `sub` (not `rest`), so parseFlags never consumes it —
its value `dod` is misread as `positional[0]` AND `flags.gate` is silently lost (defaults to
acceptance). So neither the raw `sub` NOR the broken `positional[0]` is the id.

**Fix:** re-parse the FULL `[sub, ...rest]` for these 6 commands — exactly as the existing `run`
command already does — recovering a flag-aware id (`positional[0]`) and the flags, in either order.
A shared `parseVerbless(sub, rest)` helper returns `{ flags, id }`; each branch adds an
`if (!id)` usage-error guard. `gate-log`-with-no-id becomes an explicit usage error (chosen
deliberately over the prior silent-empty output, for symmetry with the other five commands).
No change to `run` or `task view/edit/create` — this reuses the EXISTING correct `run` pattern,
not a third convention.

## Plan
`docs/plans/9-cli-arg-order-fix.md` (stages 9.1 TDD-RED → 9.2 helper → 9.3 apply-to-6-branches →
9.4 GREEN+regression). Milestone: M42-gate-cli-arg-order.

## Acceptance Criteria
- [x] `quay gate --gate dod <id>` (flag before the task id) behaves identically to
  `quay gate <id> --gate dod` (documented order) — both exit with the correct pass/fail verdict, not a
  raw `Error: no such task: --gate` stack trace. (Confirmed: test `C [ARG-ORDER]: gate --gate dod <id>
  == id-first` in gate.test.mjs — flag-first now exits 0 PASS with --gate dod correctly routed.)
- [x] The same fix applies to all 6 affected commands (`gate`, `gate-log`, `complete`, `adjudicate`,
  `promote`, `retreat`) — each accepts its id positional in either order. (Confirmed: `parseVerbless`
  applied to all 6 branches in bin/quay.js; each also guards missing-id.)
- [x] `quay gate-log` with no id → explicit usage error (chosen deliberately over silent empty).
  (Confirmed: test `C [ARG-ORDER]: gate-log with NO id → explicit usage error` — exits nonzero with
  "missing required <task-id>".)
- [x] Regression tests added covering flag-before-id for at least `gate` and `complete`.
  (Confirmed: 2 tests in gate.test.mjs + 1 in lifecycle.test.mjs; all green.)
- [x] No change to `run`'s parsing path, and no change to `task view/edit/create`'s `positional[0]`
  extraction — the 6 QENG commands are made consistent with the EXISTING correct `run` pattern.
  (Confirmed: `run` and `task *` branches untouched; 144/144 non-network tests pass.)

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present, 1
per-milestone acceptance audit, 2 V_meta-lag, 3 line-budget, 4 impl-row — N/A unless scoped
design-only, 5 no-self-exemption, 6 escrow-Δv — N/A unless scoped design-only, 7 test-floor —
APPLIES, `surface:cli` is product-touching). No task-specific exemption from any clause.

## Value type / cadence
exploit (bug fix on a just-shipped, previously-unexamined CLI surface) — Δv̂ small-but-real: this is a
genuine, reproducible crash-on-misuse in a command family the driver (`quay run`) and any future
exp5-loop-via-quay-gate migration would depend on; a confusing raw stack trace on a simple argument-
order mistake is exactly the kind of UX defect that erodes trust in a new CLI surface early. Not
blocking (workaround: always put the id immediately after the command, which the current `--help`
text already documents correctly), so sized as a small exploit-tier fix, not urgent/blocking.
