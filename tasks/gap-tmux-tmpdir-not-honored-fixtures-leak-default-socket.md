---
id: gap-tmux-tmpdir-not-honored-fixtures-leak-default-socket
title: TMUX_TMPDIR 本机不认 → factory 脚本/fixture 测试落默认 socket 撞生产（7 孤儿 server 实测，推翻
  leak 任务「never touches default socket」）
status: superseded
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---

**type:** execution

## Superseded（2026-08-24，AC1 负控制证伪前提）

本任务前提「TMUX_TMPDIR 本机不认 + factory 脚本落默认 socket 撞生产」被 worker AC1 负控制证伪（外层独立
复现确认）：`env -u TMUX TMUX_TMPDIR=<dir> tmux new-session`（无 -S）落 `<dir>/tmux-1000/default`
（TMUX_TMPDIR 在 $TMUX 剥离时被认）；「无 -S」孤儿实为私有 socket（/tmp/quay-init-tmux-* 等，ss -xlp 映射）。
重定范围至 [[gap-tmux-stale-not-honored-comment-private-socket-leak-scan]]。

## Proposal

管理者（2026-08-24 05:3xZ，经 quay-fe 转交）根因分析：tmux server 反复被杀非 OOM/logind/人杀，而是
测试 fixture 泄漏 tmux server 撞生产默认 socket。外层核实核心证据成立：

- **已排除（有证据）**：OOM（`dmesg` 全 `CONSTRAINT_MEMCG`，cgroup 64MB 杀 python3 测试脚本，无全局
  OOM；05:27 实测空闲 9.8GB）、logind（`KillUserProcesses=no`）、人/Claude `kill-server`（全 transcript
  递归 0 次 Bash 执行）。
- **隔离地基失效（已核实）**：`plugin/test/session-topology.test.mjs:150-151` 注释明写「TMUX_TMPDIR is
  NOT honored by tmux on this system … still lands on /tmp/tmux-<uid>/default」——factory 脚本
  （quay-topology.sh）与依赖 TMUX_TMPDIR 做隔离的 tmux 调用都落默认 socket。
- **生产 server 被测试接缝拉起（已核实）**：`pid 217256` 命令行 `tmux new-session -d -s quay-manager
  -n manager bash -c 'exec -a claude-probe sleep 10000 & wait'`（session-bootstrap.sh 测试接缝，非真
  claude 生产拉起）。
- **7 孤儿 server 落默认 socket（已核实 ps）**：`ac1proj-0`×2 / `ac2bproj-0` / `ac3proj-0`×3 /
  `confproj`（测试 fixture 名，无 `-S` 隔离）；另 3 个已带 `-S` 落私有 socket（repro-rm / isc-es×2）。

**与 done 任务的矛盾点**：`gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause`（done）
结论「isolation design is RIGHT（never touches default socket）」仅对 send-keys-verified skv-ok 类成立；
对 factory 脚本/fixture 测试类不成立。`gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe`
（done）修的是「4 个测试文件缺 `env -u TMUX` + `-S`」（机制 = `$TMUX` 覆盖 TMUX_TMPDIR），与本条
**不同机制**（TMUX_TMPDIR 根本不认）**不同类别**（factory 脚本 + fixture 测试，非那 4 个测试文件）。

**持续来源**：在飞 worker `gap-test-fixture-pollutes-bash-history` 反复跑全量套件（含 session-topology /
session-liveness / session-bootstrap 测试），每轮 spawn 新 tmux server。

## Plan

1. 枚举 spawn 真实 tmux 进程却依赖 TMUX_TMPDIR 或裸 `tmux new-session`（无显式 `-S`）做隔离的测试文件
   与 factory 脚本。
2. 统一改显式 `-S` 私有 socket（或走 `tmux-isolated.sh` / `tmux-session.ts` 助手）——本机 TMUX_TMPDIR
   不认，显式 `-S` 是唯一可靠隔离。
3. 套件末尾接机械检查：默认 socket（`/tmp/tmux-<uid>/default`）不得残留 fixture 前缀 tmux server。

## Acceptance Criteria

- [ ] AC1（负控制·承重条）：复现「TMUX_TMPDIR 不认」——设 TMUX_TMPDIR 跑 `tmux new-session`（无 `-S`）
      证明落 `/tmp/tmux-<uid>/default`；若复现不出则本任务方向错误，停报修正。
- [ ] AC2（枚举）：贴 grep 命中的「依赖 TMUX_TMPDIR 或裸 tmux 而缺 `-S`」测试文件/脚本清单。
- [ ] AC3（修复）：清单内全部加显式 `-S` 私有 socket。
- [ ] AC4（读生产载体·硬规则④推论三）：实现落地后一次真实全量套件跑完，默认 socket 上 fixture 前缀
      （`ac*proj-` / `confproj` / `topo-*` / `isc-*`）tmux server 数 = 0（只计实现落地后的时间窗）。

## Definition of Done

修复落地且一次真实全量套件后默认 socket 无 fixture 前缀孤儿 server（AC4 读数 = 0），该判据接线为套件
末尾机械检查（不靠人工 ps 数）。

## Touches

- plugin/scripts/quay-topology.sh（factory 脚本，可能，视 AC2 枚举结果）
- plugin/scripts/session-bootstrap.sh（可能，视 AC2 枚举结果）
- plugin/test/session-topology.test.mjs（可能，视 AC2 枚举结果）
- tasks/gap-tmux-tmpdir-not-honored-fixtures-leak-default-socket.md（自身）
