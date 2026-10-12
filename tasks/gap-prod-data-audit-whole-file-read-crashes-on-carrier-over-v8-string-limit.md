---
id: gap-prod-data-audit-whole-file-read-crashes-on-carrier-over-v8-string-limit
title: "P0 develop-wide red: prod-data-audit reads whole carriers via
  readFileSync — meta-driver-round.jsonl >0x1fffffe8 ⇒ ERR_STRING_TOO_LONG
  blocks every fan-in; stream + NOT-EVALUATED"
status: ready
labels:
  - gap
  - defect
  - develop-wide-red
parent: null
children: []
extra: {}
---
## Proposal
**A develop-wide suite red, found 2026-10-13 ~02:18 (+0800).** `plugin/scripts/prod-data-audit.ts:426` reads every production carrier whole: `fs.readFileSync(located, "utf8")`. `.quay/meta-driver-round.jsonl` reached 537,028,872 bytes, which is above V8's maximum string length of 0x1fffffe8 = 536,870,888. Both REAL-CARRIER tests in `plugin/test/prod-data-audit.test.mjs` (:227, :309) now throw `ERR_STRING_TOO_LONG` (`classifyCarrier` ← `buildAudit:658`).

Evidence:
- the fan-in suite log `.quay/fan-in-suite-gap-discovery-method-per-round-quota-verify-reserve-deep-reflection~wk-prod-anchor~1791828953643-00613d.log`, lines ~6026-6057;
- the develop baseline log `…~baseline-1791829214376-1ab3bd.log` shows the same 2 `✖`. Every earlier fan-in suite log has 0 such errors.

The carrier keeps growing (≥59 MB in 24h), so until this is fixed EVERY fan-in is red in the same place, and every landing in flight degrades toward needs-human. The red belongs to no task's delta.

Under hard rule 3b, an audit that cannot read its input must report "could not evaluate". It must neither crash nor return a value shaped like a pass. Reading a size-unbounded append-only carrier into one string is also hard rule 4 corollary 2 (an implicit host-dependent limit).

## Plan
1. Replace the whole-file read in `classifyCarrier` (and any sibling whole-file read of a `.jsonl` carrier in the same file; grep and paste the hit count, hard rule 5b) with a line-streaming reader. Count records, find the landing-relative window and detect single-JSON-doc carriers WITHOUT materializing the file as one string.
2. If a carrier still cannot be read (I/O error, unparsable framing), return `threeState: NOT_EVALUATED` with an explicit reason such as `carrier-unreadable:<code>` and keep auditing the other carriers. Never throw out of `buildAudit`, and never report it as `verified`/found-with-0.
3. Keep the existing semantics for normal-size carriers byte-identical: same record counts, same dispositions.

## Acceptance Criteria
- [ ] AC1: a unit test with a synthetic `.jsonl` carrier larger than 0x1fffffe8 bytes, made as a sparse/streamed fixture (no 512 MB string in the test process), shows `classifyCarrier` returns a real record count via streaming, OR `NOT_EVALUATED` with a `carrier-unreadable`/size reason. It never throws. Negative control: restore `readFileSync(located,"utf8")` ⇒ the test goes red with `ERR_STRING_TOO_LONG`. Paste both.
- [ ] AC2: parity. On normal-size fixtures, the audit output before and after the change is identical (paste a diff of the JSON for the existing fixtures: empty).
- [ ] AC3: the real carrier. `node --test plugin/test/prod-data-audit.test.mjs` in the task worktree against the production `.quay` (meta-driver-round.jsonl > 512 MB at run time; paste `stat -c %s`) exits 0. Paste the TAP summary.
- [ ] AC4: the whole-file `.jsonl` reads remaining in `prod-data-audit.ts` are listed. Each is either converted or justified as bounded. Paste the `grep -n readFileSync` hits before and after.

## Definition of Done
- `scripts/test.sh --for-task <this task>` green, including the full suite at fan-in.
- No production carrier is modified, truncated or rotated by this task.

## Touches
- tasks/gap-prod-data-audit-whole-file-read-crashes-on-carrier-over-v8-string-limit.md
- plugin/scripts/prod-data-audit.ts
- plugin/test/prod-data-audit.test.mjs
