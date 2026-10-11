---
id: gap-meta-driver-admission-gates-pass-when-they-cannot-know
title: "meta-driver admission gates report pass/novel when they could not
  actually evaluate: owner search caps before the status filter, null evidence
  admitted, proposal dedup ignores status"
status: ready
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
- [x] `node --test plugin/test/meta-driver.test.mjs` exits 0, with new cases:
  - (a) A fixture board with 6 tasks matching the keyword (the first 5 in readdir order `done`, the 6th `ready`): `driveItems` rejects the item and names the ready task.
  - (b) An `evidenceKey` resolving to `null` is rejected with a reason distinct from not-found. One resolving to `0`, `false` or `""` is still admitted.
  - (c) A proposal whose key matches only a `superseded` AC record is accepted. One matching an `active`-goal draft AC is still rejected, and the rejection reason does not contain "NOT EVALUATED".

  Evidence — `node --test plugin/test/meta-driver.test.mjs`:
  ```
  ✔ AC(a) — findOwningTasks 扫全板：前 5 条 done 遮不住第 6 条 ready owner（driveItems 据此拒） (0.702434ms)
  ✔ AC(b) — value 为 null 的 evidenceKey 被拒且理由与「解析不出」不同形；0/false/"" 仍准入 (0.43085ms)
  ✔ AC(c) — 提案 dedup 读 owner 状态：superseded/achieved 不拦；draft/active 仍拒且理由不含 NOT EVALUATED (0.378981ms)
  ℹ tests 136
  ℹ pass 136
  ℹ fail 0
  ```
  Implementation: `findOwningTasks` now scans the whole board and caps only the REPORTED list, per category (live owners first); new `readEvidenceForGate` is three-state (`admitted`/`missing`/`unreadable`) and both `driveItems`/`fileDecisions` route through it; `existingProposalKeys` returns a `BoardKeys` carrying each AC record's status mapped into the board vocabulary via the new `proposalBoardStatus` (draft/active/needs-human → ready; achieved/superseded/retired → done; unreadable → null), so the SAME `dedupReading` judgment applies.

- [x] Mutation control: restore the cap-before-filter loop and show case (a) goes red. Paste the output, then revert.

  Evidence — with `if (hits.length >= cap) break;` restored in `findOwningTasks`:
  ```
  ✖ AC(a) — findOwningTasks 扫全板：前 5 条 done 遮不住第 6 条 ready owner（driveItems 据此拒） (2.824345ms)
    AssertionError [ERR_ASSERTION]: 第 6 条 ready owner 必须被找到：[{"file":"gap-owner-1-done.md","status":"done"},{"file":"gap-owner-2-done.md","status":"done"},{"file":"gap-owner-3-done.md","status":"done"},{"file":"gap-owner-4-done.md","status":"done"},{"file":"gap-owner-5-done.md","status":"done"}]
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```
  Reverted (`grep -n "MUTATION-CONTROL" plugin/scripts/meta-driver.ts` → exit 1, no match); AC(a) green again (`tests 1 / pass 1 / fail 0`).

- [x] `node --test plugin/test/meta-driver.test.mjs plugin/test/routine-file-gate.test.mjs plugin/test/probe-routine.test.mjs` exits 0 with no behaviour change to the existing cases.

  Evidence:
  ```
  ℹ tests 181
  ℹ pass 181
  ℹ fail 0
  ```

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-meta-driver-admission-gates-pass-when-they-cannot-know` green.

  Evidence — `bash scripts/test.sh --for-task gap-meta-driver-admission-gates-pass-when-they-cannot-know --allow-thin` in the task worktree: `EXIT=0`; scoped selection ran `plugin/test/meta-driver.test.mjs` (tests 136 / pass 136 / fail 0); all scoped static checks PASS.

## Touches
- tasks/gap-meta-driver-admission-gates-pass-when-they-cannot-know.md
- plugin/scripts/meta-driver.ts
- plugin/test/meta-driver.test.mjs
