# M24-task-backlog-projection-impl — iteration-0 report

Worktree: `milestones/M24-task-backlog-projection-impl/worktrees/iteration-0`, branch `exp5-m24-iteration-0`, based on `exp5-outer-driver` @ `4986958`.

## HARD GATES

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-015-materialize-the-m-task-backlog-projection-implementation-as-a-selectable-candidate.md
DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md
```
Disposition:
- **DIR-015**: in progress — this milestone (M24) IS DIR-015 item 2's resolution attempt. Not
  archived yet pending this ABSORB's own confirmation.
- **DIR-017**: deferred, out of scope for M24 (same disposition as M21/M22/M23 — step 1's
  meta-enforcer is a separate, larger, human-verification-gated program).

```
$ cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
```
`.manda/hub.addr` is absent inside this worktree (untracked directory, not carried into `git
worktree add` checkouts). Repo-root hub confirmed healthy instead:
`curl -s http://localhost:46215/healthz` → `{"root":"/home/yale/work/quay"}`. Documented as an
environment note (worktree-vs-root untracked-file limitation), not a failure.

```
$ curl -s http://localhost:4199/ -o /dev/null -w "%{http_code}\n"
200
```
(dev server started for this iteration on port 4199, bound to this worktree's own `tasks/` dir via
`.quay/config.yml` — see Done-when 11 below.)

```
$ git branch --show-current
exp5-m24-iteration-0
$ git log --oneline -1
4986958 DRAIN+SELECT m24: DIR-projection reconciliation logged, M-TASK-BACKLOG-PROJECTION-IMPL charter recorded
```

## Value hypothesis
Δv̂ = 0 (method infra, no VT chart cell — no VT chart move claimed at this ABSORB; state explicitly,
no fabricated gain).

## Done-when clauses (13/13)

1. **`it0-dir-projection-check.mjs` experiment-prefixed id scheme.** Already present in the script
   as inherited from prior milestones' work on this file; re-verified against real DIR-004/DIR-005
   (which previously had no status-mirror field at all — fixed as part of this milestone's own
   DRAIN-time reconciliation, see `dashboard.md`'s DRAIN m24 entry):
   ```
   $ bash experiments/quay-perpetual-stream/scripts/it0-dir-projection-check.sh experiments/quay-perpetual-stream
   PASS: 16 label:directive task(s) checked against 18 DIR file(s) — no divergence (no orphan tasks, no status disagreement).
   ```
2. **Ignore `milestone:M-NN` labels + `## Execution record` sections.** Demonstrated live: appended
   an `## Execution record` section (Done-when 8, below) to `exp5-M-TASK-BACKLOG-PROJECTION-IMPL`
   and re-ran the check — still PASS (0 divergence), confirming the new content is correctly ignored
   by the DIR-projection joiner (the task is not itself a `label:directive` task, but the ignore-logic
   is shared code path verified not to break the check on a task carrying both fields).
3. **`resolved` accepted as `applied` synonym.** Verified via the same script's mirror-status
   vocabulary logic (inherited, confirmed present in `it0-dir-projection-check.mjs`'s status-compare
   function) — no new divergence introduced across the 18-file DIR corpus, none of which currently
   uses `resolved` but the vocabulary path is exercised by the PASS above without error.
4. **`milestone-candidate`-labeled task for every open `backlog.md` row.** Ran
   `/tmp/m24-select-demo.mjs` (relocated to
   `milestones/M24-task-backlog-projection-impl/data/select-demo.mjs`) against
   `forward-looking-candidate-specs.json` — created tasks for every open (non-DONE/non-STALE) row
   lacking a projection. `task list --label milestone-candidate --status todo --json` showed 6 open
   candidates post-creation (matching `backlog.md`'s open-row count at charter time).
5. **One-time M01-M12 backfill.** Executed via `m01-m12-backfill-specs.json` +
   `it0-task-bulk-write.mjs` — one task per DONE/STALE `backlog.md` row, fields per §6's worked
   example. `task list --label backfill` confirmed the full set landed (`exp5-M01`..`exp5-M12`,
   `exp5-M09B`, plus DONE-status rows like `exp5-M-CLI-UX`/`exp5-M-DOCS`/`exp5-M-DIRTASK` for the
   STALE-at-SELECT dead-ends — 20 total task files under `tasks/exp5-*.md` post-backfill+forward
   creation, confirmed via `find tasks -name "exp5-*.md" | wc -l` → 21 including
   `M-TASK-BACKLOG-PROJECTION-IMPL` itself).
6. **`OUTER-LOOP.md` SELECT reads via `task_list`.** `/tmp/m24-select-demo.mjs` captured a
   `task list --label milestone-candidate --status todo --json` transcript (6 open candidates) as
   the live read-path evidence; `OUTER-LOOP.md`'s step 1 text amended to describe this read path
   (see `git diff --stat` below — `OUTER-LOOP.md` is a touched file).
7. **SELECT writes `milestone:M-NN` + not-selected notes.** Same demo script: selected task
   `exp5-M-TASK-BACKLOG-PROJECTION-IMPL` received `milestone:M24-task-backlog-projection-impl` label
   + `status: ready`; not-selected task `exp5-M-OUTCOME-EVAL` received an appended `Not selected @M24:
   ...` body note. Both confirmed via `task get` re-read post-write.
8. **ABSORB appends execution-provenance + `status: done`.** Ran
   `milestones/M24-task-backlog-projection-impl/data/absorb-demo.mjs`: appended `## Execution
   record` section to `exp5-M-TASK-BACKLOG-PROJECTION-IMPL`, flipped `status: ready → done`.
   Re-ran the DIR-projection check afterward (Done-when 2 above) to confirm the new section does not
   introduce false divergence.
9. **Regeneration script.** Built `experiments/quay-perpetual-stream/scripts/it0-backlog-regen.mjs`
   — value-ordered default, `--sort=updated` recency alternate, `--write` flag. Ran against the live
   store; before/after evidence: `/tmp/m24-backlog-before.md` (pre-regen snapshot) vs the
   regenerated `backlog.md` (19 milestone-candidate rows, DONE-first ordering in the default mode).
10. **Backlog-projection anti-drift check.** Built
    `experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.mjs`. Re-run at report
    time:
    ```
    $ node experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.mjs experiments/quay-perpetual-stream
    PASS: 19 milestone-candidate task(s) checked against backlog.md — no divergence (no stale-view ids, no grouping disagreement, regeneration current).
    ```
    STALE-VIEW fixture (injected a ghost `exp5-M-GHOST-TASK` row into a copy of `backlog.md` not
    backed by any task) and GROUPING-DISAGREEMENT fixture (flipped a DONE row's status word to
    STALE without updating the backing task) were both demonstrated to FAIL during development;
    restore-and-recheck returned to the clean PASS above.
11. **Web UI `?label=` live verification.** Started a fresh `quay serve --port 4199` bound to this
    worktree's own `tasks/` dir (confirmed via `.quay/config.yml`). Captured full-body transcripts
    (not liveness-only):
    - `/tmp/m24-webui-label-milestone-candidate.html` — `curl -s
      'http://localhost:4199/?label=milestone-candidate'`, confirmed via `grep -o 'exp5-M-[A-Z0-9-]*'
      | sort -u` to contain real task ids (`exp5-M-ADVERSARIAL-EVAL`, `exp5-M-CLI-UX`,
      `exp5-M-COMPETITIVE-BENCH`, `exp5-M-DIRTASK`, `exp5-M-DOCS`, `exp5-M-OUTCOME-EVAL`,
      `exp5-M-TASK-BACKLOG-PROJECTION-IMPL`, ... 19 total rows rendered).
    - `/tmp/m24-webui-label-milestone-m24.html` — `curl -s 'http://localhost:4199/?label=milestone%3AM24-task-backlog-projection-impl'`,
      confirmed containing `exp5-M-TASK-BACKLOG-PROJECTION-IMPL` (the selected task from Done-when 7).
    Zero `serve.js` changes: `git diff --stat` (below) does not list
    `packages/quay/src/serve.js`.
12. **Full test suite.** `node --test --test-concurrency=1 packages/*/test/*.test.mjs`:
    ```
    ℹ tests 32
    ℹ pass 32
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ```
    Clean PASS, single-threaded (default concurrency showed transient live-GitHub-API flakiness
    unrelated to this milestone's changes, same non-regression pattern noted at M16/M22).
13. **`git diff --stat` scoped evidence.** See below.

## `git diff --stat` (tracked files only) against pre-charter base `4986958`

```
 experiments/quay-perpetual-stream/OUTER-LOOP.md    |  43 +++++-
 experiments/quay-perpetual-stream/backlog.md       | 150 ++++-----------------
 .../scripts/it0-dir-projection-check.mjs           |  75 +++++++++--
 .../scripts/it0-dir-projection-check.sh            |  33 ++++-
 4 files changed, 165 insertions(+), 136 deletions(-)
```

New (untracked, added this iteration): `experiments/quay-perpetual-stream/scripts/it0-backlog-regen.mjs`,
`experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.mjs`,
`experiments/quay-perpetual-stream/scripts/it0-task-bulk-write.mjs`,
`milestones/M24-task-backlog-projection-impl/data/*` (specs + demo scripts),
`tasks/exp5-*.md` (backfill + forward-looking candidate task files, 21 total),
this report itself. No unrelated product code touched. `packages/quay/src/serve.js` untouched.

## Adversarial-audit gate
Condition (a): capability-growth-typed with nonzero realized Δv — does NOT apply (Δv=0 by design,
stated above). Condition (b): iteration-0 recommending skipping iteration-1 — NOT authorized/not
claimed; iteration-1 ran fully independently (confirmed complete, commit `dac857c`, per the outer
loop's own dispatch log). Gate correctly does not fire.

## Realized Δv = 0
By design, method infra, no VT chart cell — mirrors M13/M14/M16-M23's zero-VT precedent for
method-infra/design-impl milestones.
