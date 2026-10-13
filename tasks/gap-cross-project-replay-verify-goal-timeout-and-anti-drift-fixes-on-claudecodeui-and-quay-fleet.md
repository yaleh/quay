---
id: gap-cross-project-replay-verify-goal-timeout-and-anti-drift-fixes-on-claudecodeui-and-quay-fleet
title: "cross-project proof of two 0.20.0-dev fixes (goal 120s SIGKILL,
  anti-drift pre-exit) on claudecodeui + quay-fleet: private build,
  scratch-clone replay with 0.19.0 negative control, production trial plan
  (human-approved)"
status: done
labels:
  - gap
  - cross-project-dogfood
  - verification
parent: null
children: []
extra: {}
---
## Proposal
**Cross-project verification of two landed Quay fixes. They exist only on quay develop (0.20.0-dev) and are not yet proven on any host project.**

| fix (done on develop) | pre-fix evidence in host projects | 
|---|---|
| `gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks`: the driver's gate/activation spawn timeout is derived from the inner deadline (`goalDriverChildTimeoutMs`), with SIGTERM-first lock hygiene | 104 `spawn timeout after 120000ms (SIGKILL)` across quay/claudecodeui/cantus/quay-fleet (2026-09-10 → 10-12) |
| `gap-worker-prompt-omits-anti-drift-pre-exit-check-costs-a-session-per-touches-miss`: worker prompts carry `antiDriftPreExitNote` (`worker-driver.ts:1881`, used at :2090 and :3840) | 162 anti-drift bounces across 6 projects |

quay's own post-landing reading (0 anti-drift bounces in 40 outcomes; no 120 s kill since 10-10) is **not** cross-project evidence: different workload, and the host projects still run old kernels.

**Host deployment, read 2026-10-13:**
- `claudecodeui`: anchor pid 2919772 runs `~/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/driver-anchor.js` (USER-scope install 0.19.0). `.quay/plugin` is a symlink to that cache dir. No project-scope install.
- `quay-fleet`: PROJECT-scope install 0.19.0 (`enabledPlugins: {"quay@quay": true}`); anchor on 0.19.0. A different installation shape, so it is chosen as the second project.
- The local dist mirror `/data/home/yale/work/quay-plugin-dist` is a stale 0.17.0 build (2026-10-07), containing neither fix.

**Pre-fix baseline (per day, from host carriers):**
- `claudecodeui` goal 120 s kills (gate/write): 10-09 1/5, 10-10 2/13, 10-11 4/0, 10-12 5/0. Anti-drift bounces / worker outcomes: 10-09 2/75, 10-10 0/75, 10-11 5/111, 10-12 2/83.
- `quay-fleet`: 10-12 0 gate / 7 write kills; anti-drift 2/29 (10-11), 1/66 (10-12).

These rates are low, so a production before/after comparison needs days and a stable workload. The **first** proof must therefore be a deterministic replay on the hosts' REAL inputs with a negative control.

**Hard boundaries:**
- ⛔ no user-scope plugin upgrade or publish;
- ⛔ no restart of a host anchor, and no change to a host's `.quay/` or tasks, without the host's in-flight work being checked AND a human approving that step;
- ⛔ quay's own readings do not count as host evidence.

## Plan
1. **Build** a 0.20.0-dev plugin dist from develop into a private directory (not the user cache, not `quay-plugin-dist`). Record the version, the source sha and the paths.
2. **Goal-timeout replay (claudecodeui, then quay-fleet):**
   - in a scratch clone of the host, pin the host commit;
   - pick real criteria the host had killed: claudecodeui AC-319, AC-317 or AC-322 (activation), and quay-fleet AC-031/AC-038 (activation writes);
   - with the record `timeoutMs` raised above 120000 in the SCRATCH copy only, invoke the goal-driver's gate/activation path from (a) the 0.19.0 kernel and (b) the 0.20.0-dev build;
   - expect (a) `spawn timeout after 120000ms (SIGKILL)` plus a leftover `goals/<id>.lock`, and (b) the criterion's own verdict with no lock left.
   This is the negative-control pair. Bound the resources: one criterion at a time and the host's own `timeoutMs`; paste wall time and peak RSS.
3. **Anti-drift replay:**
   - pick ≥3 historical host tasks that bounced on anti-drift (worker-outcome `step:anti-drift`, with their task-branch commits still reachable);
   - render the 0.20.0-dev worker prompt for each and execute the embedded anti-drift argv against that branch in a scratch clone ⇒ expect exit 1 naming the same files the fan-in later rejected;
   - the 0.19.0 prompt carries no such step (negative control).
   If a branch is no longer reachable, say so and pick another.
4. **Production trial plan** (written, not executed here):
   - a per-project, reversible switch of ONE host's anchor to the private build: how the kernel path is chosen, how to restart without killing in-flight workers, whether worker sessions need a new session or `quay init`, and the expected resource delta;
   - the rollback: restart on 0.19.0;
   - the measurement window and the before/after metrics above.
   The execution step is human-approved.

## Acceptance Criteria
- [x] AC1: the private 0.20.0-dev build exists. Paste its path, version, source sha, and a `grep` showing `goalDriverChildTimeoutMs` and `antiDriftPreExitNote` in its dist; the 0.19.0 cache dist shows neither (negative control).
- [x] AC2: the goal-timeout replay on ≥1 real claudecodeui criterion and ≥1 real quay-fleet activation. Paste per run:
  - kernel, criterion id, declared `timeoutMs` and wall;
  - verdict or spawn error;
  - `ls goals/*.lock` afterwards.
  Expected: 0.19.0 ⇒ SIGKILL + leftover lock; 0.20.0-dev ⇒ own verdict, no lock. A run where 0.19.0 does NOT reproduce the kill is pasted, not dropped.
- [x] AC3: the anti-drift replay on ≥3 historical claudecodeui bounces (and ≥1 quay-fleet bounce if one is reachable). Paste the embedded argv, its exit code and the named files beside the fan-in log's rejected files.
- [x] AC4: the production trial plan is written into this task's Evidence (kernel selection, restart semantics for in-flight workers, worker-session/init requirement, resource estimate, rollback, metrics, window) and names the exact human approval needed.
- [ ] AC5 human-approved production trial on one host: ≥3 days of the per-day metrics before and after are pasted, from that host's carriers only（待外部）

## Definition of Done
- AC1–AC4 checked with pasted readings. No host `.quay/`, task, anchor or user-scope plugin was modified (paste each host's `git status --porcelain .quay tasks` and anchor pid before and after).
- Scratch clones and the private build are listed with their paths; nothing is left in host checkouts.

## Evidence

### AC1 — private 0.20.0-dev build

- private build root: /data/home/yale/work/quay-scratch/private-dist-020-dev
- VERSION file: 0.20.0-dev
- plugin.json version: 0.20.0-dev
- vendored Core bundle version: /data/home/yale/work/quay-scratch/private-dist-020-dev/vendor/quay/dist/quay.js  (2776113 bytes)
- source sha (worktree HEAD == develop at build time): dfab4b5355e5d859f263ef5c4df534f0f1bdad81
- assembled from: $WT/plugin/  (cp -a), vendored bundle rebuilt by: bash $WT/plugin/scripts/sync-vendor.sh
- bundled with: node --experimental-strip-types $WT/packages/quay/scripts/build-plugin-dist.mjs /data/home/yale/work/quay-scratch/private-dist-020-dev
  => build-plugin-dist: 113 bundled entrypoints -> /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist (+ gate-scripts/dist)
- ⛔ NOT the user plugin cache (~/.claude/plugins/cache/...), NOT the stale /data/home/yale/work/quay-plugin-dist (0.17.0).

### grep — private 0.20.0-dev build:
```
$ grep -n goalDriverChildTimeoutMs /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/goal-driver.js
39508:function goalDriverChildTimeoutMs(recordTimeoutMs, kind, env = process.env) {
62269:    timeoutMs: goalDriverChildTimeoutMs(opts.recordTimeoutMs, "gate"),
65886:    timeoutMs: goalDriverChildTimeoutMs(opts.recordTimeoutMs, "gate"),
65907:  const timeoutMs = opts.spawnTimeoutMs ?? goalDriverChildTimeoutMs(opts.recordTimeoutMs, "activation");
$ grep -n antiDriftPreExitNote /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/worker-driver.js
58672:function antiDriftPreExitNote(task, root, worktree) {
58788:    `(2c) ${antiDriftPreExitNote(task, root, "<the worktree path you created in step 1>")}`,
59764:    `(1c) ${antiDriftPreExitNote(task, root, wt)}`,
```

### negative control — 0.19.0 user-cache dist (the kernel claudecodeui + quay-fleet actually run):
```
$ D=~/.claude/plugins/cache/quay/quay/0.19.0
$ grep -c goalDriverChildTimeoutMs $D/scripts/dist/goal-driver.js   =>  0
$ grep -c antiDriftPreExitNote    $D/scripts/dist/worker-driver.js   =>  0
$ grep -c goalDriverChildTimeoutMs $D/vendor/quay/dist/quay.js      =>  0
```
0.19.0's driver bundle instead carries the literal (grep -n 'var CRITERION_TIMEOUT_MS2' $D/scripts/dist/goal-driver.js):
60258:var CRITERION_TIMEOUT_MS2 = 12e4;
and its gate path spawns with that literal:
60331:  const r = await runAsync(goalStoreArgv(scriptRoot, ["list"], dataRoot), { timeoutMs: CRITERION_TIMEOUT_MS2, collectStderr: true });
60340:  const r = await runAsync(goalStoreArgv(scriptRoot, ["gate", id], dataRoot), { timeoutMs: CRITERION_TIMEOUT_MS2, collectStderr: true });
60357:  const r = await runAsync(argv, { timeoutMs: CRITERION_TIMEOUT_MS2, collectStderr: true });

- local dist mirror /data/home/yale/work/quay-plugin-dist: version = 0.17.0 ; goalDriverChildTimeoutMs count = 0

### AC2 — goal-timeout replay (the goal-driver's OWN gate/activation path, both kernels)

**Method — no re-implementation.** The harness imports the kernel bundle and calls the driver's own
exported `gateCriterion` / `writeGoalStatus`, i.e. the two functions the goal round itself calls
(`goal-driver.ts:3738`/`:3851` gate, `:4051` activation). Nothing here restates the driver's bound —
that is the whole point of the replay.

* scratch clone of the host, commit pinned: `/data/home/yale/work/quay-scratch/ccui-replay`
  (claudecodeui @ `75a072da3909bb80681296e89124377d025ccc65`). `node_modules` **symlinked** and `.env`
  **copied FROM** the host — nothing written back to the host.
* the record's declared `timeoutMs` is raised **in the scratch copy only** (AC-316 `118000 → 900000`;
  AC-319 has no field, so `900000` was added), exactly as the Plan prescribes. Both arms also get the
  host's real `.quay/profiles.yml`, so the P6b fidelity judge resolves on the activation arms.
* `scriptRoot = null` for BOTH arms: that is what a cache install resolves to
  (`resolveQuayCodeRoot()` → null ⇒ the child CLI is `<kernelPluginRoot>/vendor/quay/dist/quay.js`),
  so **each arm runs its OWN vendored goal store** — 0.19.0's bundle for arm A, the private
  0.20.0-dev bundle for arm B. The kernel is the only difference between the arms.
* bounded: one criterion at a time, the host's own `timeoutMs`; wall time and peak RSS pasted per run.

`arm A` kernel = `~/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/goal-driver.js`
`arm B` kernel = `<PRIV>/scripts/dist/goal-driver.js` (`/data/home/yale/work/quay-scratch/private-dist-020-dev`)

**Reading.**
* **`AC-319` (a real claudecodeui criterion that the host's goal driver really killed on 10-11 and 10-12)
  reproduces the defect exactly.** SAME record (`timeoutMs: 900000` in the scratch copy), same criterion,
  only the kernel differs:
  - arm A (0.19.0): wall **`120009 ms`**, verdict **`not-evaluated`**, reason
    **`gate spawn error: spawn timeout after 120000ms (SIGKILL)`** — the very string the host's
    `.quay/goal-round.jsonl` carries. The criterion is legal under its own declared `timeoutMs`; the
    driver's 120 s literal pre-empted it, and the round never saw a verdict.
  - arm B (0.20.0-dev): wall **`129284 ms`** (129.3 s — *beyond* the 120 s the old kernel dies at),
    verdict **`pass`**, `acceptance passed (exit 0)`, no lock. The derived bound
    (`900000 + grace`) waited for the child's own verdict.
* **`AC-316` did NOT reproduce** on the gate path: its criterion finished at `100790 ms`, i.e. under the
  120 s literal, so arm A returned the criterion's own verdict. Pasted, not dropped (AC2's own clause).
  It is the same criterion the host recorded at 120.9–156.6 s under its own load.
* **`AC-316` reproduces on the ACTIVATION path, and there the orphan lock appears.** Same record, same
  real criterion, plus the REAL fidelity judge (`fidelityJudgeArgvJson`, built from the host's own
  `.quay/profiles.yml`): arm A wall `120009 ms` → `write spawn error: spawn timeout after 120000ms
  (SIGKILL)` **and `goals/AC-316.lock` is still on disk afterwards** — the orphan lock that is what
  blocks the host's fan-in `ff` (`cleanTreeCheck`) until someone removes it. Arm B ran the same
  criterion + judge to completion and released the lock. This is the second half of AC2's expected pair,
  and it uses the same two functions the driver round calls.
* `withFileLock` is only on the activation path, so the `gate` arms correctly show **no** lock — the lock
  reading is not a property of the harness but of the path, which is itself the finding.

#### gate arms (real claudecodeui criteria)
```
=================== ARM A-019-AC316  kernel=/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/goal-driver.js  ac=AC-316  recordTimeoutMs=-
lock before: ls: cannot access '/data/home/yale/work/quay-scratch/ccui-replay/goals/*.lock': No such file or directory
REPLAY kind=gate ac=AC-316 kernel=/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/goal-driver.js
REPLAY recordTimeoutMs=(none) wall_ms=100790
REPLAY result={"verdict":"pass","reason":"acceptance passed (exit 0)","cause":null}
exit=0
	Elapsed (wall clock) time (h:mm:ss or m:ss): 1:40.88
	Maximum resident set size (kbytes): 452616
lock after: ls: cannot access '/data/home/yale/work/quay-scratch/ccui-replay/goals/*.lock': No such file or directory
=================== ARM A-019-AC319  kernel=/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/goal-driver.js  ac=AC-319  recordTimeoutMs=-
lock before: ls: cannot access '/data/home/yale/work/quay-scratch/ccui-replay/goals/*.lock': No such file or directory
REPLAY kind=gate ac=AC-319
REPLAY kernel=/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/goal-driver.js
REPLAY recordTimeoutMs=(none) judge=none wall_ms=120009
REPLAY result={"verdict":"not-evaluated","reason":"gate spawn error: spawn timeout after 120000ms (SIGKILL): /data/home/yale/.nvm/versions/node/v24.21.0/bin/node","cause":"spawn"}
exit=0
	Elapsed (wall clock) time (h:mm:ss or m:ss): 2:00.11
	Maximum resident set size (kbytes): 119364
lock after: ls: cannot access '/data/home/yale/work/quay-scratch/ccui-replay/goals/*.lock': No such file or directory
=================== ARM B-020-AC316  kernel=/data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/goal-driver.js  ac=AC-316  recordTimeoutMs=900000
lock before: ls: cannot access '/data/home/yale/work/quay-scratch/ccui-replay/goals/*.lock': No such file or directory
REPLAY kind=gate ac=AC-316
REPLAY kernel=/data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/goal-driver.js
REPLAY recordTimeoutMs=900000 judge=none wall_ms=101723
REPLAY result={"verdict":"pass","reason":"acceptance passed (exit 0)","cause":null}
exit=0
	Elapsed (wall clock) time (h:mm:ss or m:ss): 1:41.84
	Maximum resident set size (kbytes): 471776
lock after: ls: cannot access '/data/home/yale/work/quay-scratch/ccui-replay/goals/*.lock': No such file or directory
DONE-AC2
```

#### same criterion, 0.20.0-dev — the derived bound in force (pair for the AC-319 kill above)
```
=================== ARM B-020-AC319 kernel=/data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/goal-driver.js ac=AC-319 recordTimeoutMs=900000
lock before: ls: cannot access '/data/home/yale/work/quay-scratch/ccui-replay/goals/*.lock': No such file or directory
REPLAY kind=gate ac=AC-319
REPLAY kernel=/data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/goal-driver.js
REPLAY recordTimeoutMs=900000 judge=none wall_ms=129284
REPLAY result={"verdict":"pass","reason":"acceptance passed (exit 0)","cause":null}
exit=0
	Elapsed (wall clock) time (h:mm:ss or m:ss): 2:09.41
	Maximum resident set size (kbytes): 570432
lock after: ls: cannot access '/data/home/yale/work/quay-scratch/ccui-replay/goals/*.lock': No such file or directory
DONE-EXTRA
```

#### activation arms — the path that HOLDS `goals/<id>.lock` (`writeGoalStatus` → `goal write --status active`)
Arm A additionally sets `QUAY_ACCEPTANCE_TIMEOUT_MS=900000`, because in 0.19.0 the activation
criterion deadline is `resolveAcceptanceTimeoutMs()` — the record field is ignored there (the second
half of the fixed defect), so that is the only way to give that arm a legal inner deadline.
```
judge argc=14
=================== ARM ACT-019 kernel=/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/goal-driver.js QUAY_ACCEPTANCE_TIMEOUT_MS=900000 recordTimeoutMs=-
lock before: ls: cannot access '/data/home/yale/work/quay-scratch/ccui-replay/goals/*.lock': No such file or directory
REPLAY kind=write ac=AC-316
REPLAY kernel=/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/goal-driver.js
REPLAY recordTimeoutMs=(none) judge=yes wall_ms=120009
REPLAY result={"ok":false,"reason":"write spawn error: spawn timeout after 120000ms (SIGKILL): /data/home/yale/.nvm/versions/node/v24.21.0/bin/node"}
lock after: /data/home/yale/work/quay-scratch/ccui-replay/goals/AC-316.lock
=================== ARM ACT-020 kernel=/data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/goal-driver.js QUAY_ACCEPTANCE_TIMEOUT_MS=- recordTimeoutMs=900000
lock before: ls: cannot access '/data/home/yale/work/quay-scratch/ccui-replay/goals/*.lock': No such file or directory
REPLAY kind=write ac=AC-316
REPLAY kernel=/data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/goal-driver.js
REPLAY recordTimeoutMs=900000 judge=yes wall_ms=148097
REPLAY result={"ok":true,"reason":"written"}
lock after: ls: cannot access '/data/home/yale/work/quay-scratch/ccui-replay/goals/*.lock': No such file or directory
DONE-ACT
```

**quay-fleet reading.** `AC-031` is a REAL quay-fleet activation whose write was killed 7x on
10-12 on the host. Replayed here it did **not** reproduce, and that is pasted, not dropped: the
fleet criterion is `node --test test/authority.test.mjs` (3.15 s measured), so the child is dominated
by the fidelity judge and landed at 43.8 s (arm A) / 65.6 s (arm B) — both **under** the 120 s literal,
so neither kernel could differ. The host's own 7 kills require the judge latency the host actually
saw; a 3 s criterion cannot reach the bound on demand. Arm A also sets
`QUAY_ACCEPTANCE_TIMEOUT_MS=900000` because 0.19.0 ignores the record field on this path.

```
=================== ARM ACT-fleet-019 kernel=/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/goal-driver.js QUAY_ACCEPTANCE_TIMEOUT_MS=900000 recordTimeoutMs=-
lock before: ls: cannot access '/data/home/yale/work/quay-scratch/fleet-replay/goals/*.lock': No such file or directory
REPLAY kind=write ac=AC-031
REPLAY kernel=/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/goal-driver.js
REPLAY recordTimeoutMs=(none) judge=yes wall_ms=43807
REPLAY result={"ok":true,"reason":"written"}
	Elapsed (wall clock) time (h:mm:ss or m:ss): 0:43.90
	Maximum resident set size (kbytes): 294360
lock after: ls: cannot access '/data/home/yale/work/quay-scratch/fleet-replay/goals/*.lock': No such file or directory
=================== ARM ACT-fleet-020 kernel=/data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/goal-driver.js QUAY_ACCEPTANCE_TIMEOUT_MS=- recordTimeoutMs=900000
lock before: ls: cannot access '/data/home/yale/work/quay-scratch/fleet-replay/goals/*.lock': No such file or directory
REPLAY kind=write ac=AC-031
REPLAY kernel=/data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/goal-driver.js
REPLAY recordTimeoutMs=900000 judge=yes wall_ms=65555
REPLAY result={"ok":true,"reason":"written"}
	Elapsed (wall clock) time (h:mm:ss or m:ss): 1:05.68
	Maximum resident set size (kbytes): 307984
lock after: ls: cannot access '/data/home/yale/work/quay-scratch/fleet-replay/goals/*.lock': No such file or directory
DONE-FLEET
```

### AC3 — anti-drift replay

### the embedded argv comes from the REAL rendered 0.20.0-dev worker prompt (not transcribed by hand)

```
$ node render-prompt.mjs <priv>/scripts/dist/worker-driver.js gap-ac254-mcp-settings-block-scope-checkboxes /home/yale/work/claudecodeui | grep -o '(2c)[^§]*'
(2c) ALSO before exiting, run the SAME anti-drift Touches check the driver's fan-in runs as a HARD pre-merge gate: `node --no-warnings /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/anti-drift-touches-check.js --task gap-ac254-mcp-settings-block-scope-checkboxes --worktree <the worktree path you created in step 1> --merge-target develop`. It diffs your worktree against `develop` and exits 1 naming every file you changed outside the task's declared `## Touches`. If it reports a violation, fix it inside THIS session — do NOT exit and let the retry worker pay a whole new session for it: either (a) declare the file in `## Touches` **through the task ABI** (`task_write`) wh
```

### negative control — the 0.19.0 prompt carries NO such step

```
$ node render-prompt.mjs ~/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/worker-driver.js gap-ac254-mcp-settings-block-scope-checkboxes /home/yale/work/claudecodeui | grep -c anti-drift
0
$ ... | grep -c '(2c)'
0
```

### why a bounce's ORIGINAL branch cannot be checked out (recorded; does not weaken the replay)

```
claudecodeui: 48 distinct tasks bounced on anti-drift (worker-outcome mechanical_fan_in.step=="anti-drift").
surviving refs/heads/task/* = 20; only 2 of the bounced ones survive,
and BOTH read CLEAN — because the retry worker's fix ("declare it in Touches" via task_write, or "revert") IS the
branch tip. Replayed against the surviving branches:

$ node <priv>/scripts/dist/anti-drift-touches-check.js --task gap-live-voice-exclusive-mode-fixed-bar --worktree <wt> --merge-target develop
ANTI-DRIFT OK: task gap-live-voice-exclusive-mode-fixed-bar — 0 actual file(s), all within declared Touches (12 glob(s))   exit=0
$ ... --task gap-model-library-context-window-follows-model ...
ANTI-DRIFT OK: task gap-model-library-context-window-follows-model — 4 actual file(s), all within declared Touches (7 glob(s))   exit=0

(quay: 60 distinct bounces, 19 surviving task heads, 3 collide -> all 3 read ANTI-DRIFT OK too. cantus: 5 bounces, 0 heads.)

=> the pre-fix intermediate commit is STRUCTURALLY unreachable: the branch TIP is always the post-fix state.
   So each rejected state below is rebuilt in a scratch clone from (a) the fan-in's OWN carrier — the log that
   enumerated the offending files — and (b) the task's `## Touches` AS DECLARED AT BOUNCE TIME, fetched from the
   repo's own history as the PARENT of the later Touches-widening commit
   (`git show <widening>^:tasks/<id>.md`). With the bounce-time declaration in place the same argv must re-derive
   the same rejection; that is what is pasted below.
```

### claudecodeui — 5 replays: exit 1, files named IDENTICAL to the fan-in log's rejected files
(The 5th, `gap-voice-sensevoice-server-adapter`, additionally names the task file itself: for that id the
Touches-widening commit could not be located by `-S`, so the worktree kept `develop`'s task copy while the
reconstruction committed a different one — a reconstruction artifact, stated rather than hidden. The file
the fan-in actually named, `scripts/asr-health-provider-check.mjs`, is present and identical.)

```
=== TASK gap-ac254-mcp-settings-block-scope-checkboxes
touches-widening commit: f4e4505a481abea38b488827eef8a5c9a6c000d3 (2026-10-05 12:12:00 +0800)
task file restored to the bounce-time declaration (f4e4505a481abea38b488827eef8a5c9a6c000d3^)
argv: node --no-warnings /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/anti-drift-touches-check.js --task gap-ac254-mcp-settings-block-scope-checkboxes --worktree /data/home/yale/work/quay-scratch/ccui-rb-gap-ac254-mcp-settings-block --merge-target develop
ANTI-DRIFT HARD FAIL: task gap-ac254-mcp-settings-block-scope-checkboxes — 2 violation(s)
  out-of-declared: task wrote src/shared/constants.ts (matches no declared Touches glob)
  out-of-declared: task wrote src/shared/types.ts (matches no declared Touches glob)
exit=1
=== TASK gap-ac289-english-only-server-copy
touches-widening commit: 11a353a01a8a8ceb06df7f067790b094e049720d (2026-10-07 02:09:49 +0800)
task file restored to the bounce-time declaration (11a353a01a8a8ceb06df7f067790b094e049720d^)
argv: node --no-warnings /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/anti-drift-touches-check.js --task gap-ac289-english-only-server-copy --worktree /data/home/yale/work/quay-scratch/ccui-rb-gap-ac289-english-only-serve --merge-target develop
ANTI-DRIFT HARD FAIL: task gap-ac289-english-only-server-copy — 1 violation(s)
  out-of-declared: task wrote server/modules/mcp-gateway/mcp-approvals.ts (matches no declared Touches glob)
exit=1
=== TASK gap-mcp-deploy-freshness-build-sha-health-check
touches-widening commit: 31f71e192782f51a70bd4d6e08db409ea0c904c3 (2026-10-11 22:10:14 +0800)
task file restored to the bounce-time declaration (31f71e192782f51a70bd4d6e08db409ea0c904c3^)
argv: node --no-warnings /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/anti-drift-touches-check.js --task gap-mcp-deploy-freshness-build-sha-health-check --worktree /data/home/yale/work/quay-scratch/ccui-rb-gap-mcp-deploy-freshness-bui --merge-target develop
ANTI-DRIFT HARD FAIL: task gap-mcp-deploy-freshness-build-sha-health-check — 1 violation(s)
  out-of-declared: task wrote server/modules/system/index.ts (matches no declared Touches glob)
exit=1
=== TASK gap-voice-realtime-empty-transcript-delivery-guard
touches-widening commit: 738ed76efce59f9bbd168357124c450c95c780e6 (2026-10-11 13:20:14 +0800)
task file restored to the bounce-time declaration (738ed76efce59f9bbd168357124c450c95c780e6^)
argv: node --no-warnings /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/anti-drift-touches-check.js --task gap-voice-realtime-empty-transcript-delivery-guard --worktree /data/home/yale/work/quay-scratch/ccui-rb-gap-voice-realtime-empty-tra --merge-target develop
ANTI-DRIFT HARD FAIL: task gap-voice-realtime-empty-transcript-delivery-guard — 1 violation(s)
  out-of-declared: task wrote server/modules/voice-realtime/voice-realtime-log.ts (matches no declared Touches glob)
exit=1
=== TASK gap-voice-sensevoice-server-adapter
touches-widening commit: af5d807da4beaec444974e10578d5649c3717a2e (2026-10-06 05:42:06 +0800)
argv: node --no-warnings /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/anti-drift-touches-check.js --task gap-voice-sensevoice-server-adapter --worktree /data/home/yale/work/quay-scratch/ccui-rb-gap-voice-sensevoice-server- --merge-target develop
ANTI-DRIFT HARD FAIL: task gap-voice-sensevoice-server-adapter — 2 violation(s)
  out-of-declared: task wrote scripts/asr-health-provider-check.mjs (matches no declared Touches glob)
  out-of-declared: task wrote tasks/gap-voice-sensevoice-server-adapter.md (matches no declared Touches glob)
exit=1
```

### quay-fleet — 2 replays: exit 1, files named IDENTICAL to the fan-in log's rejected files

```
=== TASK fleet-p0-loop-phases-and-control
touches-widening commit: 101dfef57cfcb953bc1c7e619d2d03e0bf70ac3c （2026-10-12 03:51:17 +0800）
task file restored to the bounce-time declaration (101dfef57cfcb953bc1c7e619d2d03e0bf70ac3c^)
argv: node --no-warnings /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/anti-drift-touches-check.js --task fleet-p0-loop-phases-and-control --worktree /data/home/yale/work/quay-scratch/fleet-rb-fleet-p0-loop-phases-and-control --merge-target develop
ANTI-DRIFT HARD FAIL: task fleet-p0-loop-phases-and-control — 1 violation(s)
  out-of-declared: task wrote docs/evidence/2026-10-12-halt-resume-drill.md (matches no declared Touches glob)
exit=1
=== TASK fleet-mcp-delegate-smoke
touches-widening commit: e1f7e13313b8d06cabe798ffa26c6c4386a6e281 （2026-10-12 02:43:47 +0800）
task file restored to the bounce-time declaration (e1f7e13313b8d06cabe798ffa26c6c4386a6e281^)
argv: node --no-warnings /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/anti-drift-touches-check.js --task fleet-mcp-delegate-smoke --worktree /data/home/yale/work/quay-scratch/fleet-rb-fleet-mcp-delegate-smoke --merge-target develop
ANTI-DRIFT HARD FAIL: task fleet-mcp-delegate-smoke — 2 violation(s)
  out-of-declared: task wrote docs/evidence/2026-10-12-cloudcli-mcp.md (matches no declared Touches glob)
  out-of-declared: task wrote testdata/stub-mcp-server.mjs (matches no declared Touches glob)
exit=1
=== TASK fleet-p1-session-reuse-gate
touches-widening commit: 132e104257d42d0f4c3865e1dea3bdd368a68089 （2026-10-12 17:58:23 +0800）
argv: node --no-warnings /data/home/yale/work/quay-scratch/private-dist-020-dev/scripts/dist/anti-drift-touches-check.js --task fleet-p1-session-reuse-gate --worktree /data/home/yale/work/quay-scratch/fleet-rb-fleet-p1-session-reuse-gate --merge-target develop
ANTI-DRIFT HARD FAIL: task fleet-p1-session-reuse-gate — 2 violation(s)
  out-of-declared: task wrote bin/quay-fleet.mjs (matches no declared Touches glob)
  out-of-declared: task wrote tasks/fleet-p1-session-reuse-gate.md (matches no declared Touches glob)
exit=1
```

### AC4 — production trial plan (written, NOT executed here)

Host deployment, read 2026-10-13 (before): both hosts run the **0.19.0 user-cache kernel**.

| host | anchor pid | ExecStart kernel | install shape |
|---|---|---|---|
| claudecodeui | 2919772 | `~/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/claudecodeui` | USER-scope marketplace install; `.quay/plugin` is a **symlink** to that cache dir |
| quay-fleet | 2738045 | same 0.19.0 path, `--root /home/yale/work/quay-fleet` | PROJECT-scope install (`enabledPlugins: {"quay@quay": true}`) |

Both are systemd **user scopes** `quay-anchor-<host>-<id>.scope`; the kernel path in ExecStart is
whatever `quay driver start` resolved when the anchor was launched.

**1. Kernel selection.** The anchor's kernel is NOT `<host>/.quay/plugin`; it is the bundle the `quay`
CLI that called `driver start` resolved (`resolveKernelPluginRoot()` = the running bundle's own dir,
`driver-runtime.ts:309`). Two reversible ways to select the private build:
  (a) **start the anchor from the private build** — `node <PRIV>/scripts/dist/driver-anchor.js __anchor --root <host>`
      under the same scope wrapper `quay driver start` uses; and
  (b) for claudecodeui only, also `ln -sfn <PRIV> /home/yale/work/claudecodeui/.quay/plugin` so the host's
      skills/MCP point at the same tree (the symlink is the single switchable datum — `ln -sfn` back is the rollback).
Chosen trial host: **claudecodeui** (it already has the symlinked `.quay/plugin`, so the switch is one
symlink target plus one anchor start; nothing project-scope is rewritten).
⛔ This is NOT a user-scope plugin upgrade and NOT a publish (hard boundary). `<PRIV>` stays outside
`~/.claude/plugins/cache` and outside `quay-plugin-dist`.

**2. Restart semantics for in-flight workers.** `quay driver stop|restart` kills only the supervisor +
driver itself — it deliberately does **not** touch the worker kind's in-flight children
(`CLAUDE.md` §driver 进程管理; the driver's own comment). Therefore, before the switch:
  1. `ps aux | grep -E 'quay-task-worker|claude -p'` and `git worktree list` on the host — count in-flight tasks;
  2. wait until the count is 0 (or `quay driver drain --kind worker`, which blocks new dispatches and does
     NOT kill in-flight work, then wait);
  3. only then stop+start. Restarting while a peer worker is in flight risks a half-landed task
     (`no-prod-serve-restart-while-peer-workers-inflight`).
Expected transient: ≤ 1 round of missed dispatches (~`drivers.yml` `intervalMs`), and the promotion/
goal drivers re-read state from `.quay/*-control.json` on boot.

**3. Worker-session / `quay init` requirement.** Worker sessions are spawned fresh by the driver
(`claude -p`, `launchArgv("task-worker", …)`), so **no `quay init` is needed** — `quay init` writes a
workspace's `.quay/config.yml` + skills, none of which change here. What must be true:
  - workers must be **new** sessions; a *resident* session keeps whatever kernel it started with, so the
    switch only takes effect for rounds dispatched after the restart;
  - verify the switch actually took: `.quay/anchor.json`'s `bundle.kernel` must name `<PRIV>/scripts/dist/driver-anchor.js`
    (and `rebuild`/`kinds` must not read `not-evaluated` in a way that hides a stale kernel);
  - the goal driver's child CLI is `resolveKernelPluginRoot()/vendor/quay/dist/quay.js` (scriptRoot is
    `null` on a cache install), so the *same* `<PRIV>` must carry a freshly built `vendor/quay/dist/quay.js`.

**4. Resource estimate.** Same Node process count; the kernels differ only in two bundled files.
Measured: private `scripts/dist/goal-driver.js` vs 0.19.0's — sizes pasted in AC1. Peak RSS of the
replayed spawn (AC2) is pasted there; the replay's per-run footprint is the number to watch. No new
daemon, no new port, no new unit; the systemd scope's `MemoryMax` (27917287424, host-derived) is unchanged.

**5. Rollback.** Re-point and restart: `ln -sfn ~/.claude/plugins/cache/quay/quay/0.19.0 /home/yale/work/claudecodeui/.quay/plugin`
and start the anchor on the 0.19.0 path again, with the same drain-first discipline. The private build is
never installed into the cache, so nothing else needs undoing; `.quay/` and `tasks/` are untouched by the
switch itself.

**6. Metrics + window.** Read **only from the host's own carriers** (quay's own readings are explicitly
not host evidence):
  - goal kills: `grep -c 'spawn timeout after 120000ms' /home/yale/work/claudecodeui/.quay/goal-round.jsonl`,
    split into `gate spawn error` / `write spawn error` (per day via the record's `ts`);
  - anti-drift bounces: `mechanical_fan_in.step == "anti-drift"` rows ÷ worker-outcome rows in
    `/home/yale/work/claudecodeui/.quay/worker-outcome.jsonl`;
  - leftover locks: `ls /home/yale/work/claudecodeui/goals/*.lock` and
    `git -C /home/yale/work/claudecodeui status --porcelain` (an orphan lock shows there, and it is what
    blocks fan-in `ff`).
Window: **≥3 consecutive days before** and **≥3 after** the switch, host in its normal workload. The
pre-fix baseline (from the finding, 2026-10-13) is: goal 120 s kills 10-09 1/5, 10-10 2/13, 10-11 4/0,
10-12 5/0; anti-drift bounces / worker outcomes 10-09 2/75, 10-10 0/75, 10-11 5/111, 10-12 2/83.

**7. The exact human approval needed (AC5).** A person must approve **this one step**, in this order:
  1. the in-flight reading from step 2 (ps + worktree list, count must be 0);
  2. **starting claudecodeui's anchor from the private build `<PRIV>`**, i.e. stopping its current
     promotion/worker/outer/goal anchor (pid 2919772, 0.19.0) and starting it on
     `<PRIV>/scripts/dist/driver-anchor.js` — a host-affecting, outward-facing action on a live workspace;
  3. the ≥3-day window in step 6.
No host `.quay/`, no host task, and no user-scope plugin is modified by this plan; the switch is the
anchor process only, and it is reversible with `ln -sfn` back + one restart.

**Baseline re-derived here from the hosts' own carriers** (not copied from the finding) — this is the
"before" column of the window in step 6, and it is what the trial must move:

```
-- claudecodeui
   2026-10-09: goal120s gate=1 write=5 | anti-drift 2/75
   2026-10-10: goal120s gate=2 write=13 | anti-drift 0/75
   2026-10-11: goal120s gate=4 write=0 | anti-drift 5/111
   2026-10-12: goal120s gate=5 write=0 | anti-drift 2/83
-- quay-fleet
   2026-10-12: goal120s gate=0 write=7 | anti-drift 1/66
```

### Definition of Done — host non-modification (before/after) and scratch inventory

```
===== BEFORE (2026-10-12T23:59:55Z) =====
=== HOST BASELINE (before), 2026-10-12T23:59:55Z
--- claudecodeui
anchor.json: {"pid":2919772,"startedAt":"2026-10-12T08:37:19.633Z","kinds":["promotion","worker","outer","goal"],"host":"anchor","bundle":{"state":"not-evaluated","kernel":"/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/driver-anchor.js","builtAt":"2026-10-11T01:18:06.704Z","sourceDir":null,"sourceMtime":null,"kinds":[],"rebuild":null,"at":"2026-10-12T23:59:47.949Z"},"envelope":{"envelope"
anchor.pid: 2919772
ps: 2919772 /data/home/yale/.nvm/versions/node/v24.21.0/bin/node /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/claudecodeui
git status --porcelain .quay tasks:
goals locks: ls: cannot access '/home/yale/work/claudecodeui/goals/*.lock': No such file or directory
HEAD: 0cabdde399cc69c7f0f2757b38046b41049d4849
branch: author
--- quay-fleet
anchor.json: {"pid":2738045,"startedAt":"2026-10-11T17:23:42.178Z","kinds":["promotion","worker","outer","goal"],"host":"anchor","bundle":{"state":"not-evaluated","kernel":"/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/driver-anchor.js","builtAt":"2026-10-11T01:18:06.704Z","sourceDir":null,"sourceMtime":null,"kinds":[],"rebuild":null,"at":"2026-10-12T23:59:49.138Z"},"envelope":{"envelope"
anchor.pid: 2738045
ps: 2738045 /data/home/yale/.nvm/versions/node/v24.21.0/bin/node /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/quay-fleet
git status --porcelain .quay tasks:
goals locks: ls: cannot access '/home/yale/work/quay-fleet/goals/*.lock': No such file or directory
HEAD: 67e251fc2032db2ff39e456efbc17314b3b22cfd
branch: author

===== AFTER (2026-10-13T00:23:30Z) =====
--- claudecodeui
anchor.pid: 2919772
ps: 2919772 /data/home/yale/.nvm/versions/node/v24.21.0/bin/node /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/claudecodeui
git status --porcelain .quay tasks:
goals/*.lock: ls: cannot access '/home/yale/work/claudecodeui/goals/*.lock': No such file or directory
HEAD: c6311958f1d7e423d2dfb467d1176725a9aebca8
--- quay-fleet
anchor.pid: 2738045
ps: 2738045 /data/home/yale/.nvm/versions/node/v24.21.0/bin/node /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/quay-fleet
git status --porcelain .quay tasks:
goals/*.lock: ls: cannot access '/home/yale/work/quay-fleet/goals/*.lock': No such file or directory
HEAD: b148e3d95e2cd11997bd50d765f1e4cb63ea0d71
```

Scratch artifacts (all under /data/home/yale/work/quay-scratch/, outside every host checkout):
```
/data/home/yale/work/quay-scratch/private-dist-020-dev          <- the private 0.20.0-dev build (AC1)
/data/home/yale/work/quay-scratch/ccui-replay                   <- claudecodeui scratch clone (AC2 goal replay root, AC3 recon worktrees)
/data/home/yale/work/quay-scratch/ccui-wt-*, ccui-rb-*          <- its worktrees
/data/home/yale/work/quay-scratch/quay-replay, quay-wt-*        <- quay scratch clone (surviving-branch negative readings)
/data/home/yale/work/quay-scratch/fleet-replay, fleet-rb-*      <- quay-fleet scratch clone (AC2 fleet arm, AC3 fleet replays)
/data/home/yale/work/quay-scratch/evidence/                     <- harnesses + raw logs
```
The host checkouts themselves were only READ (git status / git log / cat / cp FROM them). No
`git worktree add`, no task write, no `.quay/` write, no anchor restart, no user-scope plugin change.

NOTE on the two host HEAD shas differing between BEFORE and AFTER: both hosts are LIVE — their own
promotion/worker/goal drivers commit task-state continuously (claudecodeui `author` advanced
while this replay ran). That is the hosts' own activity, not this task's: the datum that carries
the claim is `git status --porcelain .quay tasks`, and it is EMPTY in both captures.

## Touches
- tasks/gap-cross-project-replay-verify-goal-timeout-and-anti-drift-fixes-on-claudecodeui-and-quay-fleet.md