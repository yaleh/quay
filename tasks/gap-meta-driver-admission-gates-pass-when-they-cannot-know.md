---
id: gap-meta-driver-admission-gates-pass-when-they-cannot-know
title: "meta-driver admission gates report pass/novel when they could not
  actually evaluate: owner search caps before the status filter, null evidence
  admitted, proposal dedup ignores status"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal
I read all three at develop `e3163e519`. They are the same defect family (hard rule 3b: a gate that could not evaluate returns the same answer as a gate that passed):
1. **Owner search caps before the status filter.** `findOwningTasks` (`plugin/scripts/meta-driver.ts` around line 1545: `if (hits.length >= cap) break;`) stops after 5 substring hits of ANY status. `blockingOwners` filters done/superseded afterwards, at around line 1788. With 2622 of 2698 tasks `done`, a common mechanism keyword can fill the cap with done tasks. A live 6th owner is then never seen, the item is filed as a duplicate, and the gate reports that no live owner exists.
2. **Null evidence is admitted.** `resolveEvidence` (around lines 1506-1524) rejects only `undefined`. A reading whose value is `null` (meaning "could not be read", for example a driver's `running: null`) passes the evidence gate of both `driveItems` and `fileDecisions` as if it were evidence.
3. **Proposal dedup ignores status.** `existingProposalKeys` (around lines 1104-1116) adds the key of every `AC-*` record regardless of status, so a superseded or achieved AC blocks a matching proposal forever. The probe-routine path fixed this same "done key permanently suppresses" shape with `dedupReading`'s `done-only` state. In addition, the plain `Set` passed to `gateFinding` makes the rejection reason read "bare Set … NOT EVALUATED", which is wrong: it was evaluated.

<!-- dedup-ref --> Related done work: `gap-meta-autodrive-id-collides-with-done-owner` added the status field and `blockingOwners`, but not the cap ordering. `gap-ac214-eighth-crossing-done-key-permanently-suppresses-escalation` fixed the probe-routine side only.

## Plan
- `findOwningTasks`: apply the cap to BLOCKING owners, or scan everything and cap only what is reported. A live owner anywhere in the board must be found.
- `resolveEvidence`: return a distinct "unreadable" result for `null`. The callers reject it with their own reason code, separate from "evidence key not found".
- Proposal dedup: route it through `dedupReading` with owner status (using the same board-key shape as the probe path), or at least exclude superseded/achieved AC records and stop passing a bare `Set`.
- Do not change caps, quotas, or any other admission rule.

## Acceptance Criteria
- [ ] `node --test plugin/test/meta-driver.test.mjs` exits 0, with new cases:
  - (a) A fixture board with 6 tasks matching the keyword (the first 5 in readdir order `done`, the 6th `ready`): `driveItems` rejects the item and names the ready task.
  - (b) An `evidenceKey` resolving to `null` is rejected with a reason distinct from not-found. One resolving to `0`, `false` or `""` is still admitted.
  - (c) A proposal whose key matches only a `superseded` AC record is accepted. One matching an `active`-goal draft AC is still rejected, and the rejection reason does not contain "NOT EVALUATED".
- [ ] Mutation control: restore the cap-before-filter loop and show case (a) goes red. Paste the output, then revert.
- [ ] `node --test plugin/test/meta-driver.test.mjs plugin/test/routine-file-gate.test.mjs plugin/test/probe-routine.test.mjs` exits 0 with no behaviour change to the existing cases.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-meta-driver-admission-gates-pass-when-they-cannot-know` green.

## Touches
- tasks/gap-meta-driver-admission-gates-pass-when-they-cannot-know.md
- plugin/scripts/meta-driver.ts
- plugin/test/meta-driver.test.mjs
