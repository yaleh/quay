---
id: gap-ac69-malformed-record-exits-3-and-passes-the-static-gate
title: "ac69 check: a malformed measurement record exits 3, which run_checker
  treats as non-fatal, so the static gate stays green although the registry and
  mutation case expect RED"
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
I verified this on 2026-10-12 in a scratch worktree at develop `b9cc4bfce`. I ran the real production wrapper `run_checker` from `plugin/scripts/checker-cost-lib.sh`, the same one that `plugin/scripts/runner-static-gate.ts` calls at around line 666:

| Record state | Raw checker exit | run_checker result |
|---|---|---|
| valid | 0 | `PASS`, rc=0 |
| `conclusion` field dropped (malformed) | **3** | `STATIC_CHECK_NOT_EVALUATED`, **rc=0, the suite stays green** |
| record deleted | 2 | `STATIC_CHECK_FAILED exit=2`, rc=2 (red) |

- The registry comment (`runner-static-gate.ts` around lines 655-664) says "Mutation case + unit tests carry the negative control (delete record / drop conclusion ⇒ RED, restore ⇒ GREEN)".
- `run_checker` maps exit 3 to a non-fatal not-evaluated result (`checker-cost-lib.sh` around lines 158-160).
- `ac69-slot-queue-gap-check.ts` sets `EXIT_MALFORMED = 3` (around line 16).
- The mutation case `plugin/scripts/checker-mutation-cases/ac69-slot-queue-gap-check.sh` (inject (2), around line 48) asserts only that the RAW checker exits non-zero. So it passes, even though the production gate does not go red.

The effect is latent today: the committed record is valid. But a corrupted record would not block a landing.

This is the only confirmed misjudgment from a 2026-10-12 trace of checker exit-code 2/3 producers and consumers. The other mismatches found in that trace are out of scope here: capability-manifest-check and criterion-carrier-inline-check exit 2 for not-evaluated and are treated as red, and their intended behaviour has not been established.

## Plan
1. A present but structurally invalid record has been read and judged, so it is a FAIL. Make the malformed path exit 1. Keep exit 2 for an absent record, which is red today.
2. Change the mutation case to judge each injected fault through `run_checker` semantics, not the raw exit code: exit 3 counts as staying green. Inject (2) must then show `STATIC_CHECK_FAILED`.
3. Correct the registry comment so it matches the exit codes the checker actually returns.
4. Look for other cases of the same defect class (hard rule 5b). For every checker invoked through `run_checker` in `runner-static-gate.ts` that has a mutation case under `plugin/scripts/checker-mutation-cases/`, find whether any injected fault makes the checker exit 3. List them. Report only; do not fix the others in this task.
5. `.sh` edits may be counted by the sh-census ratchet. If the census check reddens, keep the diff line-neutral.

## Acceptance Criteria
- [ ] `node --test plugin/test/ac69-slot-queue-gap-check.test.mjs` exits 0. It includes a case where a record missing `conclusion` gives exit 1.
- [ ] Production-path control. In the task worktree, source `plugin/scripts/checker-cost-lib.sh` and call `run_checker "ac69-slot-queue-gap-check" node --no-warnings --experimental-strip-types plugin/scripts/ac69-slot-queue-gap-check.ts --root "$PWD"` three times, with: the valid record, the record with `conclusion` deleted, and the record deleted. Paste the three outputs; they must give rc 0, rc≠0 with `STATIC_CHECK_FAILED`, and rc≠0 with `STATIC_CHECK_FAILED`. Restore the record afterwards.
- [ ] `bash plugin/scripts/checker-mutation-cases/ac69-slot-queue-gap-check.sh` exits 0. Then temporarily revert the checker to exit 3 for the malformed case and show the mutation case now fails; paste that output and revert.
- [ ] Class scan (5b): paste the number of checkers found in Plan step 4, and the first 3, with the injected fault and the exit code for each.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-ac69-malformed-record-exits-3-and-passes-the-static-gate` green.

## Touches
- tasks/gap-ac69-malformed-record-exits-3-and-passes-the-static-gate.md
- plugin/scripts/ac69-slot-queue-gap-check.ts
- plugin/scripts/checker-mutation-cases/ac69-slot-queue-gap-check.sh
- plugin/scripts/runner-static-gate.ts
- plugin/test/ac69-slot-queue-gap-check.test.mjs
