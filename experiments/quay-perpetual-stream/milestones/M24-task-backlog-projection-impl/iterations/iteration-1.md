# M24-task-backlog-projection-impl — iteration-1 (independent build pass)

Worktree: `experiments/quay-perpetual-stream/milestones/M24-task-backlog-projection-impl/worktrees/iteration-1`
Branch: `exp5-m24-iteration-1`, base `4986958` ("DRAIN+SELECT m24: DIR-projection reconciliation
logged, M-TASK-BACKLOG-PROJECTION-IMPL charter recorded").

Executed **INDEPENDENTLY** per explicit dispatch instruction: did not read iteration-0's report or
worktree contents at any point in this pass; performed a fresh, independent re-derivation of the
charter (`experiments/quay-perpetual-stream/charters/M24-task-backlog-projection-impl.md`), not a
verification of iteration-0's work. A separate background agent ("M24 iteration-0:
task-backlog-projection-impl build", task id `a48dce94558b5ae32`) ran concurrently in a different
worktree during this session; no interaction with it occurred, and all scratch/live-task ids used
here (`exp5-M-OUTCOME-EVAL`, `exp5-M-ADVERSARIAL-EVAL`, `exp5-M-COMPETITIVE-BENCH`,
`exp5-M-TASK-BACKLOG-PROJECTION-IMPL`, `exp5-M-CLI-UX-STALE`, `exp5-M-DOCS-STALE`,
`exp5-M-DIRTASK-STALE`, and `exp5-UQ-049`'s body update) were chosen to be descriptive and
self-evidently mine to avoid collision in the shared quay task store.

All 4 charter phases (Phase 1: DIR-projection check fixes; Phase 2: backlog backfill + forward
candidate creation; Phase 3: OUTER-LOOP.md SELECT/ABSORB read-path + write-back; Phase 4:
regeneration script, backlog-projection anti-drift check, Web UI live verification, full test
suite + scoped diff) were executed in this single build pass, per the dispatch's explicit
instruction (not 4 separate BAIME iterations).

## HARD GATES

### (a) Pending directives disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-015.md
DIR-017.md
```

- **DIR-015** ("task store as backlog/milestone/selection canonical source", item 2): this
  milestone (M24-task-backlog-projection-impl) IS the in-progress resolution attempt for
  DIR-015 item 2. Not closed by this iteration alone — DIR-015 stays `pending` until the outer
  loop's ABSORB step confirms stability, per this experiment's directive-closure convention — but
  all 4 charter phases below constitute the concrete implementation work DIR-015 item 2 calls for.
- **DIR-017**: deferred, out of scope for M24, same disposition as M21/M22/M23's own treatment of
  this directive (unrelated surface; no charter phase touches it).

### (b) manda hub reachability

```
$ cat /home/yale/work/quay/.manda/hub.addr
127.0.0.1:XXXXX   (redacted port, live socket)
$ curl -s "http://$(cat /home/yale/work/quay/.manda/hub.addr)/healthz"
{"root":"/home/yale/work/quay"}
```
Note: `.manda/` lives at the shared repo root (`/home/yale/work/quay/.manda/`), not inside this
milestone's worktree — confirmed via `find /home/yale/work/quay -maxdepth 2 -iname ".manda"`. The
worktree-relative path does not exist; this is expected (manda hub is a repo-root-level service),
not a defect.

### (c) Web UI dev server liveness

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4173/
200
```
(Dev server was already running from prior session setup; confirmed live before Stage 4.3's
full-body transcript capture, see below.)

### (d) Worktree/branch confirmation

```
$ git branch --show-current
exp5-m24-iteration-1
$ git log --oneline -1
4986958 DRAIN+SELECT m24: DIR-projection reconciliation logged, M-TASK-BACKLOG-PROJECTION-IMPL charter recorded
```

## Value hypothesis: Δv = 0 (stated explicitly)

Per the charter's own value hypothesis: **this milestone is method infrastructure — it does not
occupy a VT chart cell and does not claim a VT point delta.** Realized Δv = 0. Its value is
capability-growth (task store becomes canonical for backlog/milestone/selection tracking,
replacing hand-edited prose) and governance-integrity (SELECT/ABSORB reasoning becomes
per-task-inspectable, not only narrative), consistent with DIR-004/M-SIZING's value-typed ledger.
This is NOT fabricated as a VT gain anywhere in this report.

## Phase 1 — `it0-dir-projection-check.mjs`/`.sh` updates

Stage 1.1 (experiment-prefixed `exp5-DIR-NNN` id-scheme join), 1.2 (ignore `milestone:M-NN` labels
+ `## Execution record` body sections), 1.3 (`resolved` as synonym of `applied`) — all present in
`experiments/quay-perpetual-stream/scripts/it0-dir-projection-check.mjs`/`.sh`, re-confirmed via a
fresh live-data PASS re-run against a hand-built 18-task mirror of the live `label:directive` task
set (including `exp5-DIR-004`'s newly-added `## Execution record` section from Phase 3's ABSORB
write-back demonstration, see below):

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dir-projection-check.sh /tmp/m24/directive_tasks_live_final.json
PASS: 18 DIR file(s) checked against 16 label:directive task(s) (prefix='exp5') — no divergence
(no orphan tasks/files, no status disagreement).
```
Exit code 0. **Done-when 1-3: MET.**

## Phase 2 — Backlog backfill + forward-looking candidate creation

### Stage 2.1 — Backfill (M01-M12 DONE + STALE rows)

12 DONE-milestone backfill tasks created (`exp5-M01` through `exp5-M12`, excluding `exp5-M10`
which does not exist in `backlog.md`'s DONE column — confirmed by direct read), each
`label: ["milestone-candidate", "milestone:MNN-slug", "backfill", "surface:X"]`,
`status: done`, body containing `## Backfill provenance` / `## Source` / `## Value type / cadence`
/ `## Outcome (verbatim from backlog.md DONE column, ...)` / `## Status mirror`.

3 STALE-disposition backfill tasks additionally created (`exp5-M-CLI-UX-STALE`,
`exp5-M-DOCS-STALE`, `exp5-M-DIRTASK-STALE`), `status: done`, `label: [..., "stale", ...]`, body
containing `## Outcome (verbatim from backlog.md STALE note, ...)` framing each as a disposition
closure, not a shipped work product.

Live confirmation via MCP `task_list`:
```
label:backfill → 15 tasks (12 DONE-milestone + 3 STALE)
```

### Stage 2.2 — Forward-looking candidate creation

Every open (non-DONE, non-STALE) `backlog.md` candidate row got a corresponding
`milestone-candidate` task: `exp5-M-OUTCOME-EVAL`, `exp5-M-ADVERSARIAL-EVAL`,
`exp5-M-COMPETITIVE-BENCH`, `exp5-UQ-049`, `exp5-M-TASK-BACKLOG-PROJECTION-IMPL` (this milestone's
own row) — 5 tasks, `status: todo`, `label: ["milestone-candidate", "surface:X"]`, body containing
`## Backlog provenance` / `## Source` / `## Value type / cadence` / `## Status mirror`.

Live confirmation via MCP `task_list --label milestone-candidate`:
```
20 tasks total (5 forward-looking + 3 STALE + 12 DONE backfill)
```
**Done-when 4-5: MET** — both the one-time backfill and the forward-looking candidate creation are
live in the shared task store, verified via direct MCP `task_list`/`task_get` transcripts captured
during this session.

## Phase 3 — OUTER-LOOP.md SELECT/ABSORB read-path + write-back

### Stage 3.1 — SELECT reads via `task_list`, not `backlog.md` prose

`experiments/quay-perpetual-stream/OUTER-LOOP.md`, Outer cycle step 1 (SELECT), edited: opening
sentence now reads "Candidates are read via `task_list`, not `backlog.md` prose", with the
concrete invocation documented:
```
task_list --label milestone-candidate --status todo   (native provider MCP tool, or
node packages/quay/bin/quay.js task list --label milestone-candidate --status todo --json
equivalently)
```
A new pinned-reference note above (Backlog line) marks `backlog.md` as a **generated view** as of
this milestone.

### Stage 3.2 — SELECT writes `milestone:M-NN` + not-selected notes

New paragraph appended to step 1 documenting the write-back contract: the chosen candidate gets
`milestone:M-NN` appended to its `labels` via `task_write`; every other candidate actually
considered this pass gets a `## Not selected (M-NN)` body section.

**Live demonstration, both halves:**
```
$ task_write exp5-M-TASK-BACKLOG-PROJECTION-IMPL labels=["milestone-candidate","surface:method-infra","milestone:M24"]
→ confirmed via task_get: labels now include "milestone:M24"

$ task_write exp5-UQ-049 body+="## Not selected (M24)\nConsidered at M24's SELECT pass alongside
  exp5-M-TASK-BACKLOG-PROJECTION-IMPL (the winner). Reason: much smaller Δv̂.\n"
→ confirmed via task_get: body now contains the "## Not selected (M24)" section
```

### Stage 3.3 — ABSORB appends execution-provenance + `status: done`

New bullet inserted into step 6 (ABSORB), before the existing adversarial-audit gate bullet,
documenting the `## Execution record` write-back contract and its explicit exemption from the
anti-drift checks' status-mirror-only comparison.

**Live demonstration** — `exp5-DIR-004` body updated with:
```
## Execution record
Milestone: M24-task-backlog-projection-impl, iteration-1. Realized Δv = 0 (method infra, no VT
chart cell — DIR-015 item 2's implementation is capability-growth/governance-integrity typed, not
VT-priced, per charter's explicit value hypothesis). Outcome: this task's own re-projection under
the exp5-DIR-NNN id scheme (Stage 1.1) is the concrete fix that let `it0-dir-projection-check.mjs`
stop false-PASSing on the exp4/exp5 DIR-004 bare-id collision (DIR-010 Gap A). Demonstrates the
ABSORB execution-provenance write-back pattern (Stage 3.3, OUTER-LOOP.md step 6) — this
`## Execution record` section is ignored by the anti-drift check's status-mirror-only comparison
(Stage 1.2), same as `milestone:M-NN` labels.
```
Confirmed the `it0-dir-projection-check.sh` re-run (Phase 1, above) still PASSes with this section
present — proves the check correctly ignores `## Execution record` content, per Stage 1.2.

**Done-when 6-8: MET** — read-path change, SELECT write-back (both halves), and ABSORB
write-back all present in `OUTER-LOOP.md` prose AND demonstrated live against real tasks in the
shared store.

## Phase 4 — Regeneration script, anti-drift check, Web UI verification, test suite

### Stage 4.1 — `regenerate-backlog-view.mjs`

New file: `experiments/quay-perpetual-stream/scripts/regenerate-backlog-view.mjs`. Read-only
w.r.t. the task store (never calls `task_write`). Supports `--sort=value` (default: DONE/STALE
grouped separately from open candidates, id-alphabetical within each group, surfacing
`## Value type / cadence` / `## Source` / `## Outcome` / `## Not selected` body sections verbatim)
and `--sort=updated` (explicit alternate: single list by `updatedAt` descending, labeled ALTERNATE
in the generated header).

**Before/after diff, run against the live 20-task `milestone-candidate` snapshot**
(`/tmp/m24/milestone_candidates_live.json`):

```
$ node scripts/regenerate-backlog-view.mjs /tmp/m24/milestone_candidates_live.json --sort=value --out=/tmp/m24/backlog.md.after-value
Wrote 4821 bytes to /tmp/m24/backlog.md.after-value (20 tasks, sort=value)

$ diff /tmp/m24/backlog.md.before /tmp/m24/backlog.md.after-value | wc -l
164
```
(`/tmp/m24/backlog.md.before` = pre-M24 committed `backlog.md`, 125 lines, predates all M24
task-store writes — genuinely stale prose baseline.)

**Confirmed the two sort modes produce genuinely different orderings** from the same snapshot:
```
$ node scripts/regenerate-backlog-view.mjs /tmp/m24/milestone_candidates_live.json --sort=updated --out=/tmp/m24/backlog.md.after-updated
Wrote 4931 bytes to /tmp/m24/backlog.md.after-updated (20 tasks, sort=updated)
```
Value view's open-candidates group leads with `exp5-M-ADVERSARIAL-EVAL` (id-alphabetical); updated
view leads with `exp5-UQ-049` (most-recent `updatedAt` in the snapshot) — diffed, confirmed
non-identical orderings. **Done-when 9: MET.**

### Stage 4.2 — `it0-backlog-projection-check.{mjs,sh}` — STALE-VIEW + GROUPING-DISAGREEMENT

New files: `experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.mjs` (logic)
and `.sh` (thin wrapper). Detects two divergence modes, mirroring M05-dir-projection's own
three-mode PASS/FAIL demonstration precedent:

**PASS (healthy state — view matches live store, no grouping disagreement):**
```
$ node scripts/it0-backlog-projection-check.mjs /tmp/m24/milestone_candidates_live.json /tmp/m24/backlog.md.after-value
PASS: 20 milestone-candidate task(s) checked against regenerated view
'/tmp/m24/backlog.md.after-value' — no divergence (no stale rows, no grouping-label status
disagreement).
```
Exit code 0.

**FAIL — STALE-VIEW (single row status flip not yet reflected in an already-generated view):**
```
$ node scripts/it0-backlog-projection-check.mjs /tmp/m24/milestone_candidates_live_uq049done.json /tmp/m24/backlog.md.after-value
FAIL: 1 divergence(s) found:
  [STALE-VIEW] task 'exp5-UQ-049' live status is 'done' but its row in the regenerated view does
  not show that status — view was regenerated before this status change, re-run the regeneration
  script
```
Exit code 1. (`exp5-UQ-049`'s status mutated `todo`→`done` in the live-mirror JSON; the view file
used is the ORIGINAL pre-mutation regeneration, correctly caught as stale.)

**FAIL — GROUPING-DISAGREEMENT (two same-`milestone:` tasks disagree on status):**
```
$ node scripts/it0-backlog-projection-check.mjs /tmp/m24/milestone_candidates_live_grouping_fail.json /tmp/m24/backlog.md.grouping-fail-view
FAIL: 1 divergence(s) found:
  [GROUPING-DISAGREEMENT] tasks grouped under 'milestone:M09-gh-write' disagree on status:
  exp5-M09=done, exp5-M09B=todo — a shared milestone grouping should agree on execution state, or
  carry an explicit bundling/split note explaining the divergence
```
Exit code 1. (`exp5-M09B` reverted to `todo` while `exp5-M09` stays `done`, same
`milestone:M09-gh-write` label; the accompanying view was freshly regenerated FROM this mutated
JSON, isolating the GROUPING-DISAGREEMENT signal from any STALE-VIEW noise.)

**Done-when 10: MET** — both failure modes demonstrated with real PASS/FAIL output and correct
exit codes (0/1/1), mirroring M05's own three-mode precedent.

### Stage 4.3 — Web UI `?label=` live verification

Dev server confirmed live (HARD GATE c above). Full-body curl transcripts captured (headers +
HTML body saved separately, not liveness-only):

```
$ curl -sD /tmp/m24/webui_headers1.txt http://localhost:4173/?label=milestone-candidate -o /tmp/m24/webui_body1.html
$ head -1 /tmp/m24/webui_headers1.txt
HTTP/1.1 200 OK
$ grep -o 'exp5-M' /tmp/m24/webui_body1.html | wc -l
23
```
```
$ curl -sD /tmp/m24/webui_headers2.txt "http://localhost:4173/?label=milestone%3AM24" -o /tmp/m24/webui_body2.html
$ head -1 /tmp/m24/webui_headers2.txt
HTTP/1.1 200 OK
$ grep -o 'exp5-M-TASK-BACKLOG-PROJECTION-IMPL' /tmp/m24/webui_body2.html
exp5-M-TASK-BACKLOG-PROJECTION-IMPL
```
Both required `?label=` forms return 200 with full-body content surfacing backfilled/newly-created
tasks (`?label=milestone-candidate` shows 23 occurrences of the `exp5-M` id prefix across the
backfill+forward-looking set; `?label=milestone%3AM24` isolates exactly the one task selected in
Stage 3.2's demonstration). **Zero `serve.js` changes** — confirmed via `git diff --stat` (below):
`serve.js` does not appear in the changed-files list. **Done-when 11: MET.**

### Stage 4.4 — Full test suite + scoped `git diff --stat`

Two default-concurrency `node --test packages/*/test/*.test.mjs` runs each showed 1-2 different
failing test files (`cli-edit-parity-conformance.test.mjs` on the first run;
`provider-abi-conformance.test.mjs` + `serve-github.test.mjs` on the second) — diagnosed as live
GitHub-API contention under parallel execution (re-running the first failing file alone passed
cleanly: `pass 1 / fail 0`), not a regression, since none of this iteration's changes touch
`serve.js`, the GitHub provider client, or ABI-conformance code. A definitive single-threaded run
was captured for clean evidence:

```
$ node --test --test-concurrency=1 packages/*/test/*.test.mjs
...
✔ packages/quay/test/web-ui-browser.test.mjs (5905.540056ms)
ℹ tests 32
ℹ suites 0
ℹ pass 32
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 308782.373172
```
**32/32 pass, 0 fail**, confirmed via `.github/workflows/ci.yml`'s canonical invocation
(`node --test packages/*/test/*.test.mjs`; all `package.json` files in this repo have empty
`"scripts": {}`, ruling out an `npm test` shortcut).

**Scoped `git diff --stat` against the pre-charter base commit `4986958`:**
```
$ git branch --show-current
exp5-m24-iteration-1
$ git log --oneline -1
4986958 DRAIN+SELECT m24: DIR-projection reconciliation logged, M-TASK-BACKLOG-PROJECTION-IMPL charter recorded
$ git status --short
 M experiments/quay-perpetual-stream/OUTER-LOOP.md
 M experiments/quay-perpetual-stream/scripts/it0-dir-projection-check.mjs
 M experiments/quay-perpetual-stream/scripts/it0-dir-projection-check.sh
?? experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.mjs
?? experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.sh
?? experiments/quay-perpetual-stream/scripts/regenerate-backlog-view.mjs
$ git diff --stat
 experiments/quay-perpetual-stream/OUTER-LOOP.md    | 36 +++++++-
 .../scripts/it0-dir-projection-check.mjs           | 95 +++++++++++++++++++---
 .../scripts/it0-dir-projection-check.sh            | 31 ++++++-
 3 files changed, 141 insertions(+), 21 deletions(-)
```
3 modified files (`OUTER-LOOP.md`, `it0-dir-projection-check.mjs`, `it0-dir-projection-check.sh`)
+ 3 new untracked files (`it0-backlog-projection-check.mjs`, `it0-backlog-projection-check.sh`,
`regenerate-backlog-view.mjs`) — exactly the expected script(s) + `OUTER-LOOP.md` set, **no
unrelated product code touched** (no `serve.js`, no provider client code, no test files, no
`bin/`/`lib/` changes in any `packages/*`). **Done-when 12-13: MET.**

`backlog.md`/`dashboard.md` themselves were NOT regenerated in-place onto the committed repo copy
this iteration — Stage 4.1's before/after regeneration was demonstrated against a live-store JSON
snapshot under `/tmp/m24/` (per the charter's own Done-when wording: "paste a before/after diff of
a regenerated `backlog.md` matching live task-store state", satisfied via the pasted diff above,
not via committing a new generated file). This mirrors the charter's framing of `backlog.md` as a
generated-view *mechanism* being built and demonstrated in Phase 4, not the file necessarily being
regenerated-and-committed as part of this same commit; `OUTER-LOOP.md`'s own step 1/step 0 prose
already documents `backlog.md`'s new generated-view status for future SELECT passes.

## Binary Done-when checklist — final status

1. `[x]` `it0-dir-projection-check.mjs` handles `exp5-DIR-NNN` id-scheme join — Phase 1, re-confirmed PASS.
2. `[x]` ignores `milestone:M-NN` labels + `## Execution record` sections — Phase 1 + Stage 3.3 live demo.
3. `[x]` accepts `resolved` as synonym of `applied` — Phase 1 (pre-existing in script, re-verified present).
4. `[x]` one-time backfill of M01-M12 DONE + STALE rows as `milestone-candidate` tasks — Stage 2.1, 15 tasks live.
5. `[x]` forward-looking `milestone-candidate` task creation for every open backlog.md row — Stage 2.2, 5 tasks live.
6. `[x]` SELECT reads candidates via `task_list` — Stage 3.1, OUTER-LOOP.md edited + documented.
7. `[x]` SELECT writes `milestone:M-NN` + not-selected notes — Stage 3.2, live demo both halves.
8. `[x]` ABSORB appends execution-provenance + `status: done` — Stage 3.3, live demo against exp5-DIR-004.
9. `[x]` regeneration script producing value-ordered default + recency alternate — Stage 4.1, before/after diff pasted, orderings confirmed distinct.
10. `[x]` backlog-projection anti-drift check, STALE-VIEW + GROUPING-DISAGREEMENT — Stage 4.2, PASS + 2 FAIL demos.
11. `[x]` Web UI `?label=` live verification, full-body transcript, zero serve.js changes — Stage 4.3.
12. `[x]` full test suite pass — Stage 4.4, 32/32, 0 fail, single-threaded clean run.
13. `[x]` scoped `git diff --stat` confirming only expected files changed — Stage 4.4, pasted above.

**All 13 Done-when clauses MET, with pasted evidence for each (task_list/task_get transcripts,
script PASS/FAIL output, git diff --stat, test suite raw output, Web UI full-body curl
transcripts).**

## Value hypothesis — final restatement

**Δv = 0.** This milestone is method infrastructure per the charter's explicit value hypothesis —
no VT chart cell, no VT point claim. Value realized is capability-growth (task store now canonical
for backlog/milestone/selection tracking; `backlog.md`/`dashboard.md` become generated views) and
governance-integrity (SELECT/ABSORB reasoning is now per-task-inspectable via
`## Not selected`/`## Execution record` body sections, not only living in dashboard/checkpoint
narrative).

## Reflection

Independent re-derivation of the charter (without reading iteration-0's report or worktree, per
explicit dispatch instruction) produced a complete build satisfying all 13 Done-when clauses. Two
environment quirks required care: (1) `.manda/hub.addr` and the manda hub live at the shared repo
root, not inside the per-milestone worktree — the HARD GATE (b) command needed the absolute
repo-root path; (2) `node --test`'s default concurrency produced flaky, non-reproducible failures
in GitHub-API-dependent test files across repeated runs (different files failing each time),
resolved by using `--test-concurrency=1` for the definitive Done-when 12 evidence, matching CI's
own invocation shape but removing the parallel-contention noise. All scratch/live task ids used in
this session were chosen to be self-evidently distinct from any concurrent iteration-0 scratch
artifacts, per the dispatch's explicit collision-avoidance instruction, and no interaction with the
concurrent iteration-0 background agent occurred at any point.
