---
id: gap-self-report-vocab-audit-check-pattern-tables-diverge
title: "self-report-vocab audit vs check: same task implemented twice, pattern
  tables + stopped-state fix diverged"
status: done
labels:
  - gap
  - discovery-finding
parent: null
children: []
extra: {}
---
## Proposal
Two live modules implement the SAME task (`gap-reanchor-must-converge-inner-self-reported-vocabulary`) — the inner self-report batch-vocabulary detector — with diverged behaviour:

- `plugin/scripts/self-report-vocab-audit.ts` — `BATCH_FLAG_PATTERNS` (`batch-of` `/\bBatch\s+of\b/i`, `batch-num` `/\bbatch\s*[-_/]?\s*\d/i`, `按批`), plus the stopped-state exemption (`STOPPED_MARKERS`, commit `e0c2e222c`, task `gap-self-report-vocab-misfires-on-stopped-state`). Wired: `orchestration/orchestrator-loop-tick.md:936`.
- `plugin/scripts/self-report-vocab-check.ts` — `BATCH_SELF_REPORT_PATTERNS` (`batch-of` `/\bBatch\s+of\s+\d+\b/i`, `batch-count`, `batch-id` `/\bbatch[-_ ]?(\d+)(?![-_a-zA-Z])/i`, by-batch), its own state file `.quay/self-report-vocab-state.json`, and ZERO stopped-state handling (`grep -c -i stopped` = 0 vs 30 in the audit module).

Measured divergence (2026-10-12, operator re-check of discovery finding `GAIN1-CTRL-c10`, portfolio `portfolio_finding-18e675aff86564f8`): input `batch4a` → audit flags (`batch-num` true), check does not (`batch-id` false, by its explicit lookahead). `Batch of N` without a digit → audit flags, check does not. A stopped-loop window → audit waives window-full, check has no such arm. The stopped-state fix landed in ONE copy only — the sibling instance was never fixed (hard rule 5b).

Origin: autonomous discovery — capability-gain experiment `gap-discovery-capability-gain-same-budget-open-exploration` (control arm cluster 10, learned arm cluster 11 is the same finding over a wider component set), confirmed by operator reading + a reproduction, not by the model alone.

## Plan
1. Decide the single source: keep ONE pattern table + ONE stopped-state rule + ONE convergence counter; the other module either delegates by import or is retired (if retired, remove its references and tests, and the capability-catalog declaration if any).
2. Reconcile the two pattern sets explicitly: for each divergent input class (`batch4a`-style suffix, `Batch of` without a digit, `batch N/M`), pick the intended verdict and record the choice in a comment that names the input.
3. Keep the wired surface (`orchestrator-loop-tick.md:936`) working with unchanged CLI flags, or update the doc in the same delta.

### Resolution taken
`self-report-vocab-audit.ts` is the SINGLE SOURCE (it is the older module, 2026-08-05 vs check's 2026-08-06, and the one that received the stopped-state fix); `self-report-vocab-check.ts` **delegates by import** — it is the shipped doc-wired surface (`plugin/loop/orchestrator-loop-tick.md` step 1c) and its `count`/`converged` JSON keys and CLI flags are unchanged, so retiring it was the larger and less truthful change. Removed from check: its private `BATCH_SELF_REPORT_PATTERNS` table, its private `nextConvergenceState` counter, and the state-file-as-counter (the file now records the shared reading, same path literal, so `docs/carrier-registry.json` stays accurate).

Reconciled verdicts, recorded by input in `BATCH_FLAG_PATTERNS`' comment and pinned by tests:

| input | verdict | why |
|---|---|---|
| `batch4a` / `batch2-queue-state.md` | CLEAN | digit followed by `[-_a-zA-Z]` = a historical artifact name (path/branch), which the vocabulary rule allows as a reference (`tick-vocabulary.test.mjs` SAFE_SUBSTRINGS) — check's lookahead was right, audit's old regex was the false alarm |
| `batch-2` / `batch_3` / `batch/4` | FLAG `batch-num` | numbered batch vocabulary |
| `batch 2/3` | FLAG `batch-num` | matches the `batch 2` head |
| `Batch of 3` and bare `Batch of` | FLAG `batch-of` | the signature is the PHRASE; a missing digit must not launder it clean — audit's broader form was right |
| `按批收尾` | FLAG `an-pi` | 按批 organizing language |
| `concurrent-batch-scheduler.ts` | CLEAN | mechanism true-name, no digit |

## Acceptance Criteria
- [x] After the change there is exactly ONE batch-vocabulary pattern table in `plugin/scripts/` (paste the grep that counts declarations of batch-style regex tables, before and after).
  ```
  # BEFORE (branch point bd2ae6f4a) — 2 declarations in 2 files:
  $ git grep -c -E "^export const (BATCH_FLAG_PATTERNS|BATCH_SELF_REPORT_PATTERNS)" bd2ae6f4a -- plugin/scripts/
  bd2ae6f4a:plugin/scripts/self-report-vocab-audit.ts:1
  bd2ae6f4a:plugin/scripts/self-report-vocab-check.ts:1
  # broader — every batch-style regex LITERAL, before: 2 files (audit :77,:78 · check :44,:49,:54)
  $ git grep -l -E "re: /.{0,12}(batch|Batch)" bd2ae6f4a -- plugin/scripts/
  bd2ae6f4a:plugin/scripts/self-report-vocab-audit.ts
  bd2ae6f4a:plugin/scripts/self-report-vocab-check.ts

  # AFTER (worktree) — 1 declaration in 1 file:
  $ grep -rc -E "^export const (BATCH_FLAG_PATTERNS|BATCH_SELF_REPORT_PATTERNS)" plugin/scripts/*.ts | grep -v ":0$"
  plugin/scripts/self-report-vocab-audit.ts:1
  $ grep -rl -E "re: /.{0,12}(batch|Batch)" plugin/scripts/*.ts
  plugin/scripts/self-report-vocab-audit.ts
  ```
  Behavioural ratchet (not a source grep) in `plugin/test/self-report-vocab-check.test.mjs`:
  `AC1 — check has NO pattern table of its own: a probe injected into the shared table reaches its verdict` — passing. It pushes a probe into `BATCH_FLAG_PATTERNS` and asserts `flagBatchVocab` flags it; a private copy would ignore the probe.
- [x] A parity test feeds the same inputs (`batch4a`, `batch-2`, `Batch of 3`, `Batch of`, `batch 2/3`, `按批收尾`, `concurrent-batch-scheduler.ts`, a stopped-state window) through every remaining entry point and asserts identical verdicts; paste the test output.
  ```
  $ node --no-warnings .quay/self-report-vocab-diverge/parity-table.mjs <worktree>
  input                                       audit         check         verdict   converged
  batch4a                                     []            []            SAME      SAME
  batch-2                                     ["batch-num"] ["batch-num"] SAME      SAME
  Batch of 3                                  ["batch-of"]  ["batch-of"]  SAME      SAME
  Batch of                                    ["batch-of"]  ["batch-of"]  SAME      SAME
  batch 2/3                                   ["batch-num"] ["batch-num"] SAME      SAME
  按批收尾                                        ["an-pi"]     ["an-pi"]     SAME      SAME
  concurrent-batch-scheduler.ts               []            []            SAME      SAME
  inner: idle heartbeat, paused awaiting manager[]            []            SAME      SAME

  # the committed test (scripts/test.sh plugin/test/self-report-vocab-check.test.mjs):
  ✔ AC2 — parity: every parity input gets the SAME verdict at BOTH entry points (and the intended one)
  ✔ AC2 — parity: the two entry points agree on convergence over a mixed window
  ℹ tests 42 · pass 42 · fail 0   (both self-report-vocab test files, run together)
  ```
  The test asserts the INTENDED verdict per input as well as agreement, so "both entry points agree on nothing" cannot pass.
- [x] Negative control: re-introduce a divergent copy of one pattern in a scratch copy and show the parity test goes red; paste the red output.
  Scratch copy = `self-report-vocab-check.ts` copied outside the repo with its relative imports absolutized, patched to re-declare ONE divergent pattern (the pre-unification `batch-of`, which required `\d+`). The parity test is pointed at it via its test seam `$SELF_REPORT_VOCAB_CHECK_SCRIPT` (unset ⇒ production path, which is the only mode the committed suite uses):
  ```
  $ SELF_REPORT_VOCAB_CHECK_SCRIPT=/tmp/srvc-negctl-4qFEYj/self-report-vocab-check.ts \
      node --test --experimental-strip-types plugin/test/self-report-vocab-check.test.mjs
  ✖ AC2 — parity: every parity input gets the SAME verdict at BOTH entry points (and the intended one)
  ℹ tests 21 · pass 20 · fail 1
  AssertionError [ERR_ASSERTION]: parity failures:
    DIVERGED on "Batch of" (the signature is the PHRASE — a missing digit must not launder it clean): audit=[["batch-of"]] check=[]
  ```
  Exactly the parity arm goes red (every other test stays green), and the failure names the divergent input.
- [x] The stopped-state exemption applies on every remaining entry point (paste the stopped-window verdict).
  ```
  # same input, window 3: `inner: idle heartbeat, paused awaiting manager` (1 report < window)
  audit  {"inner_self_report_vocab": 0, "reports_total": 1, "window": 3, "stopped_in_window": true, "converged": true, "recent_clean": 1}
  check  {"count": 0, "reportsTotal": 1, "convergenceRounds": 3, "stoppedInWindow": true, "converged": true, "roundsClean": 1}

  ✔ AC4 — the stopped-state window is CONVERGED at BOTH entry points (window-full waived)
  ✔ AC4 — a batch-style report in a stopped window is STILL drift at both entry points (no regression)
  ```
  Before this change check had no stopped-state arm at all, so the second entry point read the same window as NOT converged (fail-closed on `reports < window`).

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-self-report-vocab-audit-check-pattern-tables-diverge` green.

## Touches
- tasks/gap-self-report-vocab-audit-check-pattern-tables-diverge.md
- plugin/scripts/self-report-vocab-audit.ts
- plugin/scripts/self-report-vocab-check.ts
- plugin/test/self-report-vocab-audit.test.mjs
- plugin/test/self-report-vocab-check.test.mjs
- orchestration/orchestrator-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
