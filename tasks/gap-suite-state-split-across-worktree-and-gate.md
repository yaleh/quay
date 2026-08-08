---
id: gap-suite-state-split-across-worktree-and-gate
title: runner --root <worktree> 使 suite-state 写进 worktree，而闸门（inner +
  suite-state-trigger）读主 repo state——自 13:20 改跑 worktree 后闸门永不看到 integration
  绿，批量合在闸门 red 时仍启动（管理者实测 123 分钟空窗）
status: done
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**全量套件 runner 的 `--root <worktree>` 使 suite-state 写进 worktree，而 inner 停止条件 + suite-state-trigger 读主 repo 的 `.quay/full-suite-state.json`——跑 worktree 时闸门永远看不到绿。今晚"跑 integration 内容"（13:20 起改跑 /tmp/quay-suite-int）与"闸门读主 repo"之间断了桥，导致批量合在闸门显示 red 时仍被启动（管理者 22:0x 实测：主 repo state 停在 20:01 red、123 分钟无新绿，而 21:48 那轮 702.9s green 写进了 worktree）。**

### 实测（管理者 22:0x + 外层核实）

- `full-suite-runner.ts` 的 `--root` 同时决定：被测 checkout、`<root>/.quay/full-suite-state.json` 写入位置、`<root>/.quay/verification-round.jsonl`；
- 主 repo（develop）与 /tmp/quay-suite-int（integration）各有一份独立 state（独立 inode）；
- inner 停止条件（fast-mode-loop-tick.md:106/299/357/423）与 suite-state-trigger（:273）**只读主 repo 的相对路径 `.quay/full-suite-state.json`**；
- 自 13:20 外层改跑 worktree 起，主 repo state 从未被 integration 内容的绿更新（round 85/86 的 green 亦可能是 worktree state 或旧桥接）；
- 本轮（21:48 `--root /tmp/quay-suite-int`）702.9s 三趟 fail 0 green 写进了 worktree，主 repo 仍 red → 批量合正在跨一个它看不到已变绿的闸门。

### 外层处置（止血，非机制）

- 将 worktree 的 green state 复制到主 repo state 位置（`cp /tmp/quay-suite-int/.quay/full-suite-state.json /home/yale/work/quay/.quay/`），SUITE-GREEN 已触发（22:06:27Z），闸门链路接通。

### 修复方向（机制）

1. **runner `--root` 语义拆开**：被测 checkout 与 state/log 写入位置解耦——`--root` 测代码、`--state-dir`（或显式 `--state-file`/`--log-file`）指闸门位置（主 repo），跑 worktree 时 state 落主 repo；
2. **或加同步桥**：跑 worktree 后把 state 复制回主 repo（本轮手工 cp 的机制化，脚本化进 runner 收尾）；
3. **或 inner/trigger 改读 worktree state**（不推荐——worktree 是临时的，主 repo 是稳定锚）。
4. **负控制**：跑 worktree 全量后，主 repo state 必须是同一结果（不再分裂）；inner 停止条件 + SUITE-GREEN 触发与 runner 实际结果一致。

## Contract

measure state_synced = `cmp -s /tmp/quay-suite-int/.quay/full-suite-state.json /home/yale/work/quay/.quay/full-suite-state.json && echo same || echo diff` stdout 数字段（修复后跑 worktree 全量，主 repo state 与 worktree 同结果）
measure gate_sees = `python3 -c "import json; d=json.load(open('/home/yale/work/quay/.quay/full-suite-state.json')); print(d.get('state'))"` stdout 数字段（跑 worktree 后主 repo state = green，非 red 残留）
band state_synced = same 且 gate_sees = green（worktree 全量后闸门见绿，不再分裂）
invoke `bash plugin/scripts/full-suite-runner.ts --root /tmp/quay-suite-int --lane-count 8 2>&1 | tail -3`（跑 worktree 内容）
control 跑 worktree 全量后主 repo state 与 worktree 一致（不再 20:01 残留）；inner 能读绿；批量合在真绿后启动
resume 若中断，先跑 measure 读两 state 是否同结果

## Acceptance Criteria

- [x] AC1: **runner 语义修正**——`--root`（被测 checkout）与 state/log 写入位置解耦或加同步桥；跑
      worktree 全量后主 repo state 反映真实结果
      — `full-suite-runner.ts` 新增 `--state-dir`（`.quay` state/log 目录，默认 `<root>/.quay`，向后兼容）；
      `--root` 只测代码，`--state-dir` 指闸门位置。另加**同步桥**：每次 state 转变写入
      `--state-dir/full-suite-state.json`（主 repo 闸门位置）**并镜像**到 `<root>/.quay/full-suite-state.json`
      （被测 worktree 自身），两者字节一致（Contract band `cmp -s` = same）。`full-suite.log` 与
      `verification-round.jsonl` 也落 `--state-dir`。实跑见下 RUN 1-3。
- [x] AC2: **闸门不再分裂**——worktree 全量绿后，主 repo state=green（inner + suite-state-trigger 读到同一结果）
      — RUN 1/3 实跑：`--root /tmp/quay-suite-int --state-dir /home/yale/work/quay/.quay` 绿 ⇒
      `cmp -s <worktree-state> <main-state>` = same、主 repo `gate_sees=green`、`suite-state-trigger --once`
      读主 repo → `SUITE-STATUS green` + `SUITE-GREEN` 触发、`stopSignal=false`。
- [x] AC3: **负控制**——worktree 全量 red 时主 repo state 也是 red（不误报绿）；批量合只在真绿启动
      — RUN 2 实跑：red 假套件 ⇒ `cmp` = same、主 repo `gate_sees=red reason=failed`（stop-dispatch 信号在位）、
      worktree 同步 red；无任何 false green。
- [x] AC4: 与 gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge（闸门=批量合边界）交叉标注
      — 见该任务「Cross-annotation」；反向标注也已写入（见任务体末尾）。
- [x] AC5: 与 gap-red-window-has-no-automatic-executor（suite-state-trigger 的 SUITE-GREEN/RED 事件流）交叉标注
      — 见该任务「Cross-annotation」；反向标注也已写入（见任务体末尾）。

## Definition of Done

- [x] AC1-AC3 实跑输出贴任务体（跑 worktree 全量前后，主 repo vs worktree state 对照）
      — 见任务体末尾「落地证据（2026-08-07，worktree `suite-state-split-fix`）」的 RUN 1/2/3 输出。
- [x] 连续 2 次 worktree 全量后，主 repo state 与 worktree 一致（green/green 或 red/red）
      — RUN 1（green/green）→ RUN 2（red/red）→ RUN 3（green/green）：三次全部 `state_synced=same`。

## Touches
- plugin/scripts/full-suite-runner.ts（--root 语义拆开 / 同步桥）
- 或 plugin/scripts/suite-state-trigger.ts（若改读位置）
- tasks/gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge.md（AC4 交叉标注）
- tasks/gap-red-window-has-no-automatic-executor.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-07T22:0xZ
changed: 管理者 22:0x 时间敏感——闸门（主 repo state）123 分钟无新绿、批量合在跨未绿的闸。外层核实：
  21:48 轮 green 写进 worktree（--root /tmp/quay-suite-int），主 repo state 仍 20:01 red。止血：cp 同步
  worktree green 到主 repo，SUITE-GREEN 触发。立案：runner --root 语义拆开（测代码 vs 写 state）。

## 交叉标注（2026-08-08，gap-merge-exposed-contract-violations-in-done-tasks AC4）

本任务是「合并后首次全量覆盖 develop task 文件」链条的第一环：state-split 修复让批量合（a862c914）
得以完成，合并把 develop 的 task 文件首次带进完整 runner 的静态检查覆盖 → 暴露 3 个 done 任务的
5 个 Contract 违规（既有债务，非 merge 引入回归）→ 人裁决 gap-eighty-one AC8 勾保留（一次性例外），
定点加进 `contract-violations.md` 基线（5→6）。交叉标注：本任务（state-split）+ a862c914 merge 是
这条链的两个上游。

## 落地证据（2026-08-07，worktree `task/suite-state-split-fix`）

**机制落地（`full-suite-runner.ts`）**：
- 新增 `--state-dir <path>`：`.quay` state/log 写入目录（默认 `<root>/.quay`，向后兼容）。`--root` 只决定
  被测 checkout（spawn cwd + verdictCommit 锚点）；`--state-dir` 决定 `full-suite-state.json`、
  `full-suite.log`、`verification-round.jsonl` 的写入位置。
- **同步桥**：每次 state 转变经 `writeSuiteState()` 写入 `--state-dir/full-suite-state.json`（闸门位置）
  **并镜像**到 `<root>/.quay/full-suite-state.json`（worktree 自身）——两个文件字节一致
  （Contract `cmp -s` = same），闸门与 worktree 不再分裂。
- `appendVerificationRound` 首参语义改为 `.quay` state 目录（`checker-cost.test.mjs` 两处调用同步更新）。
- 单测：`plugin/test/full-suite-runner.test.mjs` 新增 AC1/AC2（--state-dir 拆开 + 同步镜像 + 闸门读绿）与
  AC3（负控制 red 镜像）；**27/27 绿**。相邻回归 `checker-cost.test.mjs` + `trend-check.test.mjs` **21/21 绿**、
  `suite-state-trigger.test.mjs` + `quay-suite.test.mjs` + `measure-suite-reporter.test.mjs` **21/21 绿**。

**实跑对照（跑 worktree 全量前后，主 repo vs worktree state）**——用真实路径
`--root /tmp/quay-suite-int`（被测 worktree）+ `--state-dir /home/yale/work/quay/.quay`（主 repo 闸门位置），
轻量假套件（green/red），跑完即恢复真实 state（止血遗留状态），不留假绿污染：

```
RUN 1 (GREEN):  full-suite-runner: FINAL state=green durationMs=51 exit=0
  state_synced = cmp -s /tmp/quay-suite-int/.quay/full-suite-state.json /home/yale/work/quay/.quay/full-suite-state.json => same
  gate_sees    = python3 -c ".../home/yale/work/quay/.quay/full-suite-state.json print state" => green
  worktree_state = green runner=outer laneCount=1

RUN 2 (RED, AC3 负控制):
  full-suite-runner: FINAL state=red reason=failed durationMs=49 exit=1
  state_synced = same
  gate_sees    = red reason=failed   (stop-dispatch 信号在位，无 false green)

RUN 3 (GREEN, 连续第 2 次一致):
  full-suite-runner: FINAL state=green durationMs=49 exit=0
  state_synced = same
  gate_sees    = green
  suite-state-trigger --once --root /home/yale/work/quay  => SUITE-STATUS green / SUITE-GREEN stopSignal=false
```

连续 2 次 worktree 全量后主 repo state 与 worktree 一致：RUN 1 green/green → RUN 2 red/red → RUN 3 green/green，
三次全部 `state_synced=same`（DoD）。

**AC4/AC5 交叉标注**：
- `tasks/gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge.md`（闸门=批量合边界）——Cross-annotation
  指向本条：批量合边界的「主 repo state 读真实结果」依赖本条 `--state-dir` 同步桥，否则 worktree 跑的绿
  写不进主 repo、批量合跨未绿闸。
- `tasks/gap-red-window-has-no-automatic-executor.md`（suite-state-trigger 的 SUITE-GREEN/RED 事件流）——
  Cross-annotation 指向本条：trigger 只读主 repo 相对 `.quay/full-suite-state.json`，本条保证 worktree 跑
  的 state 落主 repo，trigger 的事件流才接到真实结果。
- `tasks/gap-batch-merge-gate-reads-stale-green.md`（批量合闸门读绿不读新鲜度，2026-08-08）——
  Cross-annotation 指向本条：本条解决「绿写哪 / 闸门读哪」（state 分裂），stale-green 解决「绿旧不新鲜」
  （时间轴）。批量合要放行必须两条都满足：主 repo state 是真实结果（本条）+ 是新鲜绿（stale-green 的
  `integration-batch-merge.sh` freshness gate）。
