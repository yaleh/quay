---
id: gap-ceiling-check-blind-to-task-canonical-gap-ids
title: "gap: execute-milestone.js's Verify-phase ceiling-check instruction only
  excludes DIR-NNN from the legacy gap-list.md lookup, not task-canonical
  gap-<slug> tasks — real false-positive block on M191"
status: done
labels:
  - gap
  - defect
  - human-steered
parent: null
children: []
extra:
  schema: v1
---
## Resolution, closed (2026-07-29)

Implemented by commit `38158d6` in both `execute-milestone.js` mirrors, then exercised by real M191
workflow runs against the charter that names
`gap-task-schema-plugin-mirror-touches-drift`,
`gap-symlink-mirror-noop-affects-5-more-scripts`, and
`gap-touches-orthogonality-symlink-isdirect-mismatch`.

The pre-fix M191 journal (`wf_ffad2538-f29`) first recorded the real failure: all three IDs were
passed to the legacy checker and returned `NOT-FOUND`. After the fix, the same workflow journal
recorded `ceiling-check`, `ok:true`, with the explicit vacuous-pass detail that all three IDs had
real `tasks/<id>.md` files and were therefore task-canonical. The later M191 iteration-2 journal
(`wf_b3cb3744-dad`) independently recorded the same `ok:true` result before returning Build
`outcome:"done"` at commit `a0a1d20`. This supplies the previously-missing real subsequent-Verify
evidence; no further implementation is required.

## Proposal

Extend `execute-milestone.js`'s Verify-phase `ceiling-check` instruction (line ~112, both mirrors)
so it skips any extracted ID for which a real task file exists at `tasks/<id>.md` — the same
TASK-CANONICAL exclusion already applied to `DIR-NNN` IDs, now also covering task-canonical
`gap-<slug>` tasks. Retrofitted with `## Proposal`/`## Plan` (2026-07-28) for schema conformance;
substance below is the real, root-caused defect and fix.

## Plan

N/A — same-session point fix (one instruction string, both `execute-milestone.js` mirrors), no
separate `docs/plans/*.md` needed. Human-steered discipline applies (driver execution-chain
script).

## Finding

Real, reproduced 2026-07-28 dispatching M191 (composite DIR-117+DIR-122, run `wf_ffad2538-f29`):
the milestone's own Verify phase returned `outcome:"needs-human", reason:"it0-checks-failed"`
because its `ceiling-check` sub-check failed. The charter's `## Scope` section mentioned 3 real,
existing task-canonical gap tasks by name (`gap-task-schema-plugin-mirror-touches-drift`,
`gap-symlink-mirror-noop-affects-5-more-scripts`, `gap-touches-orthogonality-symlink-isdirect-
mismatch`) as context for DIR-122's own work. The dispatched Verify agent, following its literal
instruction, extracted these as "gap-XXX-style IDs" and ran `it0-ceiling-check.sh --milestone 191
<the 3 ids>` — which greps ONLY `experiments/quay-continuous-bootstrap/gap-list.md` (a legacy file
from an earlier, unrelated experiment generation) and correctly reported all 3 as `NOT-FOUND`
(they are real `tasks/gap-<slug>.md` files, not legacy gap-list.md table rows) — exit 1, hard
block.

**Root cause**: the ceiling-check instruction already carries an explicit DIR-028 TASK-CANONICAL
exclusion for `DIR-NNN` IDs ("Skip DIR-NNN IDs entirely — directives are TASK-CANONICAL... not
tracked in experiments/quay-continuous-bootstrap/gap-list.md") but never extended the identical
reasoning to task-canonical `gap-<slug>` tasks, which are the SAME class of identifier (their own
`status` field is authoritative; they were never legacy gap-list.md entries either). This is the
same "DIR-028 migration left an old assumption behind in a check script" pattern already found
repeatedly this session (`.quay/gates.yml`/`config.yml` path divergence, `restart-readiness-
check.sh`, etc.) — just in a driver-workflow prompt string rather than a standalone script.

**Blast radius**: this will recur on ANY future charter whose Scope/Done-when section names a
real, modern `gap-<slug>` task — not specific to M191's own content. Confirmed the Verify agent's
own returned detail explicitly self-diagnosed this as a tooling-mismatch artifact, not a genuine
staleness finding, which is what made root-causing this fast and confident rather than
speculative.

## Requested action

1. Extend the `ceiling-check` instruction in `.claude/workflows/execute-milestone.js` (and the
   `plugin/workflows/execute-milestone.js` mirror) to also skip any extracted ID for which
   `tasks/<id>.md` exists on disk, using the same TASK-CANONICAL rationale already given for
   `DIR-NNN`.
2. Re-verify M191 (or the milestone active when this lands) passes its Verify phase's
   `ceiling-check` sub-check cleanly with the corrected instruction — real journal evidence, not
   asserted.

## Acceptance Criteria

- [x] Both `execute-milestone.js` mirrors' `ceiling-check` instruction text explicitly skip IDs
  matching an existing `tasks/<id>.md` file, not just `DIR-NNN` — grep-confirmable. -- [fixed
  2026-07-28: both mirrors edited identically, confirmed byte-identical via `diff`.]
- [x] A real subsequent Verify-phase run (the same or a later milestone whose charter names a
  task-canonical `gap-<slug>` ID in Scope/Done-when) shows `ceiling-check` returning
  `ok:true` with the vacuous-pass detail, not a `NOT-FOUND` false block — confirmed by real M191
  journals `wf_ffad2538-f29` and `wf_b3cb3744-dad`.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, the prompt-string edit alone is necessary but insufficient — a real subsequent Verify
run demonstrating the fix is required.

- [x] Landed on `master` under human-steered discipline (commit `38158d6`).
- [x] A real milestone's Verify phase, re-run after this fix, confirms the false-positive no
  longer occurs (M191 journals `wf_ffad2538-f29` and `wf_b3cb3744-dad`).

## Human verification when exp5 marks this task done

1. Does a charter naming a real `gap-<slug>` task in Scope/Done-when now pass `ceiling-check`
   cleanly instead of a false `NOT-FOUND` block?

## Touches

- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js
