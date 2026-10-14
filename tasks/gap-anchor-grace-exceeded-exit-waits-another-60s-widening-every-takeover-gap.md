---
id: gap-anchor-grace-exceeded-exit-waits-another-60s-widening-every-takeover-gap
title: anchor 宽限超时「exiting anyway」后又白等 min(60s,grace)：每次接管多出 ~60s 无 driver
  间隙（ClaudeCodeUI 7/7、quay 多数）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14 across every anchor takeover in the two hosts' `.quay/anchor.log`.** The interval between the old anchor's `shutdown grace …ms exceeded … — exiting anyway` and the new anchor's `takeover <pid> exited — taking over` is:
- **ClaudeCodeUI: 7/7 takeovers at 60–61s** (`[61, 61, 60, 60, 60, 61, 61]`), including the human-authorized r5 and r6 swaps of 2026-10-14 (06:31:45 → 06:32:46, 08:04:17 → 08:05:18).
- **quay: last 12 of 79**: `[60, 60, 61, 72, 60, 27, 60, 60, 30, 60, 61, 60]`.

During those ~60s, **no worker loop dispatches or adopts on the host**. The old anchor has stopped its loops, and the new one is blocked in its takeover wait. This is the exact window in which a finishing worker becomes an orphan (2026-10-14 06:32:32Z, `gap-voice-close-trace-row-removed-from-transcript`, booked `failed: orphaned`).

**Cause (`driver-anchor.ts`, end of the anchor body).** When the reconcile loop decides the grace is exhausted (`Date.now() - stopRequestedAt > shutdownGraceMs`), it logs "exiting anyway" and `break`s. The code right after the loop then waits **again** for the same still-draining loops: `const deadline = Date.now() + Math.min(60_000, shutdownGraceMs); while (active.size > 0 && Date.now() < deadline) …`. Those loops have just been declared not-finishing, so on the grace-exceeded path that second wait almost always runs its full 60s. `oldAnchorWorstExitMs(grace) = grace + min(60000, grace)` (`:241`) even budgets for it, so the takeover side has adapted to the delay instead of the delay being removed.

## Plan
1. On the grace-exceeded exit path, skip the post-loop wait. It still matters on the normal stop path, where loops are expected to finish shortly. Keep the cleanup (pid carriers, state file, `exited` log) unchanged.
2. Re-derive `oldAnchorWorstExitMs` / `takeoverBudgetMs` from the new worst case. Do not leave a stale `+ min(60000, grace)` term behind (硬规则 5b: the budget and the wait are the same fact in two places).
3. No change to grace length, to SIGTERM semantics, or to the "in-flight children are not killed" invariant.

## Acceptance Criteria
- [x] AC1: before the fix, a dist scratch host where one kind's loop ignores stop (fixture), plus a takeover via `spawnAnchor({takeoverPid})` + SIGTERM. Paste the measured "exiting anyway" → "takeover … exited" lag (expect ~60s with the default 60s cap, or `min(60000, grace)` with a short `QUAY_ANCHOR_SHUTDOWN_GRACE_MS`). —— **修复前**实测（scratch 夹具根：假 `outer-driver.ts` 无视停机（`FAKE_IGNORE_STOP=1`）+ `QUAY_ANCHOR_SHUTDOWN_GRACE_MS=5000`，旧 anchor 起于 develop 那份 `driver-anchor.ts`（`git rev-parse HEAD`=`b906d6e02…`、worktree 干净、sha256 `5cab7c5c9c88d4ea…`，⛔ 修复未落），`--takeover <oldpid>` + SIGTERM（reconcile 100ms））：① `exiting anyway`(08:48:01) → `anchor: exited (remaining loops=1)`(08:48:06) = **5010ms**；② → 新 anchor 的 `takeover 2991945 exited — taking over`(08:48:06) = **5113ms**；③ SIGTERM→接管 = **10222ms**。该 5010ms 逐字等于 `min(60000, 5000)` ⇒ cap 项成立；**生产宽限 120s ⇒ 同一项是 60000ms**，正是任务体那两批日志读数（ClaudeCodeUI 7/7 的 60–61s）。**可复现配方（不依赖任何 tmp 脚本）**：`git stash`/回退源码到修复前，跑 `node --test --test-name-pattern 'AC2①' plugin/test/driver-anchor-takeover.test.mjs` —— 同款夹具（宽限 2000ms）对修复前源码实测「宽限之外多等 **2071ms**」并红（见 AC3 的负控制）。
- [x] AC2: after the fix, same harness: lag ≤ one reconcile tick plus cleanup, i.e. a few seconds (pasted). The normal (non-grace-exceeded) stop path still waits for loops that do finish (fixture pasted). —— **修复后**同一夹具、同一宽限 5000ms：① `exiting anyway` → `exited (remaining loops=1)` = **8ms**、② → `takeover 3360077 exited — taking over` = **61ms**（reconcile tick = 100ms ⇒ ≤ 一个 tick + 清理）、③ SIGTERM→接管 = **5073ms**（修复前 10222ms，恰好少掉那 5000ms）。测试内直接量（宽限 2000ms，`AC2①` 的 `t.diagnostic`）: SIGTERM→exit = **2045–2050ms**，**宽限之外只多 45–50ms**。**正常路径对照**（`AC2②`：`FAKE_STOP_LINGER_MS=600`、宽限 5000ms）：SIGTERM→exit = **798–847ms**（≥ 收尾 600ms），日志行序 `kind=outer loop stopped` → `anchor: exited (remaining loops=0)`，⛔ 无 `grace … exceeded` ⇒ 仍**等循环收尾**再退（另一读数：独立 scratch 夹具 768ms，日志同序）。
- [x] AC3: `oldAnchorWorstExitMs` and its test reflect the new bound; the takeover still succeeds on the fixture (pasted). —— `oldAnchorWorstExitMs(grace) === grace`（`+ min(60000, grace)` 项随第二段等待一起下线）；`takeoverBudgetMs = 宽限 + 察觉 tick + 20000`（测试断言 reconcileMs=100 ⇒ 120100+20000=**140100**；生产 reconcile 500ms ⇒ **140500**，旧式是 200500）。测试 `AC3 (D2 派生)` 绿；**负控制**：把该惩罚项加回（= 对修复前源码跑同一文件）⇒ `AssertionError: 最坏退出 = 宽限本身（…；grace=1000）` 红。接管仍成功：`AC3①` 绿（`takeover … exited — taking over`、⛔ 无 `REFUSING to start`、⛔ 无 `STILL ALIVE after`，旧 anchor 实测 drain 1266–1417ms 才退）+ 上面修复后 5073ms 的那次真实接管。
- [x] AC4: `scripts/test.sh --for-task <this task>` green. —— `bash scripts/test.sh --for-task gap-anchor-grace-exceeded-exit-waits-another-60s-widening-every-takeover-gap --allow-thin`（工作树内、已 `git merge develop`）⇒ **exit 0**；scoped 静态档全 PASS / NOT-EVALUATED（含 `no checked-in-tree writes`、Touches 单路径、SSoT/并发字面量/测试隔离等），测试档 `ℹ tests 14 / pass 14 / fail 0`（含本任务改的 `driver-anchor-takeover.test.mjs` 10 例 + `driver-anchor.test.mjs` 4 例）。

## Definition of Done
- AC1-AC4 checked with pasted evidence; in-flight children still survive the old anchor's exit. —— 见 AC1–AC4。「在飞子进程」半边是**直接量两条**：① `AC2①` 夹具里假 driver 另起一个真 OS 进程（`detached node -e 'setTimeout(…,60000)'`，pid 落 `.quay/fake-child.pid`），旧 anchor 从宽限超时那条路退出后断言**该 pid 仍活着**（⛔ 不读日志里那行「NOT killed」——它在修复前后逐字相同，证明不了早退没碰这条不变量）；② 结构性事实：`driver-anchor.ts` 全文**没有任何 kill 子进程的码路**（`grep -nE '\.kill\(|process\.kill' plugin/scripts/driver-anchor.ts` 零命中，唯二相关行是注释里的 `kill -0` 与 `process.on("SIGTERM", requestAnchorStop)`）⇒ 早退在结构上不可能杀掉它们。宽限长度、SIGTERM 语义、收尾清理（pid 载体 / state 文件 / `exited` 日志）逐字未动。

## Touches
- tasks/gap-anchor-grace-exceeded-exit-waits-another-60s-widening-every-takeover-gap.md
- plugin/scripts/driver-anchor.ts
- plugin/test/driver-anchor-takeover.test.mjs
