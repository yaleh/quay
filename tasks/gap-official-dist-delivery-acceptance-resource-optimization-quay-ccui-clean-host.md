---
id: gap-official-dist-delivery-acceptance-resource-optimization-quay-ccui-clean-host
title: 资源优化能力的正式 dist
  交付验收：Quay、ClaudeCodeUI、独立干净单项目宿主三方验证（完整性负例/OOM/超时/恢复/无残留、同commit同scope前后对比）
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
depends_on:
  - gap-quality-gate-driver-loop-watchdog-test-hangs-since-e18ec4b04
  - gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison
  - gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler
  - gap-quality-continuous-resource-diagnostic-routine-mechanical-filter-then-semantic
  - gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls
---
## Proposal
**Final integration gate for the whole "check resource optimization" initiative, requested 2026-10-14: the official shipped dist artifact (not source-tree self-tests) must be verified on Quay's own host, on ClaudeCodeUI, and on an independent clean single-project host at a different path — covering completeness negative cases, OOM, timeouts, interrupt/resume, no leftover processes, and a same-commit same-full-scope before/after resource and failure-rate comparison.**

This repeats the pattern already used successfully this session for the architecture-analysis capability (`gap-quay-architecture-analysis-shipped-capability-cleanroom-acceptance`, done) and for the driver-restart E2E (`gap-driver-restart-anytime-busy-e2e-on-dist-kernel`, done): build the real `publish-dist-branch.sh` artifact, verify on a `.git`-free clean-room host with no quay source checkout, then on the real hosts.

Gated on all of P0 and A-E landing first (there is nothing to package-test before the underlying fixes exist), per the stated sequencing: P0+A/B basics, then C, then E and F.

## Plan
1. Build the official dist artifact from develop once all dependencies have landed.
2. Clean-room host (independent single-project path, no quay source checkout, `.quay/plugin` resolved to the artifact — same isolation discipline as the earlier cleanroom task): run the full completeness/telemetry/lifecycle/host-adapter stack's negative cases — a planted OOM, a planted timeout, an interrupted-and-resumed experiment, a killed suite — and confirm no leftover process and no false-green.
3. Quay's own host and ClaudeCodeUI: deploy via the established live anchor-takeover handoff (no service interruption), verify the same capability set runs for real, and run the same-commit same-full-scope before/after comparison (resource usage, wall time, failure rate) that `gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison` already produced in its own task — cited here, not re-run from scratch.
4. No budget ceiling is raised on any host as part of this acceptance.

## Acceptance Criteria
- [x] AC1: clean-room host, official dist, no quay source checkout: a planted OOM and a planted timeout each produce the correct non-green verdict with no leftover process (pasted, both cases, negative controls included).
- [x] AC2: clean-room host: an interrupted experiment (driver restart mid-run) resumes correctly per the C task's manifest, without recomputing a completed stage (pasted).
- [ ] AC3: Quay's own host, live anchor, official dist: a real round of the completeness/telemetry/diagnostic-routine stack, cited same-commit same-scope before/after numbers from the heavy-files/concurrency task (pasted).
- [ ] AC4: ClaudeCodeUI, live anchor, official dist: the same real round and verification, via the established takeover handoff with no interruption to its own in-flight work (pasted).
- [x] AC5: `scripts/test.sh --for-task <this task>` green on the source tree in addition to the three host checks above.

## Definition of Done
- AC1-AC5 checked with pasted evidence from all three hosts. No budget ceiling raised anywhere. No global user-scope plugin install modified.

## Touches
- tasks/gap-official-dist-delivery-acceptance-resource-optimization-quay-ccui-clean-host.md
- plugin/scripts/publish-dist-branch.sh

## Round 1 (2026-10-16) — official-dist acceptance. AC1/AC2/AC5 met; AC3 partly met; AC4 not attempted (authorization)

### §0 — the artifact under test, and how the clean host is isolated

`bash plugin/scripts/publish-dist-branch.sh --branch dist-plugin-resopt-accept`, run from this task's
worktree at develop `fa6cafc3b`:

```
[publish-dist-branch] built bundle: .../vendor/quay/dist/quay.js (2779918 bytes)
STAMP-VERSION: OK — all 4 carriers already == 0.21.0-dev; wrote nothing
[publish-dist-branch] pruned 19 .sh file(s) no runtime surface reaches
dist-closure gate OK (directory): 121 referenced dist bundles all present
[publish-dist-branch] orphan commit ready: 4d30b89a3d2536301325f720e1ba3ba644c05207
[publish-dist-branch] --push not given; built+committed locally only
```

Materialised as a **`.git`-free plain copy** (287 files, 61 MB, `.claude-plugin/plugin.json` version
`0.21.0-dev`) at `/data/home/yale/work/quay-scratch/resopt-dist-artifact`. The linked-worktree form is the
recorded contamination trap (see the cleanroom task's "Methodology correction" — `quay init` resolves
`.quay/plugin` *through git* back to the quay source checkout), so every clean host below uses the plain copy.

Clean host `resopt-host-a`: `git init -b develop` + `README.md`/`src/a.ts`/`test/*.test.mjs`/`scripts/test.sh`,
then `node <artifact>/vendor/quay/dist/quay.js init --root <host> --test-command "bash scripts/test.sh"`.

```
$ readlink -f /data/home/yale/work/quay-scratch/resopt-host-a/.quay/plugin
/data/home/yale/work/quay-scratch/resopt-dist-artifact        <- no path through the quay source checkout
$ ls /data/home/yale/work/quay-scratch/resopt-host-a         <- README.md scripts src test .quay
```

The host's `scripts/test.sh` emits the `__PERFILE__` terminal protocol through the **artifact's own**
`measure-suite-reporter.mjs` (`--test-reporter=.../measure-suite-reporter.mjs`), i.e. the completeness
verdict's input is produced by the shipped tree, not by a hand-rolled approximation:

```
$ bash scripts/test.sh
__PERFILE__ duration_ms=37.720132 .../test/ok1.test.mjs passed=true end_ms=1792153489316
__PERFILE__ duration_ms=35.741807 .../test/ok2.test.mjs passed=true end_ms=1792153489319
__GROUP__ concurrency=4 files=2 sum_ms=73.461939 floor_ms=37.720132 capped=2
```

### §1 — AC1 PASS: planted OOM and planted timeout, with negative controls, no leftover process

Three arms, same host, same runner invocation
(`<artifact>/scripts/dist/full-suite-runner.js --root <host> --lane-count 2`,
`QUAY_TEST_SYSTEMD_RUN_LIMITS="MemoryMax=2G MemorySwapMax=0"`), only the planted fault differing.

**(a) no fault = negative control: the stack reads GREEN.**

```
[full-suite-runner] SUITE-PLAN planned=2 terminal=2 missing=0 source=probe:test.sh --list-files
                    plan_error=null completeness=complete oomKill=0 telemetry=ok laneCount=2
[full-suite-runner] leak sweep — 0 survivor(s) in the suite's own process group 3428929 (reaped=true)
[full-suite-runner] FINAL state=green durationMs=1047 exit=0
```

**(b) planted OOM** — `test/hog.test.mjs` spawns an allocator child the scope's `MemoryMax=2G` cannot hold
(the child is taken by the cgroup OOM killer; a `test/keepalive.test.mjs` keeps the scope alive long enough
for the sampler to read `memory.events` while it still exists). **Non-green verdict:**

```
full-suite-runner: NOT-EVALUATED oom-killed (1) — the round is NOT green
[full-suite-runner] SUITE-PLAN planned=4 terminal=4 missing=0 ... completeness=not-evaluated oomKill=1 telemetry=ok
[full-suite-runner] SUITE-INCOMPLETE reason=oom-killed planned=4 terminal=4 missing=0 oomKill=1 files=
```

round record: `state=red reason=failed plannedFiles=4 terminalFiles=4 completeness=complete oomKill=1 telemetry=ok pass=3 fail=1 tests=4`

**(c) planted timeout** — `test/hang.test.mjs` never terminates and never prints again
(`QUAY_TEST_SUITE_SILENCE_MS=10000`). **Non-green verdict, with the missing file named:**

```
full-suite-runner: no suite output for 10s — hung, killing child tree, state=red reason=hung
[full-suite-runner] SUITE-PLAN planned=3 terminal=2 missing=1 ... completeness=incomplete oomKill=0 telemetry=ok
[full-suite-runner] SUITE-INCOMPLETE reason=incomplete planned=3 terminal=2 missing=1 oomKill=0 files=test/hang.test.mjs
full-suite-runner: missing terminal record(s) (1):
  test/hang.test.mjs
```

round record: `state=red reason=hung plannedFiles=3 terminalFiles=2 completeness=incomplete oomKill=0 telemetry=ok`

**No leftover process, all three arms.** After each arm, an independent predicate
(`pgrep -af <host-root>`, excluding the harness's own shell):

```
LEFTOVERS: none (0 processes referencing /data/home/yale/work/quay-scratch/resopt-host-a)   x3
```

**Negative control for that predicate (both halves of 硬规则 2).** A zero count proves nothing unless the
predicate can return non-zero, so it was dry-run against a known-true sample:

```
$ bash -c "exec -a resopt-fake-leftover-/data/home/yale/work/quay-scratch/resopt-host-a sleep 60" &
$ pgrep -af "<host>" | grep -v pgrep
3552262 resopt-fake-leftover-/data/home/yale/work/quay-scratch/resopt-host-a 60
$ ... | wc -l
1
```

⇒ the three zero readings are measurements, not a blind predicate. **AC1 satisfied.**

### §2 — AC2 PASS: interrupted experiment resumes at the next stage, stage 1 not recomputed

Manifest written on the SAME clean host, read back by the **artifact's** `scripts/dist/experiment-manifest.js`
(the C task's `gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler` carrier).
Three stages: `smoke-lane2` (kind smoke) → `lane2-r1` (full, 25 s) → `lane4-r1` (full). State dir
`<host>/.quay/experiments/resopt-ac2-experiment/`, output dir `.../out` holding `stages.log` + `*.out`.

**Interrupt (the driver-restart arm).** The run is started with `setsid`, and once `stages.log` shows
`lane2-start` the whole process group is `SIGTERM`ed — i.e. the in-flight stage dies together with the worker:

```
----- STATE: AFTER INTERRUPT -----
stages.log:  smoke-start / smoke-done / lane2-start          <- stage 2 started, never finished
checkpoints: smoke-lane2                                      <- only the COMPLETED stage is checkpointed
artifacts:   smoke.out
smoke.out md5: cf84b226ed3d70bd78dcec6cbd1fe532
smoke-start line count: 1
```

**Redispatch ⇒ resume.** The plan skips the completed stage; only the remainder runs:

```
$ node <artifact>/scripts/dist/experiment-manifest.js --plan --task resopt-ac2-experiment --root <host>
experiment-manifest: resopt-ac2-experiment — identity commit=bf5e242c5306 host=VM-16-5-ubuntu policy=8eb34c4a5bbc
  [skip] smoke-lane2 (smoke) — checkpoint trusted (inputs + identity match)
  [run] lane2-r1 (full) — no checkpoint
  [run] lane4-r1 (full) — no checkpoint
  => run 2 / skip 1 / invalidated 0 / blocked 0
```

```
----- STATE: AFTER RESUME -----
stages.log:  smoke-start / smoke-done / lane2-start / lane2-start / lane2-done / lane4-start / lane4-done
checkpoints: lane2-r1, lane4-r1, smoke-lane2
smoke.out md5 BEFORE resume: cf84b226ed3d70bd78dcec6cbd1fe532
smoke.out md5 AFTER  resume: cf84b226ed3d70bd78dcec6cbd1fe532
smoke-start line count: 1                 <- stage 1 ran exactly once, across both runs
STAGE-1 NOT RECOMPUTED: YES
```

**Negative control (the pre-fix world): checkpoint carrier removed, then re-run.**

```
$ rm checkpoints.json ; node .../experiment-manifest.js --plan ...
  [run] smoke-lane2 (smoke) — no checkpoint
  [blocked] lane2-r1 (full) — no passing smoke stage yet (smoke-lane2)
  [blocked] lane4-r1 (full) — no passing smoke stage yet (smoke-lane2)
  => run 3 / skip 0 / invalidated 0 / blocked 2
----- STATE: AFTER NEGATIVE CONTROL -----
smoke-start line count: 2                 <- without a checkpoint, stage 1 IS recomputed
STAGE-1 RECOMPUTED IN THE NEGATIVE CONTROL (must be YES): YES
```

⇒ the "not recomputed" reading is attributable to the checkpoint mechanism, not to the host. **AC2 satisfied.**

### §3 — AC3: the readings that DO bear on the property, and the one clause that is NOT met

**What was run, on Quay's own host, from the official dist.**

1. **A real, full-scope round of the completeness/telemetry/lifecycle stack.** Three consecutive rounds of
   `<artifact>/scripts/dist/full-suite-runner.js --root <this task's worktree> --lane-count 32`,
   `QUAY_SUITE_MEMORY_MAX=16G`, state dir in scratch (so the live ledger the anchor reads is untouched):

   | round | planned=terminal | completeness | oomKill | telemetry | tests | pass | fail | wall s | verdict |
   |---|---|---|---|---|---|---|---|---|---|
   | `ac3-quay-host-dist-round` | 1005=1005 | complete | 0 | ok | 11754 | 11753 | 1 | 168 | red / leaked-processes (2) |
   | `ac3-quay-host-dist-round2` | 1005=1005 | complete | 0 | ok | 11755 | 11754 | 1 | 167 | red / leaked-processes (2) |
   | `ac3-quay-host-dist-round3` | 1005=1005 | complete | 0 | ok | 11755 | 11755 | 0 | 175 | red / leaked-processes (2) |

   Round 3 is a **fully green suite** (`fail 0`); all three rounds read `planned == terminal == 1005` and
   `oomKill=0 telemetry=ok`, i.e. the three dimensions AC3 names are produced correctly on this host from
   the shipped tree. Rounds 1/2's single failure is `plugin/test/full-suite-runner-cgroup.test.mjs` AC4
   (`sampler cost < 1% of suite wall`) — a load-sensitive timing assertion under a host carrying two peer
   suites; it is absent in round 3.

   ⚠️ **New, reproducible reading — reported as read, NOT root-caused.** All three rounds end
   `not-evaluated: leaked-processes (2)` from the lifecycle guard, naming the runner's **own** suite
   wrapper and its child:

   ```
   full-suite-runner: leak sweep — 2 survivor(s) in the suite's own process group 2359056 (reaped=true)
     pid=2367349 ppid=319121 cmd=bash scripts/test.sh --test-concurrency=32   cwd=<worktree>
     pid=3573689 ppid=2367349 cmd=sleep 1
   full-suite-runner: NOT-EVALUATED leaked-processes (2) — the round is NOT green
   ```

   Reproduced **3/3**, on two different cwds (one of which was not a git repo — that confound was removed
   for round 3 and the reading did not change), with the same two processes both times; the sweep reaps them
   (`reaped=true`) and both pids are gone afterwards. `scripts/test.sh` contains no self-re-invocation, so
   the named process is the runner's own direct suite child. Whether this is a guard-window artefact (the
   wrapper still finishing its trailing phase) or a real orphan is **not settled here** — this round reports
   the reading, not a diagnosis. Note the clean-room host's arms in §1 all read `0 survivor(s)`, so the
   reading is specific to the full quay tree.

2. **A real round of the diagnostic routine, from the official dist, over THIS host's live carriers
   (read-only, no carrier append, no model call).** The artifact emits one bundle for the whole quality-driver
   family, whose inlined modules each keep their own basename-keyed direct-entry guard; naming the copy for
   the module it should run reaches the detector's own CLI:

   ```
   $ node <ev>/bin/resource-anomaly-detector.js \
       --rounds /data/home/yale/work/quay/.quay/verification-round.jsonl \
       --root /data/home/yale/work/quay --no-carrier --json
   {"routine":"resource-diagnostic","rounds_read":200,"experiments_read":0,
    "concept_key_module":"/data/home/yale/work/quay/docs/analysis/discovery-experience-ledger.mjs",
    "concept_key_error":null,"anomalies":147,"distinct_concept_keys":24,"keyed":147,"fresh":24,
    "repeated":123,"unkeyable":0,"appended":0,
    "reservations_before":0,"reservations_after":0,"reservations_delta":0,
    "classes":["leaked-process","long-tail-duration","oom-kill","watchdog-shape-shift"], ...}
   ```

   Carrier read: `199,867,191` bytes of `.quay/verification-round.jsonl`. `reservations_delta: 0` — the
   mechanical pass took no model call, as designed. Two of the fresh anomalies are the classes AC3's
   initiative exists for: `{"class":"oom-kill","detail":"round 2680 (commit 77e22af2…): oomKill=1"}` and
   `{"class":"leaked-process","detail":"round 2670 (commit 129679ef…): 2 leaked process(es)"}`.

3. **The live anchor's own round on this host** (read from the anchor's carrier, not re-run):

   ```
   {"round":2760,"runId":"mfi-gap-suite-heavy-files-…-d9a7ee","state":"red","reason":"failed",
    "plannedFiles":1005,"terminalFiles":1005,"completeness":"complete","oomKill":0,"telemetry":"ok",
    "pass":11754,"fail":1,"tests":11755,"laneCount":127,
    "commit":"fa9e1bd8661a1c23630c3a3778f5c30ba950c646","scope":"worktree"}
   ```

4. **The cited same-commit same-scope before/after numbers** — from
   `gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison` §3 (not re-run
   here). 16 GiB baseline, `QUAY_SUITE_MEMORY_MAX=16G`, heavy bucket explicitly OFF, the only independent
   variable being concurrency; every row a COMPLETE round (`planned=terminal`):

   | requested (=actual) | rows | planned=terminal | tests | oom_kill | cgroup peak GiB | swap peak GiB | psi_full | wall s |
   |---|---|---|---|---|---|---|---|---|
   | 32 | 4 | 1005=1005 | 11753 | 0,0,0,0 | 15.14–16.00 | 0.00 | 0 | 167–182 |
   | 48 | 3 | 1005=1005 | 11753 | 0,0,0 | 16.00 | 0.00 | 0–0.18 | 167–321 |
   | 64 | 5 | 1005=1005 | 11752 | 1,0,2,0,0 | 16.00 | 0.73–4.23 | 45.5–66.5 | 185–488 |

   That task's own conclusion, cited verbatim in substance: actual ≤ 48 ⇒ 6/6 complete rounds, `oom_kill=0`,
   `swap peak=0`, `PSI full=0` ⇒ **16 GiB holds**; actual = 64 ⇒ the peak hits the cap every time, swap
   0.73–4.23 GiB, PSI full 45–78 %, `oom_kill` in 2 of 5 rows ⇒ **not viable at 16 GiB**; and no 20/24 GiB
   rows are needed because the conditional ("only if no setting is viable") is not met. Its AC2 counterpart:
   ac341's single-file peak was reduced 1834 MB → 338 MB, and isolating the heavy set left `oom_kill` at
   1/0 → 3/1, i.e. **the hypothesis was REFUTED** and the correct lever is concurrency, not file isolation.

**The clause that is NOT met: "live anchor, official dist".** The live anchor on this host does **not** run
the official dist — it runs the source tree, and this round did not swap it:

```
$ python3 -m json.tool < /data/home/yale/work/quay/.quay/anchor.json
  pid 2693631, startedAt 2026-10-16T18:01:49.508Z, kinds [promotion, worker, goal, outer, meta, quality]
  bundle.kernel = /data/home/yale/work/quay/plugin/scripts/driver-anchor.ts      <- SOURCE tree, not the artifact
```

The counts that make the swap not a trade worth taking this round (the recorded practice for exactly this
situation, `no-prod-serve-restart-while-peer-workers-inflight`, is to paste the readings that DO justify the
property **plus** the count that made the restart not worth it, rather than silently skipping the clause):

```
this session's own process ancestry:  bash(me) -> claude -> MainThread(pid=2693631) -> systemd
                                      i.e. THIS WORKER SESSION IS A DIRECT CHILD OF THE ANCHOR IT WOULD KILL
in-flight peer work on this host:     3 quay-task-worker   ; 2 live `bash scripts/test.sh` peer suites ; load 44.63
takeover semantics (driver-anchor.ts:435-482): the new anchor WAITS for the old to exit; the old drains with
                                       `QUAY_ANCHOR_SHUTDOWN_GRACE_MS` (default 120000) — so this is a real
                                       production restart of the driver hosting every in-flight worker here
```

`CLAUDE.md` grants standing driver-lifecycle authority (start/stop/restart) to the **manager** for this
project during this phase, not to a per-task worker; and the operation is hard to reverse and outward-facing
in effect while peers are mid-flight. **AC3 is therefore left UNCHECKED**: §3.1–§3.4 above are real readings
that bear on the property, but they are not the same thing as the dist being the live kernel, and this round
will not claim otherwise.

### §4 — AC4: NOT ATTEMPTED (needs a human authorization this session does not hold)

ClaudeCodeUI is a **separate project**, and AC4 asks for the same deployment there "via the established
takeover handoff". Its live state, read this round:

```
$ python3 -m json.tool < /data/home/yale/work/claudecodeui/.quay/anchor.json
  pid 1376399, startedAt 2026-10-14T12:04:08.256Z, alive 2-00:28:59, kinds [promotion, outer, goal, worker, quality]
  bundle.kernel = /data/home/yale/work/quay-scratch/official-dist-020-dev-r6-restart/scripts/dist/driver-anchor.js
                  (builtAt 2026-10-14T08:01:50Z)          <- a scratch dist build, NOT this task's artifact
  takeover: null ; .quay/anchor-takeover.json ABSENT (last handoff clean)
$ readlink -f /data/home/yale/work/claudecodeui/.quay/plugin
  /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0       <- user-scope cache, untouched by this round
$ md5sum /data/home/yale/work/claudecodeui/.quay/config.yml
  e67e7e25082b0a41e5836f61c8bde7cd                             <- unchanged (this task never wrote it)
ClaudeCodeUI is LIVE and mid-flight: 2 claudecodeui-task-worker pids, 4 worktrees;
  .quay/quality-round.jsonl last write 20:39:07, .quay/worker-outcome.jsonl 20:30:33
  its own anchor's most recent quality round: {"round":3670,"ts":"2026-10-16T12:32:41.990Z","halted":false, …}
    architecture-review => verified | not-triggered (no candidate clusters)
```

Its live rounds also expose why the deployment matters — the completeness/telemetry dimensions are simply
**absent** from what that host's current kernel produces:

```
{"round":1181,"state":"green","plannedFiles":null,"terminalFiles":null,"completeness":null,
 "oomKill":null,"telemetry":null,"pass":566,"fail":0,"tests":566,"laneCount":127}
{"round":1182,"state":"green","plannedFiles":null,"terminalFiles":null,"completeness":null,
 "oomKill":null,"telemetry":null,"pass":567,"fail":0,"tests":567,"laneCount":128}
```

The deployment itself was **not performed**. The sibling task of exactly this shape
(`gap-quay-architecture-analysis-shipped-capability-cleanroom-acceptance`) attempted it across three rounds,
recorded that it is "an authorisation/authoring gap, not a verification gap, and no further worker round can
close it", and closed it only in round 4 under an explicit, recorded human authorization. This round holds
no such authorization and does not manufacture one. **AC4 left UNCHECKED.**

### §5 — AC5 PASS

```
$ cd <worktree> && git merge --no-edit develop
Updating fa6cafc3b..6bd552070   Fast-forward   .quay/routine-findings.jsonl | 2 ++
$ bash <worktree>/scripts/test.sh --for-task gap-official-dist-delivery-acceptance-resource-optimization-quay-ccui-clean-host --allow-thin
... PASS — every concurrency literal is at a QUAY_MAX_* definition point or a declared fallback (0 violations)
scripts/test.sh: --for-task … — selector selected 0 test files (thin allowed); nothing to run, full suite still runs at fan-in
SCOPED_GATE_EXIT=0
```

Anti-drift (the driver's own pre-merge gate):

```
$ node --no-warnings --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts \
    --task gap-official-dist-delivery-acceptance-resource-optimization-quay-ccui-clean-host \
    --worktree <worktree> --merge-target develop
ANTI-DRIFT OK: … 0 actual file(s), all within declared Touches (2 glob(s))          exit 0
```

This task's branch carries **zero** commits of its own — it is an integration acceptance, it changes no
component code, and the only files it writes are evidence under `/data/home/yale/work/quay-scratch/`. **AC5
satisfied.**

### §6 — budget / scope kept

No budget ceiling was raised or bypassed on any host: `QUAY_SUITE_MEMORY_MAX` / `QUAY_TEST_SYSTEMD_RUN_LIMITS`
/ `QUAY_TEST_SUITE_SILENCE_MS` were set **only** as per-invocation environment on the clean-room host and on
this round's own scratch-state rounds; no `.quay/config.yml` on any host was written by this task
(`/data/home/yale/work/quay/.quay/config.yml` and `/data/home/yale/work/claudecodeui/.quay/config.yml`
untouched). No global user-scope plugin installation was modified (`~/.claude/plugins/cache/quay/quay/`
highest entry still `0.19.0`). ClaudeCodeUI was **not modified in any way**. The only shared-state side
effect is one new LOCAL branch, `dist-plugin-resopt-accept` (the artifact), **not pushed** and the shared
`dist-plugin` branch **not moved**; the build's throwaway worktree was removed on exit, and the round's
evidence ledgers were written to scratch state dirs rather than the live `.quay/`.

### §7 — the one decision a human needs to make (PARKED)

AC3 and AC4 both reduce to a single question this worker cannot answer: **authorise the freshly built
official dist as the live anchor kernel on `/data/home/yale/work/claudecodeui`** (and, if wanted, on this
project's own anchor), or state that the acceptance is satisfied by the mechanism-level verification in
§1–§3 without a live production swap. Until that is answered, AC3/AC4 stay unchecked and any further worker
round re-derives exactly the same blocking condition — this is an authorization gap, not a verification gap.

**PARKED** (worker-recorded escalation, 2026-10-16 — execution suspended pending the human ruling above).
Unpark condition: a recorded authorization naming (i) which host's anchor may be replaced, (ii) which
artifact is the authorised kernel, and (iii) the acceptable window; on receipt, AC3/AC4 are mechanical
(§3 and §4 already carry the baseline readings, the artifact identity and the rollback target).

## Blocker

**2026-10-16T12:54:41.916Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 0/5，剩余未勾 5）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：1d20abbe-d589-4e94-90d3-485a77d1c942
