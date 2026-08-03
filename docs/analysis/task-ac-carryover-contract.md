# task-ac-carryover-contract.md — the machine-readable AC-carryover shape

Single source for the `## Carries` convention consumed by
`plugin/scripts/task-ac-carryover-check.ts`
(task `gap-nothing-checks-whether-a-done-task-left-its-acs-behind`).

## The judgment (what is NOT the judgment)

The gate is **not** "all ACs checked → done". That bar invites **checkbox fraud** —
the closing task body records a real instance where an AC's prose claimed 达成 while its
box was unchecked. The bar is:

> **A `status: done` task may leave ACs unchecked ONLY IF a successor task explicitly names
> which of those ACs it carries, and every unchecked AC is covered. An unchecked AC with no
> named carrier is BLOCKED.**

This closes the gap the drift-check cannot see: `task-status-drift-check` judges whether the
**code** landed (symbol resolution + Touches existence), and in the measured instance
(session-liveness closing done with 8/16 ACs unchecked) the code **had** landed — so it
correctly stayed silent. Whether the **closeout** left ACs un-carried had **no** mechanical
executor until this gate.

## The `## Carries` shape (machine-readable)

The carrying relationship lives in the **successor** task as a `## Carries` section with
exactly two fields:

```
## Carries

from: <predecessor-task-id>
acs: AC9, AC10, AC11, AC12, AC13, AC14, AC14b
```

- `from:` — the `id:` of the predecessor task whose ACs this successor carries (one id).
- `acs:` — a comma-separated list of that predecessor's `AC<n>` identifiers this successor
  carries. One successor carrying from several predecessors uses one `## Carries` section
  per predecessor.

The shape is **parsed positionally** by `task-ac-carryover-check.ts` — a prose mention in a
Proposal ("this task carries the rest") does **not** satisfy the check. That is deliberate:
a rule with no executor is the exact family this task exists to close, and a prose-mention
match would let the rule become one.

Only unchecked boxes that carry an `AC<n>` id are in scope — an id is what a successor can
name. A done task whose unchecked boxes carry no `AC<n>` id is reported as `unnamed` (info,
never a block): the mechanism cannot reference them.

## Negative control is two-way

- A done task with half its ACs unchecked and **no** successor → **BLOCKED**, reporting
  exactly which `AC<n>` ids are missing (AC3).
- The same task **with** a successor whose `## Carries` covers those ids → **PASSED** (AC4).
- A successor carrying only part of the unchecked set → **BLOCKED** for the remainder,
  reporting the missing ids (AC5).

Proving only "can block" is indistinguishable from "blocks everything", so both directions
are pinned by fixtures in `plugin/test/task-ac-carryover-check.test.mjs`.

## Executor

`task-ac-carryover-check.ts` is wired into `scripts/test.sh`'s `run_static_checks` — the same
site as `task-contract-check` — so every test-running invocation, and CI (whose only test
step is `bash scripts/test.sh`), enforces the ratchet for free.

## Legacy baseline (shrink-only)

The store has done tasks that predate the carries convention. They are baselined in
`docs/analysis/task-ac-carryover-baseline.md` (one `<task-id>: <AC-id>` per line) so the
gate does not block the whole store at once. The list can **only get shorter**:

- a NEW unowned AC not in the baseline exits 1 (a done task just closed with uncarried ACs);
- regenerate with `--write-ratchet` after an AC gains a carrier; the write refuses growth;
- `--write-ratchet --reset-baseline` is the deliberate one-shot re-baseline after a criterion
  change.
