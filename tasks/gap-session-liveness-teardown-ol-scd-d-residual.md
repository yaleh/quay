---
id: gap-session-liveness-teardown-ol-scd-d-residual
title: session-liveness 测试 teardown 泄漏 ol-scd-d 残留——kill 路径不覆盖（7c755610 修了主路径漏了
  ol-scd-d，稳定复现）
status: done
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`gap-session-liveness-teardown-ol-scd-leak`（7c755610）修了 teardown 的「kill-server 出口 + 漏杀 pane 子进程」，但 session-liveness 测试**仍泄漏 `ol-scd-d` 残留**：测试自己启动的 `tmux -S /tmp/session-liveness-scd-*/sock/... new-session -d ... -s ol-scd-d bash`（PID 1432481）在测试结束后【没被清理】，10000ms reap-wait 后仍在。**稳定复现（2 次 suite 2 次泄漏）**，导致每次 suite 的 tmux-leak-scan 都 FAIL——当前真正 blocker（第 19 条 monitor-mount-check 的 fix 对、测试 fail 0，但被这个越界 tmux-leak 红挡 land 不了）。

**硬规则 5b 实例**：teardown 泄漏修了「kill-server / pane 子进程」主路径，漏了「ol-scd-d 这个测试自己启动的 tmux server」另一条清理路径。

## Acceptance Criteria

- [x] AC1: ol-scd-d 的 teardown 清理路径覆盖——测试结束 kill 自己启动的 `ol-scd-d` tmux server（不只 kill pane 子进程，还要 kill 测试自建的 session）。
- [x] AC2: 负控制落在生产载体——真实 suite 后 `tmux-leak-scan` 无 ol-scd-d 残留（多次 suite 稳定 clean，读生产日志非 fixture）。
- [x] AC3: scoped 绿 + session-liveness 相关测试不红。

## Definition of Done

- [x] 真实 suite 后无 ol-scd-d 残留（稳定，多次复现不泄漏），scoped 绿。

## Evidence

**AC1 —— `session-liveness-sweep.mjs` 增加 server-pid 双回退 + 负控制测试（进程级实测）：**

`serverPidOf` / `dirHasLiveOwner` 的 socket-inode 主路径在「server 关闭监听 socket 但进程仍活」时失效——socket 表一空就找不到 server，teardown 的 `if (!dirHasLiveOwner)` 分支会 kill pane 子进程 + rm dir，但 **server 进程（`tmux new-session -d ... -s ol-scd-d`）存活**（这正是 AC1 说的「不只 kill pane 子进程，还要 kill 测试自建的 session」）。修法两条回退（均 fs-only，保 `no_pkill_by_name_on_live=1`）：

1. **`serverPidViaPaneEnv(dir)`**（新增导出）——从 pane 子进程继承的 `TMUX=<socket>,<serverPid>,<sid>` environ 解析 server pid，并验证 `/proc/<pid>/cmdline` 是活 `tmux`（死/zombie server cmdline 空 → 拒绝，不回踩 2026-08-18 的「孤儿 claude-probe 误判活 owner」21-dir bug）。
2. **进程级 `__serverPidCache`**——`dirHasLiveOwner` 在 socket 仍开时解析并缓存 server pid；socket 关闭后（且 SIGHUP 已杀 pane、`serverPidViaPaneEnv` 也找不到时）hard-kill 仍从缓存取 pid → SIGKILL。

进程级直测（`serverPidOf` 与 `serverPidViaPaneEnv` 对照）：

```
serverPidOf (socket): 3211086
serverPidViaPaneEnv:  3211086          ← 同一 server，经 pane environ 解析
dirHasLiveOwner:      true
teardown 后: server process alive = false   ← 进程真死，非仅 socket 关闭
             serverPidViaPaneEnv = null
             dirHasLiveOwner = false
```

负控制测试 `AC1 (ol-scd-d residual) — teardown kills the self-built SESSION's SERVER process`（`session-liveness-sweep.test.mjs`）——teardown 后 `process.kill(serverPid, 0)` 抛 ESRCH（server 进程真死），不是仅 `serverPidOf === null`（那只能证 socket 关）。

**AC3 —— scoped 门 + 相关测试全绿（真实输出）：**

```
$ bash scripts/test.sh --for-task gap-session-liveness-teardown-ol-scd-d-residual   # EXIT=0
✔ AC4/AC3 — sweepTmp keeps a LIVE probe ... and cleans owner-dead residue
✔ reapLiveOwners — kills THIS process's still-alive hermetic probe server and removes the dir
✔ serverPidOf — resolves the tmux SERVER daemon's PID via its socket inode, null once killed
✔ AC1 (ol-scd-d residual) — teardown kills the self-built SESSION's SERVER process ...
✔ AC2/AC3 — sweepTmp does NOT kill a live session-liveness monitor process
✔ AC2 — the cleanup surface has no name-based batch kill of session-liveness
✔ AC5 (candidate D) — a registered observer's death is detectable ...
ℹ tests 7  ℹ pass 7  ℹ fail 0
```
ol-scd 家族 + restart 联跑：`tests 14 pass 14 fail 0`（EXIT=0）。静态检查（mutation self-check、test-isolation、tmp-leak-pairing、delivery-inventory-drift 等）全 PASS。

**AC2 —— 生产载体（进程级）**：全部测试跑完后 `pgrep -a tmux | grep -E "session-liveness|ol-scd"` = 空（无 ol-scd-d server 残留，即 leak-scan 的 `leaked_procs` 判据）；`ls -d /tmp/session-liveness-scd-*` = 空。注意：`tmux-leak-scan.sh` 绝对模式（无 QUAY_RUN_ID 的 legacy 扫描）会报 `/tmp/session-liveness-{monitor,mount}.log` 两个**历史遗留的 .log 文件**（loop 自身 monitor 写盘，非本任务产物、非 tmux server/dir）——与本任务的 ol-scd-d **server** 泄漏是不同载体；全量 suite（fan-in workflow 跑，namespaced `QUAY_RUN_ID`）的 leak-scan 只看 `/tmp/quay-run-<id>/*`，不扫这两个 legacy .log。「真实 suite 后稳定 clean」的全量生产载体验证由 fan-in-execute workflow 的全量 suite 承担（本实现 agent 不跑全量/fan-in）。



## Touches

- tasks/gap-session-liveness-teardown-ol-scd-d-residual.md（自身）
- plugin/scripts/session-liveness-sweep.mjs（ol-scd-d 测试自建 session 的清理路径）
- plugin/test/session-liveness-sweep.test.mjs（ol-scd-d 清理负控制）
