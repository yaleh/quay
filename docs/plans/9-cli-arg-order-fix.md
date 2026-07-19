# Plan 9 — Fix flag-before-positional-id crash across the 6 QENG verb-less commands

**Milestone:** M42-gate-cli-arg-order (exp5-M-GATE-CLI-ARG-ORDER). Development-class
(`capability-growth`, product CLI code). Produced via the `quay-task-to-plan` pipeline
wired into OUTER-LOOP step 5a (DIR-014 items 2/3) — this is that pipeline's first live
customer (DIR-014 item 4 dogfood).

## Reconciled approach (adjudicated from 2 independent proposals + grounded correction)

Two independent blank-slate proposals converged on: derive the id flag-aware instead of
from raw `sub`; `gate-log` with no id → explicit usage error; don't touch `run` or
`task view/edit/create`. They DIVERGED on mechanism (A: `positional[0]` per branch;
B: a shared `resolveTaskId(sub, positional)` helper).

**Grounded adjudication caught that BOTH were insufficient** (empirically verified against
the real `parseFlags` + argv destructure): for a verb-less command, `const {flags,positional}
= parseFlags(rest)` parses only `rest = argv[4:]`. When a flag leads (`quay gate --gate dod ID`),
`--gate` sits in `sub` (not `rest`), so parseFlags never consumes it — its value `dod` is
misread as a positional AND `flags.gate` is silently lost (defaults to acceptance). So
`positional[0]` = "dod" (wrong), not the id. Both A and B read that broken `positional`.

**Correct fix = re-parse the FULL `[sub, ...rest]`**, exactly as the existing `run` command
already does — recovering both a flag-aware id (`positional[0]`) and the flags, in either order.
No third parsing convention introduced.

## Stages

- **9.1 (TDD RED):** add flag-before-id tests to `test/gate.test.mjs` (`gate --gate dod <id>`
  == id-first; `gate-log` no-id → usage error) and `test/lifecycle.test.mjs`
  (`complete --file <log> <id>`). Confirm they fail on the unfixed code.
- **9.2 (helper):** add `parseVerbless(sub, rest)` beside `parseFlags` — returns
  `{ flags, id }` from `parseFlags([sub, ...rest].filter(a => a !== undefined))`.
- **9.3 (apply):** replace `const id = sub;` + `flags.*` in all 6 branches
  (`gate`/`gate-log`/`complete`/`adjudicate`/`promote`/`retreat`) with the reparsed
  `{ flags: vf, id }`; add `if (!id)` usage-error guard to each (closes `gate-log`'s
  silent-empty case deliberately). Leave `run` and `task *` untouched.
- **9.4 (GREEN + regression):** all non-network suites green (144/144, incl. the 3 new).

## Guardrails
`run` (already re-parses `[sub,...rest]`) and `task view/edit/create` (already `positional[0]`
from their own `rest`) are untouched — this fix makes the 6 QENG commands consistent with the
EXISTING correct `run` pattern, not a new convention.
