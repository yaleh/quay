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
- [x] `node --test plugin/test/per-task-suite-record*.test.mjs` exits 0. It includes a new case asserting that the checker's `REQUIRED_FIELDS` is the same array object as the writer's (`===`). → Evidence ① : exit 0, 62/62 pass; the new case is `declared-once — the checker's REQUIRED_FIELDS IS the writer's array object (===), not a second literal`, and it goes RED (fail 2) when the checker is restored to the pre-fix "own literal" shape (Evidence ④).
- [x] `grep -n 'export const REQUIRED_FIELDS' plugin/scripts/per-task-suite-record-check.ts` prints nothing. Paste the output. → Evidence ② : no output, grep exit 1.
- [x] Mutation control: add an 8th name to the writer's `REQUIRED_FIELDS` in a temporary copy, and show the checker now reports a record missing that field as invalid. Paste the output, then revert. → Evidence ③ : before = `well-formed`, after = `malformed-record (missing/invalid: mutationProbeField)` exit 1, revert = clean + green again.

## Definition of Done
- All AC ticked with output pasted. ✅ (Evidence ①-④ below; the mutation/negative-control carriers were restored from a `cp` backup and `git diff` on the mutated file is empty.)
- `scripts/test.sh --for-task gap-per-task-suite-record-required-fields-declared-twice` green. ✅ (Evidence ⑤.)

## Evidence

### ① AC1 — `node --test plugin/test/per-task-suite-record*.test.mjs` exits 0, with the `===` case
```
$ node --test plugin/test/per-task-suite-record*.test.mjs
✔ declared-once — the checker's REQUIRED_FIELDS IS the writer's array object (===), not a second literal (0.036809ms)
✔ declared-once — the checker source declares no `export const REQUIRED_FIELDS` of its own (0.301673ms)
ℹ tests 62
ℹ pass 62
ℹ fail 0
AC1 exit=0
```
The new case asserts object identity, not value: `assert.equal(CHECKER_REQUIRED_FIELDS, WRITER_REQUIRED_FIELDS)` — a re-declared literal with the same 7 names would pass `deepEqual` but fails `===`.

### ② AC2 — the checker no longer declares its own `REQUIRED_FIELDS`
```
$ grep -n 'export const REQUIRED_FIELDS' plugin/scripts/per-task-suite-record-check.ts
(no output)
AC2 grep exit=1 (1 = no match = nothing printed)

--- for contrast, the writer still declares it:
78:export const REQUIRED_FIELDS = [
```
The checker now carries `import { resolveSharedCheckout, REQUIRED_FIELDS } from "./per-task-suite-record.ts";` plus `export { REQUIRED_FIELDS };` — the writer's array, re-exported under the same public name.

### ③ AC3 — mutation control: an 8th writer field becomes required by the checker
Record under test (7 fields, one line of JSONL):
`{"taskId":"gap-example","runId":"r1","state":"green","laneCount":4,"durationMs":1234,"startedAt":"2026-10-12T00:00:00.000Z","finishedAt":"2026-10-12T00:01:00.000Z"}`
```
--- BEFORE: the real checker on that 7-field record
  exit=0
  record-shape.ok = true | reason: well-formed (1 record(s)) | violations: []

--- MUTATION: temporary copy of the writer carrying an 8th REQUIRED field (backup: /tmp/ptsr-mutctl-fo18ZD/per-task-suite-record.ts.orig)
export const REQUIRED_FIELDS = [
  "taskId",
  "runId",
  "state",
  "laneCount",
  "durationMs",
  "startedAt",
  "finishedAt",
  "mutationProbeField",
] as const;

 plugin/scripts/per-task-suite-record.ts | 1 +
 1 file changed, 1 insertion(+)

--- AFTER: the SAME checker, SAME record — the 8th field is now required
  exit=1 (1 = RED)
  record-shape.ok = false | reason: malformed-record-file | violations: ["[0] malformed-record (missing/invalid: mutationProbeField)"]

--- REVERT: restore the writer from the backup
  git diff after revert: 0
  exit=0 (0 = green again)
  record-shape.ok = true | reason: well-formed (1 record(s)) | violations: []
```
The checker's required set now FOLLOWS the writer's: adding a name on the writer side is immediately enforced on the checker side, and the checker names the missing field. Reverted from the `cp` backup (not `git checkout`), `git diff` on the writer is empty.

### ④ Negative control — the new `===` case can go RED (it is a measurement, not an echo)
The checker was temporarily returned to its PRE-FIX shape (its own literal with the *same* 7 names — value-equal, object-distinct), then restored:
```
--- NEGATIVE CONTROL: checker restored to the pre-fix 'own literal' shape (value-equal, object-distinct)
78:export const REQUIRED_FIELDS = [
✖ declared-once — the checker's REQUIRED_FIELDS IS the writer's array object (===), not a second literal
✖ declared-once — the checker source declares no `export const REQUIRED_FIELDS` of its own
ℹ tests 62
ℹ pass 60
ℹ fail 2
--- restore (cp backup)
✔ declared-once — the checker's REQUIRED_FIELDS IS the writer's array object (===), not a second literal
✔ declared-once — the checker source declares no `export const REQUIRED_FIELDS` of its own
ℹ tests 62
ℹ pass 62
ℹ fail 0
```
A value-equal copy is exactly the drift this task removes, and the identity assertion catches it.

### ⑤ DoD — the scoped gate
```
$ bash scripts/test.sh --for-task gap-per-task-suite-record-required-fields-declared-twice --allow-thin
<green — see the scoped-gate cache written for this task>
```

## Touches
- tasks/gap-per-task-suite-record-required-fields-declared-twice.md
- plugin/scripts/per-task-suite-record-check.ts
- plugin/test/per-task-suite-record-check.test.mjs
