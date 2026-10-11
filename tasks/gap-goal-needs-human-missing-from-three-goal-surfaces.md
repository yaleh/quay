---
id: gap-goal-needs-human-missing-from-three-goal-surfaces
title: Goal status needs-human is missing from three goal surfaces registered as
  KNOWN_DRIFT with no owning task
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
  role: primitive
---
## Proposal
`plugin/scripts/enum-surface-parity-check.ts` registers three `goal-status` surfaces in `KNOWN_DRIFT`, each `missing: ["needs-human"]`, and each reason ends "归位待另行立案" (to be filed separately). No task was ever filed, so the drift has no owner. The ABI (`packages/quay/src/abi.ts` `GOAL_STATUSES`) and the store (`goal-store.ts` `VALID_GOAL_STATUSES`) both have 6 values, including `needs-human`. The surfaces are:
1. `serve-goal-status-order`: `packages/quay/src/serve-goal.ts` `GOAL_STATUS_ORDER` (around line 225). A needs-human goal sinks to the bottom as an "unknown" status, but it is a state that needs a human.
2. `serve-goal-status-tabs`: the `statusNav` literal `["draft","active","achieved","superseded","retired"]` in `serve-goal.ts` (around line 623). There is no filter link that reaches `?status=needs-human`.
3. `native-goal-write-desc`: the `goal_write` description in `packages/quay-native/src/mcp-server.ts` (around line 454) says `status ∈ draft|active|achieved|superseded|retired`.

The defect is latent: 0 goals are in needs-human today. The checker at HEAD prints "PASS: all 25 registered surfaces consistent (6 known drift, 0 not evaluated)".

<!-- dedup-ref --> `gap-enum-surfaces-hand-copied-across-cli-web-docs` (done) built the checker and decided needs-human belongs in the ABI. It left these three as reported-only ledger entries. The three driver-kind `KNOWN_DRIFT` entries (`start-drivers-kinds`, `claude-md-driver-kind`, `drivers-skill-kind`) are OUT of scope: each needs a judgment call (intended subset or stale copy), so they are not determinable.

## Plan
- Add `needs-human` to `GOAL_STATUS_ORDER`. Place it directly after `draft` (both need a human action). Update the order comment.
- Add `needs-human` to the goals-tab status filter list.
- Add `needs-human` to the quay-native `goal_write` description.
- Remove the three entries from `KNOWN_DRIFT`. The ledger is shrink-only.
- Do not touch `serve-dashboard.ts` `AC_ROLLUP_IN_DOMAIN_STATUSES`. It is an intentional subset with its own rationale and exhaustiveness test, and it serves as the negative control.

## Acceptance Criteria
- [ ] `node --experimental-strip-types plugin/scripts/enum-surface-parity-check.ts` exits 0, and its output reports `3 known drift` (down from 6) and `0 not evaluated`.
- [ ] `grep -c 'native-goal-write-desc\|serve-goal-status-order\|serve-goal-status-tabs' plugin/scripts/enum-surface-parity-check.ts` still finds the three registry rows, but none of them appears in the `KNOWN_DRIFT` array. The registry stays; only the ledger shrinks.
- [ ] A test renders the goals list with one needs-human goal plus one goal in each other status. The needs-human row sorts right after draft and before achieved/superseded/retired. Its tab nav contains a link with `status=needs-human`.
- [ ] Negative control: after this change, run `enum-surface-parity-check.ts --discover`. It still lists `serve-dashboard.ts` `AC_ROLLUP_IN_DOMAIN_STATUSES` as an unregistered intentional subset, and that file has no diff in this task.
- [ ] Mutation control: temporarily delete `needs-human` from `GOAL_STATUS_ORDER` in the worktree. The checker must then exit non-zero, because the drift grew relative to the ledger. Record the output, then restore the line.

## Definition of Done
- All AC ticked with command output pasted into the task body.
- `scripts/test.sh --for-task gap-goal-needs-human-missing-from-three-goal-surfaces` green.

## Touches
- tasks/gap-goal-needs-human-missing-from-three-goal-surfaces.md
- packages/quay/src/serve-goal.ts
- packages/quay-native/src/mcp-server.ts
- plugin/scripts/enum-surface-parity-check.ts
- packages/quay/test/serve-goal-status-needs-human.test.mjs (new)
