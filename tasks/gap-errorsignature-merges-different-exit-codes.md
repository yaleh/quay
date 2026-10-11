---
id: gap-errorsignature-merges-different-exit-codes
title: errorSignature turns every exit code into <n>, merging OOM-kill, timeout
  and ordinary failures into one signature
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
`errorSignature` (`plugin/scripts/meta-driver.ts` around line 688: `s = s.replace(/\d+/g, "<n>")`) also normalises the exit code in `Exit code N …`. I measured it on 2026-10-11 by applying it to the 3636 real records in `.quay/action-record-scan.json`:
- 9 signature groups mix different exit codes.
- The largest is the bare `Exit code <n>`: 160 records spanning exit codes 144, 1, 123, 2, 255, 137, 5, 124 and 7.
- Exit codes 137 (SIGKILL, OOM-shaped), 124 (timeout) and 1/2 (ordinary failure) are different failure classes, so the action-failure aggregation counts them as one recurring error.

The impact is latent today: the action-record reading is `unthresholded` in production, so no decision has used it yet. Once thresholds are set, the merge would drive real decisions.

<!-- dedup-ref --> `gap-meta-driver-action-record-failure-aggregation-reading` (done) introduced `errorSignature`. `gap-retry-exemption-signature-keeps-volatile-values` (done) deliberately kept worker-driver's signature separate; this task does not merge the two.

## Plan
Preserve the leading `Exit code N` token verbatim. Keep normalising every other number, hex string and path as today. No other change.

## Acceptance Criteria
- [x] `node --test plugin/test/meta-driver.test.mjs` exits 0, with new cases:
  - (a) `Exit code 137` and `Exit code 1` with otherwise identical text give different signatures.
  - (b) `Exit code 1 … line 42` and `Exit code 1 … line 99` still give the same signature.
  - Evidence: `node --test plugin/test/meta-driver.test.mjs` → `tests 138 / pass 138 / fail 0`, exit 0; new case `errorSignature: 保留开头 Exit code N；其余数字照常归一化` ✔ (asserts (a) notEqual + `^Exit code 137\b`/`^Exit code 1\b`, and (b) equal).
- [x] Real-data reading: apply the new `errorSignature` to every record of `/data/home/yale/work/quay/.quay/action-record-scan.json`. Paste three things:
  - the group count before and after;
  - the count of groups that mix exit codes, which must be 0 after;
  - the 3 largest groups after.
  - Evidence (`.quay/ac-signature-measure.mts`, 3636 records): group count before = **2632**, after = **2650**. Groups mixing exit codes: before = **9**, after = **0**. 3 largest groups after: `n=76 Exit code 144`; `n=62 Exit code 143 Command timed out after <n>m <n>s`; `n=55 File does not exist. Note: your current working directory is <path>`. (Before, the largest group was `n=160 Exit code <n>` spanning codes 144/1/123/2/255/137/5/124/7.)
- [x] Mutation control: revert to the plain `\d+` replacement and show case (a) goes red. Paste the output, then revert.
  - Evidence (plain `\d+` replacement restored): `node --test --test-name-pattern "保留开头 Exit code N" plugin/test/meta-driver.test.mjs` → `tests 1 / pass 0 / fail 1`, `AssertionError [ERR_ASSERTION]: 不同退出码（OOM vs 普通失败）不得并成同一个签名` — `actual: 'Exit code <n>: killed'`, `expected: 'Exit code <n>: killed'`. Reverted to the fix afterwards; same test then `pass 1 / fail 0`.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-errorsignature-merges-different-exit-codes` green.

## Touches
- tasks/gap-errorsignature-merges-different-exit-codes.md
- plugin/scripts/meta-driver.ts
- plugin/test/meta-driver.test.mjs
