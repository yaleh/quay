---
id: exp5-M-GATE-CLI-ARG-ORDER
title: "Fix flag-before-positional-id crash across the 6 QENG verb-less
  commands (gate/gate-log/complete/adjudicate/promote/retreat) — a leading
  flag is silently misread as the task id, producing a raw stack trace or a
  silent empty result instead of a usage error"
status: todo
labels:
  - milestone-candidate
  - surface:cli
  - milestone:M37-discover-post-qeng
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

## Acceptance Criteria
- [ ] `quay gate --gate dod <id>` (flag before the task id) behaves identically to
  `quay gate <id> --gate dod` (documented order) — both exit with the correct pass/fail verdict, not a
  raw `Error: no such task: --gate` stack trace. Reproduced pre-fix: `node bin/quay.js gate --gate dod
  QENG-1` throws `Error: no such task: --gate` (see report.iteration-1.md for the full trace).
- [ ] The same fix applies to all 6 affected commands (`gate`, `gate-log`, `complete`, `adjudicate`,
  `promote`, `retreat`) — each accepts its id positional in either order relative to its own flags
  (`--file`, `--gate`, `--reason`, `--json`).
- [ ] `quay gate-log` invoked with only flags and no id (e.g. `quay gate-log --gate acceptance`)
  currently exits 0 with silent EMPTY output (no error at all — a distinct, arguably worse failure
  mode than the throw-based commands, since there is no signal anything went wrong). After the fix,
  a missing id either lists ALL events unfiltered-by-id (if that is a sensible reading of "no id
  given") or produces an explicit usage error — pick one deliberately and document it; do not leave
  it silently ambiguous.
- [ ] Regression tests added covering flag-before-id invocation for at least `gate` and `complete`
  (the two with existing test suites — `packages/quay/test/gate.test.mjs`,
  `packages/quay/test/lifecycle.test.mjs`) — the existing `acceptance.test.mjs` regression test
  ("C1 [regression]: `--gate dod` still routes to QENG-1's dod gate") only exercises the documented
  id-first order (`runQuay(["gate", "COMPLIANT", "--gate", "dod", ...])`), never the reversed order —
  confirmed via direct grep of the test file at survey time.
- [ ] No change to the already-correct `run` command's parsing path, and no change to `task
  view`/`edit`/`create`'s already-correct `positional[0]` extraction — this fix should make the 6
  QENG commands consistent with the EXISTING correct pattern already used elsewhere in the same file,
  not invent a third parsing convention.

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
