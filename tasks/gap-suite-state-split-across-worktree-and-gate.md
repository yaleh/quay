---
id: gap-suite-state-split-across-worktree-and-gate
title: runner --root <worktree> 使 suite-state 写进 worktree，而闸门（inner +
  suite-state-trigger）读主 repo state——自 13:20 改跑 worktree 后闸门永不看到 integration
  绿，批量合在闸门 red 时仍启动（管理者实测 123 分钟空窗）
status: ready
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

- [ ] AC1: **runner 语义修正**——`--root`（被测 checkout）与 state/log 写入位置解耦或加同步桥；跑
      worktree 全量后主 repo state 反映真实结果
- [ ] AC2: **闸门不再分裂**——worktree 全量绿后，主 repo state=green（inner + suite-state-trigger 读到同一结果）
- [ ] AC3: **负控制**——worktree 全量 red 时主 repo state 也是 red（不误报绿）；批量合只在真绿启动
- [ ] AC4: 与 gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge（闸门=批量合边界）交叉标注
- [ ] AC5: 与 gap-red-window-has-no-automatic-executor（suite-state-trigger 的 SUITE-GREEN/RED 事件流）交叉标注

## Definition of Done

- [ ] AC1-AC3 实跑输出贴任务体（跑 worktree 全量前后，主 repo vs worktree state 对照）
- [ ] 连续 2 次 worktree 全量后，主 repo state 与 worktree 一致（green/green 或 red/red）

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
