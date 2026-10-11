---
id: gap-per-task-suite-record-required-fields-declared-twice
title: "per-task-suite-record: the checker declares its own copy of
  REQUIRED_FIELDS instead of importing the writer's, so the record contract can
  drift silently"
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
Found by the pre-registered blind A/B experiment `E-HYPGEN-AB-1` (arm B, verifier cluster c8, verdict supported, no documented intentional difference). It was then independently re-checked by the operator on 2026-10-12, at both pin `e3163e519` and current develop:
- `plugin/scripts/per-task-suite-record.ts:78` declares `export const REQUIRED_FIELDS = ["taskId","runId","state","laneCount","durationMs","startedAt","finishedAt"]` (the writer).
- `plugin/scripts/per-task-suite-record-check.ts:72` declares its OWN `export const REQUIRED_FIELDS = [...]` with the same 7 names. It validates records against that copy (around line 107).
- The checker already imports from the writer module (`import { resolveSharedCheckout } from "./per-task-suite-record.ts";`, line 69), but not `REQUIRED_FIELDS`.
- No comment or test in either file says the copy is deliberate or keeps the two in sync.

So a field added to the writer would not be required by the checker, or the other way round. Nothing would fail.

None of the earlier hypothesis-generation runs named this pair, and no task covers it. The `## Touches` overlaps (`gap-ac63-judgment2-no-carrier`, `gap-ac72-cert-mechanism-retire`) concern other problems.

## Plan
- The checker imports `REQUIRED_FIELDS` from `per-task-suite-record.ts` and deletes its local literal.
- Keep the checker's exported name `REQUIRED_FIELDS` as a re-export, so existing importers still work.
- No change to which fields are required.

## Acceptance Criteria
- [ ] `node --test plugin/test/per-task-suite-record*.test.mjs` exits 0. It includes a new case asserting that the checker's `REQUIRED_FIELDS` is the same array object as the writer's (`===`).
- [ ] `grep -n 'export const REQUIRED_FIELDS' plugin/scripts/per-task-suite-record-check.ts` prints nothing. Paste the output.
- [ ] Mutation control: add an 8th name to the writer's `REQUIRED_FIELDS` in a temporary copy, and show the checker now reports a record missing that field as invalid. Paste the output, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-per-task-suite-record-required-fields-declared-twice` green.

## Touches
- tasks/gap-per-task-suite-record-required-fields-declared-twice.md
- plugin/scripts/per-task-suite-record-check.ts
- plugin/test/per-task-suite-record-check.test.mjs
