---
id: gap-cli-serve-port-test-flaky-ci-timeout
title: cli.test.mjs's "quay serve --port" reachability test fails under real CI
  resource contention — fixed 5s poll budget too tight under
  --test-concurrency=8
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
## Finding

Real CI run [30204233175](https://github.com/yaleh/quay/actions/runs/30204233175) (triggered
2026-07-26, the first real CI exercise of DIR-109's new `scripts/test.sh` canonical runner) came
back with the `test` job overall FAILED: `517 tests / 513 pass / 1 fail / 3 skipped`. The single
failure:

```
FAIL: quay serve --port <n>, spawned as a real subprocess, becomes reachable on the exact port
passed on the command line (proves the argv.slice(3) re-parse works, not the 4173 default)
```

in `packages/quay/test/cli.test.mjs`. Root cause: this test spawns a real `node bin/quay.ts serve
--port <n>` subprocess and polls `http://127.0.0.1:<port>/` for up to **5s** (50 × 100ms) waiting
for a 200 response. `scripts/test.sh` (DIR-109) defaults to `--test-concurrency=8` — 8 test files
running concurrently — and this exact file was already independently profiled (DIR-112's own
Finding text, task filed but never implemented) as suffering real CPU/disk contention under that
concurrency (236s inside the full run vs 109s in isolation). A real subprocess cold-start (module
resolution + Node's native TS strip-types + provider MCP handshake) can legitimately exceed 5s
under that contention — the server DOES come up, just not fast enough for the old fixed window.
The test had no diagnostic capture (stderr was piped but never read/logged) — so the actual CI
failure log gave zero clue whether this was a crash or a timeout; had to be inferred from the file's
own known contention profile.

**Note (correction):** an earlier draft of this finding (and of `tasks/DIR-109.md`'s own Resolution)
attributed this to "DIR-112's concurrency refactor of cli.test.mjs". That was wrong — `git show
--stat 301dfb9` shows that commit only added `tasks/DIR-112.md` (task-filing, 82 lines, one file);
DIR-112's proposed refactor was never actually implemented. `cli.test.mjs`'s last real code change
was the unrelated M116 TS-migration commit (`3667b02`). Corrected in both places.

## Requested action / Fix (landed same-session)

1. Widened the poll budget from 5s (50 × 100ms) to 30s (300 × 100ms) — this is a "does it
   eventually become reachable" check, not a startup-speed benchmark, so a wider budget doesn't
   weaken what the test proves.
2. Captured `stderr` (previously discarded) and, on failure, included a snippet of captured
   stdout/stderr + the child's exit code in the assertion message, so a future real failure is
   diagnosable from the CI log alone instead of requiring inference.

## Verification (real, not asserted — see Definition of Done for pending audit confirmation)

- Isolated run, twice: `node --test packages/quay/test/cli.test.mjs` — both runs green
  (`tests 1 / pass 1 / fail 0`), `serve --port` assertion explicitly `PASS` both times
  (grepped directly from output).
- Full-suite run under the exact contended condition that produced the original CI failure:
  `bash scripts/test.sh` (`--test-concurrency=8`, 80 files) — `tests 517 / pass 514 / fail 0 /
  skipped 3`, `duration_ms 314387` — matches DIR-109's own originally-claimed baseline shape
  exactly, no failures.
- Real CI, post-fix: pushed commit `0a55c35`; run
  [30205100534](https://github.com/yaleh/quay/actions/runs/30205100534) — `status: completed,
  conclusion: success`, all 3 jobs green (`test`, `version-consistency`, `dist-verify-node-floor`)
  — independently confirmed via `gh run view --json status,conclusion,jobs`, not just the watch
  command's own exit code. This is the same `test` job that failed pre-fix on run 30204233175
  against a near-identical tree (commit `5cd8872`, which also failed the same way, confirming the
  bug was reliably reproducible in CI, not a one-off fluke).

## Definition of Done

Per DIR-020, boxes below are left UNCHECKED — implementer-provided evidence above is real and
independently checkable (CI run links, exact commands/output), but ticking is an audit-phase action,
not self-certification, especially since this task carries `milestone-candidate` and may enter the
normal SELECT/audit pipeline later.

- [ ] Fix committed to `master` (evidence: commit `0a55c35`).
- [ ] Verified locally under real `--test-concurrency=8` contention, not just isolated (evidence:
  `bash scripts/test.sh` full-suite run, 517/514/0-fail/3-skipped).
- [ ] A subsequent real CI run confirms the `test` job green (evidence: run 30205100534,
  independently checked via `gh run view`).
