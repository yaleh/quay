---
id: gap-no-explicit-blocked-signal-from-inner-layer
title: "The inner layer stops and waits with no way to say so — the outer can
  only infer it from an absence"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

内层停下等裁定是**设计内的**——它是外层存在的理由（`orchestration/orchestrator-loop-tick.md` 定位段）。
但内层**没有任何办法说出「我停下了、在等什么」**。外层只能从两种间接迹象猜：

1. **读 TUI**：`tmux capture-pane` 比对两次 md5 看屏幕是否在变。ADR-016 已明确判定读屏是权宜手段
   （「never parse the TUI」），且它不可产品化
2. **遥测的空集**：`fast-mode-telemetry --report` 的 `inProgress` 为空。**这是一个从缺席推断存在的
   信号，会错**——2026-08-02 实测：内层正在做 M243 抢救（合并、诊断、跑测试），而 `inProgress`
   为空，因为抢救类工作跑在 `--task-start`/`--task-end` 括号之外。此时内层在忙，信号显示 IDLE

后果是**死时间不可测也不可压**。当前唯一的兜底是 20 分钟 tick，而 tick 由 cron 触发、cron 只在
外层会话空闲时 fire——外层和人对话期间根本不触发。内层实际等了多久，**我们没有任何数据**。

## Chosen mechanism

**内层在停下时写一个结构化的阻塞记录；外层 Monitor 该文件。**

1. **`.quay/inner-blocked.json`**（gitignored，与 `gate-events.jsonl` 同类）：

   ```json
   {"since": 1785700000000, "taskId": "…", "reason": "ruling-required",
    "question": "M243 冲突按 A 还是 B", "options": ["A: …", "B: …"],
    "evidence": ["20 tests / 6 pass / 14 fail", "tampered 负控制也失败"]}
   ```

   `reason` 取自内层已有的停摆条件：`merge-conflict` / `suite-red` / `review-refuted` /
   `task-over-90m` / `needs-human-backlog` / `ruling-required` / `queue-empty`。

2. **写在停下的那一刻，删在恢复的那一刻。** 文件存在 == 内层在等。这是**存在性信号**，
   不是从缺席推断。

3. **外层 Monitor 用 `inotifywait` 监视该路径**，延迟从最多 20 分钟降到秒级。事件里直接带上
   `question` 与 `evidence`，外层不必再读屏就能开始判断。

4. **顺带得到死时间计量**：`since` 到文件被删的时间差就是这一次的等待时长。累计写进遥测，
   **这个数当前完全没有**。

### 为什么这条同时是阶段 2 的交付物

`orchestration/exp6-phase1-sustained-unattended-operation.md` §D 记着：双层机制要随 quay 产品交付，
而其中**层间通信（读 TUI）与排程（会话内 cron）是两个不可产品化的缺口**。本任务把第一个缺口
换成一个**文件协议**——不依赖终端、不依赖某个 Claude Code 会话活着、任何实现都能读写。

**不做**：不改排程（会话内 `CronCreate`/`Monitor` 的会话生命周期问题是另一件事）。
不让内层自动恢复——它仍然停，只是**能说出自己停了**。

## Acceptance Criteria

- [x] AC1: `.quay/inner-blocked.json` 的 schema 定义并进 `.gitignore`
- [x] AC2: `reason` 的合法值就是内层已有的停摆条件，不新增语义
- [x] AC3: 内层 tick 文件（`docs/analysis/fast-mode-loop-tick.md`）要求：停下前写、恢复后删
- [x] AC4: 一个 `--assert-blocked` / `--clear` 的小 CLI，内层调它而不是手写 JSON（避免格式漂移）
- [x] AC5: 文件存在时 `restart-readiness-check.sh` 打印它（内层在等裁定 ≠ 可以解除 `.halt`）
- [x] AC6: 外层 Monitor 脚本改用 `inotifywait` 监视该路径，事件带 `reason` + `question`
- [x] AC7: 等待时长（`since` → 删除）记进遥测，`--report` 输出累计死时间与单次最长
- [x] AC8: **真实演练**：内层制造一次阻塞 → 外层在 60 秒内收到带 `question` 的事件 → 裁定 →
      内层清除 → 死时间被记录。全过程输出贴进任务体（见下方「AC8 演练记录」）
- [x] AC9: 测试带 `// @test-group engine` 声明

## Definition of Done

- [x] AC8 的端到端演练有完整记录（时间戳可对照）
- [x] 任务体记录演练那一次的死时间，作为此后对比的第一个基线数（**8.2s / 0.14 min**）
- [x] `scripts/test.sh` 绿（`--for-task` 选中集 41 tests / 41 pass；全量由外层 fan-in 负责）
- [x] 明确记录：本任务**不让内层自动恢复**，只让它能说出自己停了

## AC8 演练记录（2026-08-03，真实端到端）

内层（本任务，在 `/tmp/quay-wt-blocked` worktree 里）制造一次阻塞；外层用 `inotifywait` 监视主
checkout 的 `.quay/`；裁定后内层清除；死时间记进遥测。全程时间戳如下：

| 时刻 | UTC | 事件 |
|---|---|---|
| T0 | `2026-08-03T00:18:43Z` (1785716323) | 演练开始；外层 inotifywait 监视 `/home/yale/work/quay/.quay/` |
| — | `T0+1s` (00:18:44) | 监视器武装完成 |
| — | `00:18:45` (since=1785716325619) | **内层 `--assert-blocked`**（reason=`ruling-required`，question=「M243 冲突按 A（保留本地 schema 约定）还是 B（跟 master）？」）——CLI 从 worktree 自动解析共享根，写到主 checkout `.quay/inner-blocked.json` |
| — | `00:18:45` | **外层 inotifywait 事件：`CREATE inner-blocked.json` + `CLOSE_WRITE`** —— 同一秒内收到，远小于 60s 上限 |
| T2 | `00:18:51` (1785716331) | 外层 `--read` 拿到完整记录（reason + question + options + evidence），裁定：**按 A** |
| T3 | `00:18:53` (1785716333) | **内层 `--clear`**（wait 8.2s），事件落 `.workflow-events/blk-…jsonl`，`DELETE inner-blocked.json` |
| — | 此后 | `fast-mode-telemetry --report` 输出：`blocked-wait periods: 1`、`cumulative blocked (dead) time: 0.14 min`、`longest single blocked wait: 0.14 min` |

**演练结论**
- 检测延迟：**< 1s**（`--assert-blocked` 写入的同一秒内 inotifywait 就发出 CREATE/CLOSE_WRITE 事件），
  相对此前的 20 分钟 tick / 60s 轮询是质变。
- 死时间基线：**8.2s（0.14 min）** ——「内层实际等了多久」这个此前完全没有的数，从这次起有基线。
- 事件带 `reason` + `question`，外层不读屏即可开始裁定。
- 阻塞记录被清除、`.workflow-events/` 与 `.quay/inner-blocked.json` 均 gitignored，主 checkout
  跟踪树无改动。

**关于演练产物的清理与诚实披露（外层纠偏 2026-08-03，test-writes-shared-state 同类）**：

本次演练向**真实**的 `.workflow-events/` 写入了一条 `blk-gap-…-1785716325619-5d8pfx.jsonl`
（演示用的 blockedQuestion「M243 冲突按 A 还是 B？」）。**外层 Monitor 在 master 上（00:20Z tick-log）
把它报成 `ORPHAN`，记为「在研工具自身污染生产遥测」，并于 00:21:23Z 提交 `3de649d0` 清理。** 根因是
**master 侧的 `fast-mode-telemetry.ts`（旧聚合，无本分支的 blocked 分离）把 `blk-` 事件当成
「有结束无开始」的 orphan**——本分支的 `aggregate()` 把 `eventKind:"blocked"` 分离进 `blocked` 段，
不会进 orphaned。演练当时的 `--report` 输出（`blocked-wait periods: 1` / `cumulative 0.14 min` /
`longest 0.14 min`）是**本 worktree 已修复的 `--report`** 在演练时刻（00:18:53）算出来的——`aggregate()`
的分离在本任务测试（00:12 已见 `blocked-wait periods: 1`）先于演练就绪，故演练本身的检测与计时是真实的；
但**运营中的外层（master 旧代码）看不到 blocked 段，只会看到 false ORPHAN**。

处置（均已完成）：
1. 幽灵记录已删除（含 REFUTE 轮 1 审查者自测产生的 `blk-gap-test-3141958-…`）；真实 `.workflow-events/`
   现无任何 `blk-*` 文件、`--report` orphaned 为空。
2. 单元测试一律传临时 `--root`（已核实：跑完本任务测试后真实 `.workflow-events/` 不新增任何文件）。
3. 基线数以文本记在本任务体（**8.2s / 0.14 min**），**不留在遥测存储里**。
4. 任务体如实披露（本段）。

**Rollout note（REFUTE 轮 1 MAJOR 2）**：在本分支合并到 master 之前，内层若 assert+clear，master 侧旧
聚合会把 `blk-` 事件报成 false ORPHAN（外层已两次遇到）。缓解：**先让本分支落地，再允许内层使用该信号**；
合并后 `aggregate()` 的 blocked 分离使该误报自愈。本分支的 `inner-state.sh` 另加了防御性过滤（ORPHAN
里滤掉 `blk-` runId）与 ~60s 节奏闸（REFUTE 轮 1 MINOR 3/4），见代码。

## Touches

- plugin/scripts/inner-blocked-signal.ts
- plugin/test/inner-blocked-signal.test.mjs
- plugin/test/restart-readiness-check.test.mjs
- plugin/test/inner-state.test.mjs
- plugin/scripts/fast-mode-telemetry.ts
- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
- orchestration/watch/inner-state.sh
- docs/analysis/fast-mode-loop-tick.md
- .gitignore

## Test-Files

- plugin/test/inner-blocked-signal.test.mjs
- plugin/test/restart-readiness-check.test.mjs
- plugin/test/inner-state.test.mjs
- plugin/test/fast-mode-telemetry.test.mjs
