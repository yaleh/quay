---
id: gap-cross-project-replay-verify-goal-timeout-and-anti-drift-fixes-on-claudecodeui-and-quay-fleet
title: "cross-project proof of two 0.20.0-dev fixes (goal 120s SIGKILL,
  anti-drift pre-exit) on claudecodeui + quay-fleet: private build,
  scratch-clone replay with 0.19.0 negative control, production trial plan
  (human-approved)"
status: ready
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
- [ ] AC1: the private 0.20.0-dev build exists. Paste its path, version, source sha, and a `grep` showing `goalDriverChildTimeoutMs` and `antiDriftPreExitNote` in its dist; the 0.19.0 cache dist shows neither (negative control).
- [ ] AC2: the goal-timeout replay on ≥1 real claudecodeui criterion and ≥1 real quay-fleet activation. Paste per run:
  - kernel, criterion id, declared `timeoutMs` and wall;
  - verdict or spawn error;
  - `ls goals/*.lock` afterwards.
  Expected: 0.19.0 ⇒ SIGKILL + leftover lock; 0.20.0-dev ⇒ own verdict, no lock. A run where 0.19.0 does NOT reproduce the kill is pasted, not dropped.
- [ ] AC3: the anti-drift replay on ≥3 historical claudecodeui bounces (and ≥1 quay-fleet bounce if one is reachable). Paste the embedded argv, its exit code and the named files beside the fan-in log's rejected files.
- [ ] AC4: the production trial plan is written into this task's Evidence (kernel selection, restart semantics for in-flight workers, worker-session/init requirement, resource estimate, rollback, metrics, window) and names the exact human approval needed.
- [ ] AC5 human-approved production trial on one host: ≥3 days of the per-day metrics before and after are pasted, from that host's carriers only（待外部）

## Definition of Done
- AC1–AC4 checked with pasted readings. No host `.quay/`, task, anchor or user-scope plugin was modified (paste each host's `git status --porcelain .quay tasks` and anchor pid before and after).
- Scratch clones and the private build are listed with their paths; nothing is left in host checkouts.

## Touches
- tasks/gap-cross-project-replay-verify-goal-timeout-and-anti-drift-fixes-on-claudecodeui-and-quay-fleet.md
