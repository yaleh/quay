---
id: gap-cli-serve-port-test-flaky-ci-timeout
title: cli.test.mjs's "quay serve --port" reachability test fails under real CI
  resource contention — fixed 5s poll budget too tight under
  --test-concurrency=8
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
  acceptance: node --test --test-name-pattern='becomes reachable'
    packages/quay/test/cli.test.mjs
---
## Resolution, closed (2026-07-29)

Lifecycle status reconciled from `ready` to `done`. The implementation, independent local
verification, adversarial audit, and real post-fix CI evidence were already complete: commit
`0a55c35`, contended canonical-suite result `517/514/0-fail/3-skipped`, and successful GitHub
Actions run `30205100534`. No further implementation is required under this task.

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
was the unrelated M116 TS-migration commit (`3667b02`). Corrected in `tasks/DIR-109.md` (both
occurrences — independently re-verified current on disk as of this write, not stale).

## Proposal

Widen `cli.test.mjs`'s `quay serve --port` reachability poll budget from 5s to 30s (the test proves
eventual reachability, not startup speed, so a wider window doesn't weaken the assertion) and
capture `stderr`/exit code into the failure message so a future real failure is diagnosable from the
CI log alone. Landed and verified same-session; retrofitted with a `## Proposal` heading
(2026-07-28) to satisfy the standard lifecycle gate's artifact check — no change to the substance
below, which was already real, audited, and landed.

## Plan

N/A — same-session point fix (one test file, ~2-line change), no separate milestone Plan
authored or needed.

## Requested action

Fix landed same-session.

1. Widened the poll budget from 5s (50 × 100ms) to 30s (300 × 100ms) — this is a "does it
   eventually become reachable" check, not a startup-speed benchmark, so a wider budget doesn't
   weaken what the test proves.
2. Captured `stderr` (previously discarded) and, on failure, included a snippet of captured
   stdout/stderr + the child's exit code in the assertion message, so a future real failure is
   diagnosable from the CI log alone instead of requiring inference.

## Acceptance Criteria

- [x] Poll budget widened to 30s (300 × 100ms) in `packages/quay/test/cli.test.mjs`; `stderr` and
  exit code captured into the failure-path assertion message — ticked by the fresh-context audit
  (see `## Adversarial audit` below), evidence: `git show 0a55c35 -- packages/quay/test/cli.test.mjs`.
- [x] Isolated and full-contention (`--test-concurrency=8`) local runs both green — ticked by audit,
  independently re-run to completion (see `## Verification` below).
- [x] A real post-fix CI run is green — ticked by audit via `gh run view 30205100534`.

## Verification (real, not asserted)

- Isolated run: implementer 2x + fresh-context audit 1x, all green (`tests 1 / pass 1 / fail 0`),
  `serve --port` assertion explicitly `PASS` every time.
- Full-suite run under the exact contended condition that produced the original CI failure:
  `bash scripts/test.sh` (`--test-concurrency=8`, 80 files) — implementer's own run:
  `517/514/0-fail/3-skipped, duration_ms 314387`; **independently re-run to completion by the
  fresh-context audit**: `517/514/0-fail/3-skipped, duration_ms 315777, EXIT:0` — same shape,
  different (expected) duration across independent contended runs.
- Real CI, post-fix: pushed commit `0a55c35`; run
  [30205100534](https://github.com/yaleh/quay/actions/runs/30205100534) — `status: completed,
  conclusion: success`, all 3 jobs green — independently confirmed by the fresh-context audit via
  `gh run view --json status,conclusion,headSha,jobs` (headSha matched `0a55c35` exactly).
- **Pre-fix failures — two independent CI runs, not one** (corrected citation; the original text
  here conflated a run id with the wrong commit). Run **30204233175**'s `headSha` is `1bc1167`
  (NOT `5cd8872` as an earlier draft said). Commit `5cd8872` has its own separate CI run,
  **30204625342** — found by the fresh-context audit via `gh run list`, not previously cited
  anywhere in this task — which *also* failed with the identical `FAIL: quay serve --port <n>...`
  signature. So the bug is confirmed reproducible across two independent pre-fix CI runs
  (30204233175 on `1bc1167`, 30204625342 on `5cd8872`) — stronger evidence than first claimed, the
  earlier version just mis-cited which run belonged to which commit.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-020, all
three boxes below were ticked by the fresh-context audit (not self-certified by the implementer)
after independently reproducing each piece of evidence, including running the full contended suite
itself to completion.

- [x] Fix committed to `master` (evidence: commit `0a55c35`) — ticked by audit.
- [x] Verified locally under real `--test-concurrency=8` contention, not just isolated (evidence:
  audit's own independent `bash scripts/test.sh` run, `517/514/0-fail/3-skipped, duration_ms
  315777, EXIT:0`) — ticked by audit.
- [x] A subsequent real CI run confirms the `test` job green (evidence: run 30205100534,
  independently checked via `gh run view`) — ticked by audit.

## Adversarial audit (fresh-context)

**Auditor stance:** fresh context, refute-first. Re-derived every claim from independently-run
commands (git, `node --test`, `bash scripts/test.sh` run to completion, `gh run view`), not from
the task's own prose.

**Verdict: CONFIRMED.** All three DoD items independently reproduced. Two documentation-accuracy
issues were found along the way (neither changes the substance — the underlying fix and its
evidence hold): a mis-cited commit/run-id pairing in this task's own Verification section (now
corrected above, with the previously-uncited second failing run 30204625342 added), and a
transient inconsistency in `tasks/DIR-109.md` (two coexisting, contradictory sentences about the
DIR-112 attribution) that existed at one point during this session's back-and-forth edits and has
since been fixed — re-verified current on disk as of this write.

1. **Code change real and matches claim — CONFIRMED.** `git show 0a55c35 -- packages/quay/test/cli.test.mjs`
   diff: loop bound `50` → `300` (5s→30s), `stderr` listener added and attached before the poll
   loop starts, failure-path assert message now interpolates `stdout`/`stderr`/`exitCode`. Read the
   current file at lines 505-538: coherent, no off-by-one, `up` still requires a genuine HTTP 200
   (`res.statusCode === 200`) — the assertion cannot be gamed into an always-pass.
2. **Isolated re-run — CONFIRMED.** `node --test packages/quay/test/cli.test.mjs`: `PASS: quay
   serve --port <n>, spawned as a real subprocess, becomes reachable...` and `PASS: quay serve
   (spawned as a subprocess) renders the seeded task...`; `tests 1 / pass 1 / fail 0 / skipped 0`.
3. **Contended re-run — CONFIRMED.** Independently ran `bash scripts/test.sh` to completion
   (`--test-concurrency=8`, real contention): `tests 517 / suites 4 / pass 514 / fail 0 /
   cancelled 0 / skipped 3 / todo 0 / duration_ms 315777`, `EXIT:0`. Matches the implementer's
   claimed shape exactly (517/514/0-fail/3-skipped); duration differs slightly as expected across
   independent contended runs.
4. **Real CI evidence — CONFIRMED, citation now corrected.** `gh run view 30205100534 --json
   status,conclusion,headSha,jobs`: `conclusion: success`, `headSha: 0a55c35...`, all 3 jobs
   `success`. `gh run view 30204233175`: `conclusion: failure`, `headSha: 1bc1167...`, `test` job
   `failure`; failed-step log greps the exact claimed `FAIL:` line and `517/pass 513/fail 1`.
   Commit `5cd8872`'s own separate run `30204625342` also failed the same way — see Verification
   section above, now corrected to cite both runs accurately.
5. **Attribution correction — CONFIRMED, and `tasks/DIR-109.md` is current/consistent as of this
   write.** `git show --stat 301dfb9`: touches only `tasks/DIR-112.md` (82 insertions, 1 file).
   `git log --oneline -- packages/quay/test/cli.test.mjs`: last real code change before `0a55c35`
   was `3667b02` ("feat(M116): TS migration P5-A"), unrelated to DIR-112. An earlier audit pass in
   this same session flagged a transient state where `tasks/DIR-109.md` briefly carried both the
   corrected and a stale copy of the DIR-112 attribution simultaneously — that has since been fixed
   directly in `tasks/DIR-109.md` (re-read from disk as part of reconciling this write-back with a
   concurrent edit) and is no longer present.
6. **Regression check — CONFIRMED, no masking.** The wider loop only changes how long the test
   waits, not what it checks; both the isolated and full contended runs confirm no collateral
   breakage anywhere else in the suite.
7. **DoD hygiene — done.** All three boxes ticked by this audit after independent reproduction of
   each. Body otherwise preserved; this write-back also reconciles a concurrent edit made to this
   same task between this audit's two report turns (see Verification section) — merged, not
   overwritten.

**Process note (not a substance finding):** this task's body was independently edited twice in
close succession — once by the implementing session (correcting a citation) and once by this
audit's own write-back (from a stale read, since the audit's own long-running background test
command spanned both edits) — producing a lost-update race on a single task record. Both sets of
changes are reconciled in this final version. Worth a structural note for a future directive: task
writes that follow a long-running verification step should re-read the task immediately before
writing back, not rely on state captured before the wait.
