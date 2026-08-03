# 快速模式队列状态（跨 compact / /clear 恢复用）

**更新：** 2026-08-02，内层编排会话写入
**用途：** `/clear` 后重读此文件 + 冷启动节三命令建立实况，**以 git 实测为准**（此文件可能是旧快照）
**上层目标：** `orchestration/exp6-phase1-sustained-unattended-operation.md`（外层任务，内层读它了解全局）

---

## 前置（exp6 阶段 A/B，满足后才启动 12 小时）

| AC | 内容 | 状态 |
|---|---|---|
| AC2 | 3 个既有失败各有 open 任务 | ✔ 已建 + **已修**（全 done） |
| AC4 | readiness 补 suite-green | ✔ 已补（`52cde788`，实跑 NOT READY 验证过） |
| AC1 | 套件 0 失败 | ✔ **达成**（2128 tests / 2110 pass / 18 skip / **0 fail**） |
| AC3 | select-preflight ≤30s | ✔ **达成**（83.4s → 8.3s，~10×，merge `ae94205a`） |
| AC5 | tick 队列补充步骤 | ⏳ 未做（下一项） |

## B4 已完成（2026-08-02，全部 merge + 全量绿）

| 任务 | merge | 关键 |
|---|---|---|
| `gap-select-preflight-json-real-store-too-slow` | `ae94205a` | walk-once 共享：83.4s→8.3s；2 walk-count 回归锁 |
| `gap-symlink-mirror-invocation-test-contract-mismatch` | `1f824aee` | 测试契约模型：exit-0+Usage 合法 + clock 字段 redact |
| `gap-dod-clause13-14-enforced-but-undocumented` | `f10f6860` | Option A 文档补 Clause 13/14，PASS all 15 clauses |

## 已完成 B5（全部 merge）

| 任务 | merge | 关键 |
|---|---|---|
| `gap-tests-spawn-cli-from-ts-source`（用户建 `fa0500ad`） | `7032e704` | cli-entry.mjs 载体 + cli.test.mjs 131s→66s；done |
| `gap-tests-use-cli-where-module-import-suffices`（用户建 `0f0c8d10`） | `478e76d2` | sink 不必要的 fixture 进程（serve/mcp-server tests）；done，34.5 min |

## 滞留分支合并（人裁定顺序 M222 → M246 → M243，M239 推迟）

| 分支 | 状态 |
|---|---|
| **M222**（DIR-112） | ✅ **已合并** `6721ec28`，全量绿（2139/2121/0/18，447.6s）。墙钟差值 489−447.6=41.4s，**落在 20–63s 噪声带宽内 → 如实判定「不可判定」**（非改善）。cli.test.mjs 单文件 58.2s vs 66s 基线，方向性。done |
| M246（DIR-124-A5） | ✅ **已合并**（M246 merge），全量绿（2275/2257/0/18，429.9s，+136 测试）。独立新文件干净合并。done |
| **M243**（DIR-124-A2） | ✅ **已 merge `3dfba2c6` + 收尾完成**。单套件最终验证：2296/2277/1 fail（仅 M136）/18 skip，491.5s。**判定：M243 代码干净，大规模崩溃是并发争抢产物**（4 核跑 2 个 c8 套件 = 4 倍过订；对照 M243 前单套件同样无崩溃）。095ddbf0 带回（.error 在场）、5 类 A1a 差异逐个有证据、负控制真 fail-detect。任务 done，计量 60 min。**遗留：M136（sync-vendor 确定性错标失败）独立于 M243，已建任务 `gap-sync-vendor-drift-mislabelled-as-task-schema`** |

## 已完成 B6

| 任务 | merge | 关键 |
|---|---|---|
| `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` | `4282632c` | 成本模型实测：**非「最慢单文件」决定、8-lane 饱和**（Σ/wall ≈7.1）；噪声带宽 17–63s；B5-1/B5-2 墙钟效果在噪声内不可判定；AC1b 断言汇聚点计时（env-gated，零断言改动）+ `measure-suite.mjs` 可重复测量工具。done，72 min |

## 待执行（按顺序）

| 任务 | 说明 |
|---|---|
| **批 5（3 在飞，AC13）** | **dispatch-gate**（fm-...-y7tt6x，/tmp/quay-wt-dispatchgate）+ **m264-flaky**（fm-...-mxjpbk，/tmp/quay-wt-m264）+ **test-coverage-parser**（fm-...-4w3tpe，/tmp/quay-wt-tccheck）。checkTouchesPair 两两 DISJOINT（外层复核通过）。**批 4 已完成（AC1 达成，外层独立核实）**：tasksperhour/ac11/reverse-drift 全 done；batch4b/4c 逐项相同 2361/2343/0/0/18 + exit 0 + selected 167 ×3。**下一批候选**：`gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion` + `gap-test-isolation-contract-is-unwritten`（均与在飞正交可派）；**`gap-no-resource-awareness-heavy-ops-run-blind` 与 dispatch-gate 冲突（同改 orchestrator-loop-tick + fast-mode-loop-tick）——等 dispatch-gate 落地后再派**。**判绿三条件已记入 tick 文件**：cancelled==0 AND exit 0 AND tests==2361（fail 0 ≠ 绿——batch4a 崩溃时 fail 0 但 cancelled 2/tests 2246）。**外层正向漂移 9 条 + 检测器盲区（删除类任务 Touches 语义反）已记入本文件下方** |
| **M136（已完成）** | `gap-sync-vendor-drift-mislabelled-as-task-schema`，done（第三轮 60 min）。三轮：错标 → 并发重建免疫 → **消除干扰源**。负控制通过、--check 只读。**注意**：M136 修好了但**没修好这个类**——外层独立全量（00:03Z）仍 fail 1 = relation-sync（同类手写 harness，隔离绿/套件红） |
| **flags-only 缺陷（已完成）** | `gap-test-sh-flags-only-form-silently-runs-a-different-suite`，done |
| **`--test-concurrency=4 vs 8` 实测（已完成）** | `gap-suite-concurrency-4-vs-8-measurement`，done。外层决定：不改默认，保持 8。「系统性全量崩溃」线索关闭 |
| 下一批 gap 任务 | **先 checkTouchesPair 组可并发批次**。测试是最大可优化项（36%），新成本模型已给出可测阈值（≥20s 墙钟 / Σ 需 ≥5 采样）。**34 个手写 harness 的「隔离绿/套件红」类是后续重点**（relation-sync 是第 2 个，AC7 要判断还剩多少成员） |
| AC5：tick 队列补充步骤 | 复用 select-preflight/assembleBatch，不新建 |
| AC6（已达成） | `.halt` 已解除（17:43Z，readiness READY）。**/loop 25m 已启动且可查验**（CronList 返回 `2312da21 — Every 25 minutes (recurring) [session-only]`）。理由：/loop 是跨 /clear//compact 兜底（非驱动器），对一个专门在上下文丢失后兜底的机制，不可查验即不可信 |

**数据有效性精确边界（2026-08-02 21:05，inner-forensics 取证）**：flags-only 缺陷只在「裸标志 + 无文件列表」时触发。我的 8 次全量调用中 **7 次无标志（有效）**、**1 次裸标志 18:35:44 `--test-concurrency=4 > full-suite-m243-c4.log`（被污染，8037 失败作废）**。20:16 那次 `--test-concurrency=4` + 4 显式文件（重型子集 332/332 绿）**有效**（有文件列表，node 跑指定文件）。外层那组 `--test-concurrency=4`（8573）同样作废。**结论：M243 后崩溃、M136 全量红/隔离绿、干净窗口 load1=0.39 仍 fail 1 均为有效观察**，继续作证据。污染的范围要查（inner-forensics 秒级），不要凭印象估。

## 工作方式调整（外层实测 2026-08-02，含 subagent transcript 的完整分解）

- **时间去向（修正版，含 subagent transcript）：空转 14% / 全量套件 26.2% + 范围化 9.7% = 测试 36%**。早先「空转 49%、测试不是瓶颈」的分解漏了 subagent transcript，是错的（`940a3f5b` 修正）——**测试是最大的可优化项**
- 迭代阶段一律 `--for-task`（68s vs 489s，7.2×），全量只在合并前跑一次
- 下一批先 checkTouchesPair 组可并发批次，不默认串行

## 揭示的既有失败（已建任务，勿重复）

- 3 engine：symlink-mirror ×2 + enforcement-with-design ×1（open 任务在飞）
- 3 governance：chart2-s2（B3-2 记录为发现，需另建任务——本批未覆盖）
- **M136 sync-vendor 确定性失败**（2026-08-02，已建任务 `gap-sync-vendor-drift-mislabelled-as-task-schema`）：`sync-vendor.sh --check` 每次报 `vendor/task-schema.ts differs`——但该文件**不存在**，真正漂移的是 `packages/quay/dist/quay.js` vs `plugin/vendor/quay/dist/quay.js`（vendored 副本陈旧）。根因：`sync-vendor.sh:82` 标签是复制粘贴的错标（从 task-schema 段抄来），实际比对 dist bundle。**连查 3 次每次 1 行 DRIFT——确定性，非 flaky**（我上一轮判「flaky」是错的，外层纠正）。错标把调查引向「task-schema expected-diff 容差」的错误方向，代价是三轮误判。处置：先修标签再修同步（任务体 AC）
- **并发跑 2 个 c8 套件 = runner 崩溃**（2026-08-02 教训）：4 核机器上 `--test-concurrency=8` 已过订 2×，两个套件同时跑 = 4 倍过订 → 127/237 文件 'Promise pending' 崩溃。**全量套件必须严格串行跑**（同一时刻只跑一个），这验证了外层建议的 `--test-concurrency=4 vs 8` 实验值得做（记于 orchestration/throughput-decomposition.md）

## 已完成（B2/B3 全批次）

B2-0..B2-3、B3-1 合并 + 全量绿；B3-2 三步处置后 done。细节见 `git log` 与 `/tmp/fast-mode-batch2-timing.md`。

## 常设纪律（tick 文件）

- fan-in 前必须 `git rebase master`（worktree 快照过期 = B3-2 红的教训）
- 测试不得硬编码全局计数（`EXPECTED_ENGINE=58` 教训）
- 发现问题必须处置：修或建任务（有证据才建），不静音
- 计量强制：派发前 `--task-start`、fan-in 关闭 `--task-end`，两步不可跳过
- 停止条件：`.halt`/suite 非绿/needs-human≥3/合并冲突/就绪队列空 —— 一律停下等人

## 外层 tick 发现（2026-08-03T02:12:10Z）

### 正向漂移 9 条（reverse 已归零，reverse-drift 修复在真实仓库核实通过）

`task-status-drift-check.ts --json` 实测：`reverse: 0`、`suspects: 9`、`scanned: 583`。

| 任务 | status | 判定 |
|---|---|---|
| `gap-prepare-milestone-no-worktree-isolation` | ready | **真阳性**——CLAUDE.md 已记为 M252 已实现，`prepare-milestone.js` 里 `isolationMode` 实际存在于 6 处（行 92/101/116/119/120/311），但 **8 个 AC 全部未勾**。是「代码落地但 AC 未回填」，不是「代码未落地」 |
| `gap-retire-the-prepare-execute-pipeline-cluster` | todo | **假阳性，且是检测器的新盲区**——见下 |
| `gap-reverse-drift-check-buries-true-positives-in-noise` | todo | 真阳性但会自解：合并已落地（`48845281`），内层正在批 4 全量验证后才会 `--task-end` |
| `DIR-100-B` `DIR-100-C` `DIR-103-C` `DIR-119-D2/D3/D4` | todo/ready | 待分诊 |

### 检测器新盲区：删除类任务的 Touches 语义是反的

`gap-retire-the-prepare-execute-pipeline-cluster` 的 `## Touches` 列的是
`prepare-milestone.js` 等**待删除**的文件。它们存在 ⇒ `touchesAllExist=true` ⇒ 被判为「代码已落地」。

**但对删除类任务，这些文件存在恰恰说明工作没做。** 检测器的名字说「代码已落地」，
实际测的是「Touches 里点名的文件存在」——又一个「名不符实」实例
（`docs/analysis/instrument-failure-mode.md`）。

**随着裁剪成为工作的一大块，这会反复出现。** 修法有两种，择一即可：
任务声明意图（`## Touches` 条目标 `(delete)`），或检测器对 `labels` 含裁剪类的任务反转判据。
归入 [[gap-reverse-drift-check-buries-true-positives-in-noise]] 的后续，不单开任务。

## 外层指令：空转归因instrumentation（2026-08-03T02:41:54Z，人已裁定）

**此条在内层 auto-compact 前后都必须生效——若压缩后读到这里而尚未执行，立刻执行。**

### 裁定

人的裁定原文：「先让内层在下一个窗口里加上这个记录，攒一轮数据再说。」
**这一轮只攒数据。不做任何优化、不缩短任何间隔、不改 tick 频率。**

### 实测依据

8.78 小时无人值守窗口（2026-08-02T17:43Z → 2026-08-03T02:30Z），内层会话 `3bbd3095` 合并 28 个
subagent transcript：

| 间隙归因 | 小时 | 占窗口 |
|---|---|---|
| **前一条无命令**（回合结束后等待被唤起） | **3.80** | **43.3%** |
| 其它 Bash/工具 | 0.35 | 4.0% |
| 全量套件 | 0.22 | 2.5% |
| 范围化测试 | 0.04 | 0.5% |

间隙分布：61 个 >60s，1–5min **40** 个、5–10min **17** 个、10–20min 4 个、
**20 分钟以上 0 个**（最长 18.6min）。

**两个结论**：

1. **外层 20 分钟 tick 不是约束**——若是，应在 20 分钟处堆积并拖尾，实测一个都没有。
   因此「缩短外层 tick」买不到任何东西，**不要做**。
2. **`.quay/inner-blocked.json` 至今零条记录**，根因是 `VALID_BLOCKED_REASONS` 的 7 个值
   （merge-conflict / suite-red / review-refuted / task-over-90m / needs-human-backlog /
   ruling-required / queue-empty）**全部是已声明的停止条件**，
   词汇表里没有「回合结束、无待办、等被唤起」这个词，所以占 43.3% 的主要情形永远无法被记录。

### 要做的三件（都很小，不需要新机制）

1. 给 `VALID_BLOCKED_REASONS` 加一个值 **`turn-ended-idle`**，
   `REASON_DESCRIPTIONS` 写「回合结束、无待办工具调用、等待被重新唤起」，补测试。
2. **每次要以「无待办」结束回合前**，先调用：
   ```
   node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts \
     --assert-blocked --taskId <当前或 none> --reason <枚举值> --question "<在等什么，一句话>"
   ```
   被唤起后**立刻** `--clear`——`--clear` 会把等待时长写进遥测，**那正是我们要攒的数据**。
3. **不做优化。** 攒满一个窗口后由外层做归因，再决定优化什么。
   在 3.80 小时没有归因之前定任何阈值，是 416s 那个错误的重演。

### 文件占用提醒

`docs/analysis/fast-mode-loop-tick.md` 正被在飞的 `gap-dispatch-gate-has-no-checklist-and-no-trace`
占用。该文档的改动**并进那个任务或等它落地后再改**，不要并行改同一文件。

## 外层更正上一条指令（2026-08-03T02:45:03Z）—— 不该进阻塞信号

**上一条指令（2026-08-03T02:45:03Z 前约 15 分钟）有设计错误，外层自己发现的。以本条为准。**

### 错在哪

`turn-ended-idle` **不是「停下等裁定」**——回合结束、无待办不是在等外层，是在等自己的 loop 唤起。
把它写进 `.quay/inner-blocked.json` 会造成两处误触发：

1. `orchestration/watch/inner-state.sh:25-30` 对**任何** reason 都发 `BLOCKED reason=… question=…`，
   **没有过滤**。⇒ 内层每结束一次回合就叫醒外层一次，而这些事件不需要任何动作。
   **一个有意义的告警信号会被稀释成噪声**——这比没有信号更糟，因为它会训练出忽略。
2. `restart-readiness-check.sh` 在 un-halt 前打印阻塞记录（「内层在等裁定 ≠ 可以解除 `.halt`」）。
   一条 `turn-ended-idle` 会挡住 un-halt。

而且 `docs/analysis/fast-mode-loop-tick.md:238-256` 的触发条件写的是「**停下等人**」，
`--reason` 示例硬编码那七个值，并明写「**不新增语义（AC2）**」。
**加了枚举值但文档禁止使用它 ⇒ 代码与文档两个源头打架**，正是本仓库反复要消灭的漂移。

### 改为（三件，都更小）

1. **撤回 `7cfc9733`**——从 `VALID_BLOCKED_REASONS` / `REASON_DESCRIPTIONS` 移除 `turn-ended-idle`，
   测试断言改回 7。理由是上面第 2 段：留着一个文档禁止使用的值，比没有它更容易让人写错。
2. **改用只追加的日志**，与告警信号完全分开：
   ```bash
   # 每次以「无待办」结束回合前，追加一行（无状态、无需 --clear）
   # REASON 与 NOTE 是占位符，替换成实际值；注意不要写成 <reason> 那种形式，shell 会当重定向
   node -e 'require("fs").appendFileSync("orchestration/inner-idle-log.jsonl",
     JSON.stringify({at:new Date().toISOString(),reason:process.argv[1],note:process.argv[2]})+"\n")' \
     REASON '一句话说明在等什么'
   ```
   `reason` 用这五个之一：`awaiting-subagent`（在等自己派的 subagent）、
   `queue-empty`（无可派任务）、`awaiting-ruling`（真的在等外层裁定）、
   `rate-limited`、`no-reason`（说不出为什么——**这一项的计数本身就是下一轮要修的东西**）。
3. **时长不用内层记**——外层从 transcript 的时间戳间隙算（已验证可行：8.78h 窗口 61 个间隙、
   3.80h 无命令）。内层只提供**原因**，两边 join 即可。这样内层零状态、零清理、零误触发。

### 不做

不改 `inner-state.sh`、不改 `restart-readiness-check.sh`、不给阻塞信号加过滤——
**保持阻塞信号只有一个含义：内层在等外层裁定。** 一个信号一个含义，比一个信号加一层过滤更难用错。

### 内层实现（2026-08-03T02:50Z）

机制已落地为 `plugin/scripts/inner-idle-log.ts`（reason 五值 fail-closed，`--root` 可测）+
`plugin/test/inner-idle-log.test.mjs`（6/6）+ gitignore。用法：

```bash
node --no-warnings --experimental-strip-types plugin/scripts/inner-idle-log.ts \
  --append --reason <awaiting-subagent|queue-empty|awaiting-ruling|rate-limited|no-reason> \
  --note "<一句话在等什么>"
node --no-warnings --experimental-strip-types plugin/scripts/inner-idle-log.ts --counts
```

**纪律：每次要以「无待办」结束回合前调用一次 `--append`；无 `--clear`（零状态、只追加）。
`at` 是 ISO 字符串；时长不记（外层从 transcript 间隙算，按 `at` join）。**

## Tick 记录（2026-08-03T02:55Z，内层）

- **哨兵**：无 `.halt`（运行中）
- **本 tick 做了**：执行外层更正三件（撤回 turn-ended-idle `18d27d18`、落地 idle-log `aa047baa`、
  discovery git-index 修复 `63afe8f8`——AC4 主检出红的根因）；test-coverage 已 merge `6518170c`，
  **全量套件正在跑**（`ba0jsaicx`，后台，压力 some avg10=0）
- **在飞（2）**：dispatch-gate（`ac1f5685fa1c94943`，/tmp/quay-wt-dispatchgate）+ m264
  （`af375c8a06b0efe0d`，/tmp/quay-wt-m264）——均有近期活动（02:50/02:47）
- **停止条件**：**needs-human 积压 = 7（≥3，触发停止派发）**——DIR-100/DIR-100-A/DIR-101/DIR-103/
  DIR-103-B/DIR-105/DIR-109，**全部历史**（07-29→08-02 05:53，近 2h 无新增），非本批产生。
  **本 tick 不派发新任务**（纪律：停下等人）；fan-in 照常（全量绿 → 关 test-coverage → 在飞返回后逐个收尾）
- **阻塞信号**：无记录（非停止状态）
- **计量**：test-coverage runId `fm-...-4w3tpe`（fan-in 完成后 `--task-end`）

### Tick 更新（03T03:00Z）：test-coverage 已关闭

- **全量绿**：2372 tests / 2354 pass / **0 fail / 0 cancelled** / 18 skip，FULL-SUITE-EXIT=0，selected 169。
  **参考值 tests 从 2361 → 2372**（+5 test-coverage-check +6 inner-idle-log 测试）
- **test-coverage done**：worktree `/tmp/quay-wt-tccheck` 移除、分支 `task/test-coverage-fix` 删除、
  任务体提交（post-merge discovery fix note + status done）、`--task-end`（`fm-...-4w3tpe`, done）
- **在飞（2）**：dispatch-gate + m264 仍在
- **不派发**：needs-human=7 停止条件持续成立——`gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion`
  与 `gap-test-isolation-contract-is-unwritten` 仍排队，等外层处置积压或放行

### Tick 更新（03T03:08Z）：外层裁定恢复派发 + dispatch-gate 合并 + inventory 已派

- **外层裁定（03T03:06Z）**：**needs-human=7 不构成停止派发的理由**。7 个全历史遗留（07-29→08-02 05:54，
  早于无人值守窗口 17:43Z ≥12h）；窗口内新增 needs-human **0**；遥测唯一 needs-human 结局已 done。
  停止条件判据有缺陷：fast-mode-loop-tick.md:156 意图是「产出速度 > 消解速度」，被读成「总数」⇒ 永久卡死
  （解开历史任务需要派发）。**修法：判据改为窗口内新增数。** 已改 tick 文档两处（Step 3 + 判断边界表），
  提交 `9a…`。7 个 DIR 去留是范围决定已升级给人（orchestration/escalations.md），本轮不处理
- **dispatch-gate 已合并** `663fc5c8`（Contract 六键机制，REFUTE round-2 PASS，11 文件）。scoped 57/56/0 绿。
  **批全量正在跑**（`bt01s74hv`）。合并后 agent 曾停摆（staged 未提交等验证通知），已恢复完成提交
- **inventory 已派发**（`a86265c011c3f0088`，/tmp/quay-wt-inventory，runId `fm-...-yylhln`）——
  外层裁定下一批第一，与在飞 DISJOINT 实测。全量绿后关 dispatch-gate
- **在飞（2）**：m264（诊断中）+ inventory（实现中）

### Tick 更新（03T03:18Z）：dispatch-gate 已关闭

- **dispatch-gate done**：批全量绿（**2407**/2388/0/19，exit 0；参考值 2372→**2407** = +35 contract-check 测试；
  selected 170）。worktree/分支清理、任务 done、`--task-end`（`fm-...-y7tt6x`）。**参考值更新：2407**
- **在飞（2）**：m264（~51min，未到 90min 阈值）+ inventory（~11min）。均活跃未提交
- 停止条件：无（needs-human 判据已按外层裁定改为窗口内新增，7 历史不构成；`.halt` 无）

### Tick 更新（03T03:28Z）：m264 已合并，批全量在跑

- **m264 done 流程**：根因 = 共享 `<repo>/tmp/` 并发干扰 → collector fail-open 写空清单 → 测试 TypeError。
  修复：14 处 scratch 移 `os.tmpdir()` + 长度保护 + collector fail-closed（admission-decision-unreadable）+
  `.gitignore tmp/`。**「隔离绿/套件红」类第 3 号成员**（M136→relation-sync→本任务，偶发红非稳定红）。
  merge `b1a…`，scoped 24/24 绿。**批全量在跑**（`ba7zgcgbo`）。遗留 `tmp/be-explicit-rw-h2oiJI/` 已清理
- **inventory**（~20min）：已产出未提交文件（runtime-usage-inventory.{json,md,ts}），实现中
- 在飞（1 活跃实现）：inventory

### Tick 心跳（03T03:29Z）

- 无 `.halt`；m264 批全量在跑（`ba7zgcgbo`，selected 170，pressure 0）；inventory 活跃（~20min）
- 无停止条件（needs-human 窗口内新增 0）。**本 tick 不派发**——fan-in 全量先于派发（2× c8 崩溃纪律）；
  全量绿后关 m264，再评估补派 reclaim-worktrees / test-isolation-contract

### Tick 更新（03T03:38Z）：m264 关闭 + 并发补满 3

- **m264 done**：批全量绿（**2408**/2389/0/19，exit 0；参考值 2407→**2408** = +1 fail-closed 回归测试）。
  worktree/分支清理、任务 done、`--task-end`（`fm-...-mxjpbk`）。**参考值更新：2408**
- **补派 2 个**（并发满 3）：reclaim-worktrees（`afa6d17c167863fa1`，runId `fm-...-sf5zrl`，/tmp/quay-wt-reclaim）
  + test-isolation（`a5e61c452d700bdf6`，runId `fm-...-wo6yww`，/tmp/quay-wt-testiso）。三者两两 DISJOINT
  （checkTouchesPair 机械验证）
- **resource-awareness 阻塞解除但互斥**：dispatch-gate 已落地（tick 文档不再被占用），但 resource-awareness
  与 test-isolation 在 `scripts/test.sh` OVERLAP（实测）——**等 test-isolation 落地后再派**。dispatch-gate 的
  AC6 基线违规（`resource-awareness: dispatch-review-missing`）待其派发时补 `## Dispatch review` 自清
- **在飞（3，满）**：inventory + reclaim + test-isolation

### Tick 心跳（03T03:52Z）

- 无 `.halt`；无停止条件。**3 在飞全活跃**（transcript 03:51-03:52 均更新）：
  - inventory：staged 未提交（runtime-usage-inventory.{json,md,ts} + test + 任务体），03:41-03:51 曾等其
    内部 REFUTE reviewer（正常 parent-wait，非停摆），已恢复
  - reclaim：已提交 1 commit `83c7e5d3`（fix milestone-worktree merged-then-reverted criterion + 卫生 gate + drop --force）
  - testiso：无 commit 但活跃
- 外层推了 2 个 task 提交（`58d68d8b`/`fd770df3`）——新 backlog 任务（eligibility-blinded、
  quantified-stop-conditions、web-can't-show-loop-state 等），**不碰在飞 Touches，无 fan-in 冲突**，排队后续
- 本 tick 不派发（并发满 3）

### Tick 心跳（04T03:59Z）

- 无 `.halt`；无停止条件；3 在飞全活跃（04:01/03:56/04:02）
- **reclaim**：新增第 2 commit `892a167e`（merged-then-reverted 判据修正：须有 merge commit 而非 tree
  diff）——正确性迭代中。已 2 commits
- **inventory / testiso**：~55min 无 commit，但 transcript 活跃（实现/审查中），未到 90min 阈值

## 外层重排队列优先级（2026-08-03T04:0xZ，人裁定——压缩后读本节 + 本文件末节）

**诊断**：近 18h 扩张:收敛 = 3:21、图新增:删除节点 = 22:0、脚本 live:unaccounted = 35:81、
tick 文档决策语句:真执行者 = 36:7。收敛 = 用更低描述长度的机制替换更高——我们只产断言没产支柱、
没删过任何东西，L(X) 在上升。**图从未收缩过一次。**

### P0 删除算子（裁减）
1. **no-inventory**（在飞，裁剪 + 冷启动产品化双关键路径）
2. **reclaim-21-merged-worktrees**（在飞，第一次真实删除）
3. **retire-the-prepare-execute-pipeline-cluster**（依赖 #1 的 class 列；**#1 落地后立刻派**）
4. **stranded-worktree-branches**（#2 落地后再排）

### P1 异步通道
5. serve-task-list-dies-on-one-malformed-task（人正用那个页面，再畸形一次就再 500 一次）
6. web-cannot-show-what-the-loop-is-doing-now（/live + /journal）
7. web-board-needs-an-inconsistency-verdict

### P2 暂缓一切再加检查类任务
quantified-stop-conditions、test-isolation-contract（在飞，**让它跑完，不中断**）、
checks-that-verify-an-empty-set、no-resource-awareness、workflow-metadata-warn、plancheck-*、
prepare-milestone-no-size-aware-routing-* 等。理由：删除算子跑通前每加一个检查都让 L(X) 继续上升。

**例外填充**（仅当 P0/P1 因 Touches 冲突派不出时）：dispatch-eligibility-blind-to-files、
inner-forensics-verify——生产机制正在给错答案，不是新增检查。

**解冻判据（可测不靠判断）**：任务图**首次收缩** = 有任务节点被删除，或有一次落地提交净行数为负。
冻结时刻 = 本条指令时间（2026-08-03T04:0xZ）。

**纪律**：这是排序不是取消——**不改任何任务 status、不删任何任务**。

### 对派发计划的修正
- test-isolation 落地后：**不派 resource-awareness（P2）**，改派 P1 #5/#6/#7（serve-task-list 500 优先——
  人在用那个页面）
- inventory 落地 → 立即派 P0 #3 retire-pipeline；reclaim 落地 → 排 P0 #4 stranded-worktree
- 跟踪解冻判据：首次图收缩（负净行数落地或节点删除）时报告

### 资源事件（2026-08-03T04:1xZ，外层实测 + 内层处置）

**事件**：两个 agent 在各自 worktree 里**并发跑全量套件**（testiso + reclaim，各 --test-concurrency=8，170 文件），
4 核 34+ 进程 → CPU pressure some avg10 **96.62**（batch-4 崩溃阈值 84.77 之上）、load1 31.35、43 node 进程。
内存无风险（mem 0、swap 0、可用 3789MB）——纯 CPU 饥饿。

**处置**：
1. **中止 reclaim 套件**（更年轻 11min；P0 但验证可重跑）——SIGKILL 主 runner + 孤儿进程（node 43→22）
2. **让 testiso 套件自然完成**（外层「不要中断 test-isolation」）——结果：**fail 2 / cancelled 0**，两个失败都是
   `delivery-standalone-smoke` gate 测试（68s/60s，正常 ~1-5s）——并发饥饿下的时序失败，非代码缺陷
3. testiso agent 已自行重跑第二轮（/tmp/suite-run2.log，当前唯一在跑的套件）
4. 已消息 reclaim agent：被杀 = CPU 饥饿非缺陷，等 testiso 跑完再重跑，重跑前确认无其它套件 + pressure < 40
5. **外层 #1**：此后全量套件一次只跑一个，跑前看 `/proc/pressure/cpu` some avg10 < 40

**resource-awareness 触发条件**（外层）：这是今晚第二次同一条件咬人。**若再发生一次、或这两次套件出现
cancelled > 0，它从 P2 提升到 P1**（资源闸更接近支柱而非再加断言）。本次 testiso cancelled=0（未触发）、
reclaim 被中止（无结果）——但 2 个 68s/60s 时序失败与 cancelled 功能等价，已向上报告。

### Tick 更新（04T03:13Z）：inventory P0#1 合并 + 全量排队

- **inventory merged**（`ce23e6ce` + merge）：runtime-usage-inventory CLI + test(18, @test-group governance) +
  table{json,md}。205 脚本分类：**live 36 · library 72 · ci-only 1 · dormant-by-decision 7 ·
  never-runs-test 8 · unaccounted 81**。scoped 18/18 绿。AC9 无删除。REFUTE 1 轮 10 MINOR 全闭（0 阻塞）
- **全量排队**：suite-run2（testiso 重跑）仍在跑（压力 ~94，单套件重负载阶段）；**inventory 全量等
  suite-run2 结束 + 压力 <40 再跑**（外层 #1 纪律）。跑完即关 inventory → 派 P0 #3 retire-pipeline
- **串行队列**：suite-run2 → inventory 全量 → reclaim 重跑 → （testiso 若再失败则再跑）。全部一次一个
- 在飞：testiso（suite-run2 中）、reclaim（等重跑）；inventory 合并 pending 全量

### Tick 更新（04T03:15Z）：suite-run2 全绿 = 坐实饥饿；inventory 全量在跑

- **suite-run2（testiso 重跑）全绿**：2416/2397/0/0，EXIT 0——delivery-standalone-smoke 通过。
  **坐实 suite-run1 的 2 个失败（68s/60s）是 CPU 饥饿非缺陷**。testiso 的 test.sh 改动验证通过
- **inventory 批全量在跑**（`bdqps1ujt`，压力 10.21 <40 起跑）。已消息 reclaim：等 inventory 全量结束再重跑
- 串行队列：inventory 全量 → reclaim 重跑 → testiso fan-in 全量（testiso agent 提交后）

### Tick 更新（04T03:19Z）：testiso merged；reclaim 停车等信号

- **testiso merged**（`7dce49f5`/`8633ed4a`，7 文件）：test-isolation-check 扫描 + 棘轮（baseline 23）+
  test(8) + 契约文档 + test.sh `run_static_checks` +2 行。scoped 8/8 绿。**suite-run2 全绿**（2416/2397/0/19）
  证实 M52 run1 失败是既有 60s 门禁 flake 非其改动。无 `## Contract` → `contract-absent`（info 非失败）
- **reclaim agent 停车**：声称「等 inventory 套件完成通知」——停摆形态，等编排信号。inventory 全量结束后
  消息它重跑
- **inventory 全量仍在跑**（`bdqps1ujt`）。**串行套件队列**：inventory 全量 → reclaim 重跑 → testiso 全量

### 外层优先级微调（2026-08-03T04:2xZ，人裁定——详见本文件末节）

**一、resource-awareness P2→P1 首位**（排在 serve 崩溃与 web 观察面前）：
- **实测推翻「并发才饥饿」**：单个套件自身 = 8 worker + 7 子进程 + 根 = **16 进程，4 核 4 倍超订，压力 87.15**；
  两个并发只是 87→97。**饥饿是「跑一次全量」的稳态，不是并发的产物**
- 直接打在 P0 上：每个删除算子的 DoD 连跑 2 次全绿 = 至少 2 次进饥饿态。今晚已耗：M136 三轮、批 4 崩溃一次、
  reclaim + test-isolation 各重跑一次
- **分类修正**：资源闸是两层共用的原语、取代重复目测判断——**支柱化，不是再加断言**（外层先前归类错了）

**二、inventory 窗口差集改变 retire 前提**（**派 retire 前必须读进去**）：
- 51 脚本 15.9h 低频 / 72h live，**31 个 unaccounted→live，真实 unaccounted ~50 不是 81**
- `.claude/workflows/*.js`：15.9h 6 个全 unaccounted，**72h 5 个 live**——prepare-milestone 280×、
  execute-milestone 47×。**经典循环在用，fast-mode 只是有意绕过**
- retire 任务体的「最后 prepare-epoch 22 小时前」只覆盖 fast-mode 一侧；**派发前必须按 72h 窗口重估规模主张**，
  否则会把还在用的东西当遗留删掉

**三、P0 三个删除算子顺序不变**。**派发优先级**：P0 retire(#3)/stranded(#4) → P1 **resource-awareness(首)** →
serve-task-list → web。testiso 已合并（scripts/test.sh 冲突解除），resource-awareness 可派

### Tick 更新（04T03:30Z）：inventory 全量非绿→修 runner-grouping→合并套件重跑

- **inventory 全量 fail 1**：`--group governance --list-files` 断言 governance 文件全在
  `/experiments\/quay-perpetual-stream\/test\//` 下——inventory 测试（AC10 governance）在 `plugin/test/`
  打破了该硬编码路径假设（「硬编码全局计数」类又一次）。**修复**（`runner-grouping.test.mjs`）：governance
  根放宽到 experiments/ + plugin/test/（路径是活的成员关系非契约；计数关系不变）。runner-grouping 9/9 绿
- **inventory 套件还漏了 testiso**（套件在 testiso merge 前起跑）——**合并套件重跑**（`bfldr7co2`，
  含 inventory fix + testiso 8 测试一起验证）
- 外层新建 **ADR-022**（retire classic milestone loop）——retire-pipeline 派发时引用
- 下一步：合并套件绿 → 关 inventory + testiso → 派 P0 #3 retire（带窗口差集 + ADR-022）→ 信号 reclaim 重跑
  → 派 P1 resource-awareness

### 外层裁定（04T03:33Z）：inventory OVER90 是假触发，不要放弃/拆分

**证据**：AC 14/14 全勾、产物已落盘（runtime-usage-inventory.json 234655B + .md 42344B）、套件根进程
pid 4049485 跑 438s 且消耗 CPU（非卡死）、压力 86.54。**90 分钟不是任务过大/卡住，是已完成后卡在被饥饿
拖慢的 fan-in 套件上**。OVER90 处方（拆分/放弃）为 Build 相位设计——放弃 = 扔掉已完成的交付物。
**让它把套件跑完再收尾**（inventory status 仍 todo，未被误标，无需干预）。

**机制观察（供 gap-no-resource-awareness）**：今晚**第三次**同一根因（CPU 饥饿）抬高不同信号——
①重型测试超时被当代码缺陷 ②两个套件并发压力 96.62 ③OVER90 在已完成任务上触发。**共同形态：阈值测的是
墙钟，而处方假设那段墙钟花在干活上。**

### Tick 更新（04T03:46Z）：inventory+testiso 关闭、reclaim merged、retire 已派

- **inventory + testiso 已关闭**：合并套件绿（**2417**/2397/0/20，新参考值；tick 文档已更新）。
  双 `--task-end`（yylhln / wo6yww）。worktree/分支清理
- **reclaim 已 merged（3 commits 全进）**：83c7e5d3 + 892a167e + 44b40bd7（REFUTE 收尾，parts[2] 二父修正）。
  scoped 18/18 绿。**关键发现：任务题设「21 个 fully-merged worktree」只对一半——19 个携带真实未提交工作
  （如 M237 tasks/DIR-124-C.md +103/-82），按保守规则正确拒绝回收；只回收 M277(~51M) + M243 悬挂分支。
  19 个脏 worktree 是待人的单独事项**（不删，保留）。验证套件在跑（`b030l13jl`）
- **retire 已派**（P0#3，`ad39d72405f1b5004`，runId `fm-...-0b3l2x`，/tmp/quay-wt-retire）——带窗口差集
  重估指令（prepare-milestone 280×/execute-milestone 47× 在用）+ ADR-022 方向 + 删除算子性质
  （负净行数 = 解冻判据）。与在飞 DISJOINT 实测
- **在飞（2 实现）**：reclaim（验证套件中）+ retire（读证据中）。**下一步**：reclaim 套件绿 → 关 reclaim
  （`--task-end` sf5zrl）→ 派 P1 resource-awareness（首位，scripts/test.sh 冲突已随 testiso 落地解除）

### 外层紧急通报（04T03:5xZ，人裁定——34 项未落地工作）

**实测**：19 个 milestone worktree 含 **34 项从未落地的工作**——5 个任务文件只存在于 worktree、master 没有且
未跟踪（`tasks/DIR-124-F1/F2/F5/F6.md`、`gap-build-evidence-path.md`）+ 14 份 `docs/plans/M2xx-*.md`。
对 task list / web UI / 漂移检查器**全部不可见**。三闸实测：Gate 1 过 19（M239 正确拦下）、**Gate 2 全拦 19**
（每个都有未提交内容）⇒ **净可回收 0，1.1G 不释放**。

**两条裁定**：
1. **reclaim 现状执行没有错**——Gate 2 拒绝删脏 worktree 正是该做的；**不放松不加 --force**（会销毁 34 项工作）。
   已如实记录：净回收 = M277(~51M) + M243 悬挂分支，其余 19 个因含未落地工作正确拒绝。**34 项已升级给人**
2. **retire 硬边界**（已消息在飞 agent）：不得移除 `milestone-worktree.ts`、不得删除 `milestones/M*/worktrees`、
   不得改动那 19 个 worktree。其余部分（composite-*、prepare/execute workflow 本体、文档同步）可继续
- **不可见任务发现**：worktree-only 的任务文件对工具链不可见——漂移检查器盲区（与删除类 Touches 语义反
  同类），已升级给人，暂不建任务

### Tick 更新（03T03:0xZ）：外层新任务 + dispatch-gate REFUTE PASS + tmp/ 发现

- **外层派发（人裁定 03T03:0xZ）**：新任务 `gap-no-inventory-of-what-the-two-layer-mode-actually-runs`
  ——**当前批次（dispatch-gate + m264）收尾后作为下一批第一个派发，优先于队列里其它 gap 任务**。
  从 `gap-retire-the-prepare-execute-pipeline-cluster` 第一步拆出，范围扩大到全仓。**只出表不删文件**
  （AC9：diff 不得含文件删除）；执行/import 判据不许继承首测裸子串偏差；死名单三类
  （frozen=exp6§0 封存 / ci-only=查 workflows / test-never-run=不在 canonical glob）不能一刀切；
  **unaccounted ≠ 可删**（= 无证据说明为什么在这）。
  **DISJOINT 已实测**：checkTouchesPair vs dispatch-gate + m264 均 `{"disjoint":true}`（机械，非目测）
- **dispatch-gate**：round-2 REFUTE 验证 agent（`afb01cce548ba85b7`）独立完成 **PASS**——R1（n/a 空值）/
  R2（反引号注释剥离）/ MINOR1-4 全部确认修复；`task-contract-check.test.mjs` 35/34/1/0；
  全仓扫描恰好 1 个违规（`gap-no-resource-awareness-heavy-ops-run-blind` 的 dispatch-review-missing——
  正是因与 dispatch-gate 重叠被阻塞的任务，验证通过后的正确产物）；`task-schema.test.mjs` 22/22。
  **agent 曾停摆**（staged 未提交、无 live children 声称等验证）——已恢复（SendMessage），待其提交报告
- **tmp/ 发现**：`plugin/test/build-evidence-manifest.test.mjs`（= m264 靶子）在 repo 根写 `tmp/`（未 gitignore，
  `:62` mkdir）。主检出全量后残留 `tmp/be-explicit-rw-*/`（只有 admission + iter-report、**无 manifest.json**）
  ⇒ 某次运行在 collector 产出前失败（assert 957 throw → rmSync 961 未跑），但全量报 fail 0。
  **已发给 m264 agent**（一手证据，可能与其 flaky 诊断相关）。`tmp/` 未 gitignore 是独立卫生缺陷

## 外层裁定：needs-human=7 不构成停止派发的理由（2026-08-03T03:05:15Z）

**内层报 `needs-human=7 halts dispatch`。外层分诊结论：解除，继续派发。**
（授权来源：`orchestrator-loop-tick.md` 步骤 3「needs-human 积压 ≥3 → 分诊：真阻塞的攒给人，
可继续的指示内层继续」。）

### 证据

7 个全部是**历史遗留**，最后改动时间：

| 任务 | 未勾 AC | 最后提交 |
|---|---|---|
| `DIR-109` | 2 | **07-29 15:52** |
| `DIR-100-A` `DIR-101` `DIR-103-B` `DIR-105` | 10 / 15 / 9 / 15 | **08-01 09:39** |
| `DIR-100` `DIR-103` | 6 / 6 | **08-02 05:54** |

**全部早于无人值守窗口起点（2026-08-02T17:43Z）至少 12 小时。**

**窗口内产生的新 needs-human 任务：0 个**（逐文件按 git 提交时刻核对）。
遥测里唯一那条 `needs-human` 结局（`gap-test-suite-has-no-layer-grouping`）
现在的 status 是 **done**——已消解。

### 停止条件本身的缺陷

`fast-mode-loop-tick.md:156` 的「needs-human 积压 ≥ 3」是**纯散文，无任何代码实现**
（已 grep `plugin/scripts` 与 `experiments/**/scripts`，零命中）。

**它的意图**是「内层产出 needs-human 的速度超过消解速度，该停」；
**它被读成**「仓库里 needs-human 的总数，有史以来」。
按后者，**7 个历史任务会永久卡死派发**——没有任何新工作能解开它，因为解开它需要派发。

**修法**：判据改为**窗口内新增**的 needs-human 数，而不是总数。
`fast-mode-loop-tick.md` 正被在飞的 `gap-dispatch-gate` 占用，
**把这条改动并进那个任务，或等它落地后再改**。

### 立即行动

1. **恢复派发。** 下一批第一个是 `gap-no-inventory-of-what-the-two-layer-mode-actually-runs`（人裁定优先）。
2. 那 7 个 DIR 任务**不在本轮处理**——它们的去留是范围决定，已升级给人（见 `orchestration/escalations.md`）。

## 外层重排队列优先级（2026-08-03T04:01:53Z，人裁定按几何诊断调整）

### 诊断（依据 `docs/references` 的框架 + 实测）

| 量 | 值 |
|---|---|
| 近 18 小时 扩张 : 收敛 | **3 : 21** |
| 任务图今日 新增 : 删除节点 | **22 : 0** |
| 脚本 live : unaccounted | **35 : 81**（共 205） |
| 内层 tick 文档 决策性语句 : 有真执行者 | **36 : 7（硬形变 19%）** |

框架对收敛的定义是「用更低描述长度的机制替换更高描述长度的机制」，且**支柱化与断言加固
是收敛的内在两半**。我们只产出了断言：**L(X) 在上升**。

**⇒ 我们自以为在收敛，几何上仍在元层扩张。删除算子一个都没跑完过，这张图从未收缩过一次。**

### 优先级

**P0 — 删除算子（让图第一次收缩）**

| 序 | 任务 | 状态 | 说明 |
|---|---|---|---|
| 1 | `gap-no-inventory-of-what-the-two-layer-mode-actually-runs` | **在飞** | 同时在**裁剪**与**冷启动产品化**两条关键路径上——不知道哪 35 个脚本活着，就答不出「新项目要装什么」 |
| 2 | `gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion` | **在飞** | 第一次真实删除；1.1G / 21 worktree |
| 3 | `gap-retire-the-prepare-execute-pipeline-cluster` | 待 | **依赖 #1**，直接读它的 `class` 列 |
| 4 | `gap-stranded-worktree-branches-have-no-alarm-channel` | 待 | 与 #2 同域，#2 落地后再排 |

**P1 — 异步通道（消解「必须提问才能知道现在在跑什么」）**

| 序 | 任务 | 说明 |
|---|---|---|
| 5 | `gap-serve-task-list-dies-on-one-malformed-task` | **人正在使用该页面**；再来一个畸形任务就再 500 一次。活面上的缺陷优先 |
| 6 | `gap-web-cannot-show-what-the-loop-is-doing-now` | `/live` + `/journal`——人不该为了知道现状而提问 |
| 7 | `gap-web-board-needs-an-inconsistency-verdict-it-does-not-have` | 需先回答复用/重实现的架构问题 |

**P2 — 暂缓：一切「再加检查」类任务**

`quantified-stop-conditions`、`test-isolation-contract`、`checks-that-verify-an-empty-set`、
`no-resource-awareness`、`workflow-metadata-warn-omissions`、`plancheck-*`、
`prepare-milestone-no-size-aware-routing-*` 等。

**理由不是它们不重要，是在删除算子跑通之前，每加一个检查都让 L(X) 继续上升。**

**例外（可作填充，排在 P0/P1 之后）**：**生产机制正在给错答案**的既有缺陷，不是新增检查——
`gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet`（`assembleBatch` 对新文件任务
误判串行且理由说错）、`gap-inner-forensics-verify-reports-nonruns-and-zero-durations`
（外层唯一的廉价核实手段在说谎）。**仅当 P0/P1 因 Touches 冲突派不出时才取这两个。**

### 解冻判据（可测，不靠判断）

**冻结在「任务图第一次收缩」时解除。** 判据二选一，任一成立即可：

```bash
# (a) 有任务节点被删除
git log --diff-filter=D --since='<冻结时刻>' --name-only --format= -- 'tasks/*.md' | sort -u | grep -c .
# (b) 有一次落地提交的净行数为负（删多于增）
git log --since='<冻结时刻>' --numstat --format='%H' | awk '...'  # 净 delta < 0
```

冻结时刻 = 2026-08-03T04:01:53Z。**解冻后重新评估，不自动恢复原顺序。**

### 不做

不撤销任何已建任务、不改任何任务的 `status`、不删任务。**这是排序，不是取消。**
被暂缓的任务全部保留在队列里，等图收缩后重新评估。

### P2 提升触发条件（外层 2026-08-03 04:0xZ 记录，不是立即反悔）

排定优先级 10 分钟后，同一条件第二次咬人：两个全量套件在两个 worktree 里并发，
CPU 压力 **96.62**（批 4 崩溃时只有 84.77）。

**我把 `gap-no-resource-awareness-heavy-ops-run-blind` 归为「再加检查」可能是分类错的。**
资源闸是**两层共用的原语，取代重复的目测判断**——按框架这更接近**支柱化**，
而支柱化是收敛的内在一半，不是又一个断言。

**但不在 10 分钟内推翻自己的排序。** 改为设一个明确触发条件：

> 若（a）同一条件再发生一次，或（b）当前这两次套件出现 `cancelled > 0`，
> 则 `gap-no-resource-awareness-heavy-ops-run-blind` 提升到 **P1**，排在 web 观察面之前。

在此之前它仍在 P2。**触发条件是可观察的，不靠印象。**

## 触发条件已满足，`gap-no-resource-awareness-heavy-ops-run-blind` 提升到 P1（2026-08-03T04:24:46Z）

**不是推翻上一条排序，是实测把结论从「偶发」升级为「结构性」。**

上一条写的触发条件是「同一条件再发生一次」，隐含假设是**两个套件并发**才导致饥饿。
2026-08-03T04:24:46Z 实测推翻了这个假设：

```
套件根 pid 3995110（唯一一个在跑）
  worker 8 · worker 的子进程 7 · 根 1  ⇒  该套件独占 16 个进程
  nproc = 4  ⇒  单个套件自己就是 4× 超订
  cpu some avg10 = 87.15（两个套件并发时是 96.62）
```

**⇒ 饥饿不是并发的产物，是「跑一次全量套件」的稳态。** 两个并发只是把 87 推到 97。

**这直接打在 P0 上**：删除算子的每个任务 DoD 都要求「`scripts/test.sh` 连跑 2 次全绿」，
即每个 P0 任务都要**至少两次**进入饥饿态。今晚已经因此耗掉：M136 三轮、
批 4 崩溃一次、reclaim/test-isolation 各一次重跑。

**分类修正**：我把它归为「再加检查」是错的。资源闸是**两层共用的原语，取代重复的目测判断**，
按框架属于**支柱化**——收敛的内在一半，不是又一个断言。

**新顺序**：P0 三个删除算子不变；**P1 首位改为 `gap-no-resource-awareness-heavy-ops-run-blind`**，
其后才是 serve 崩溃修复与 web 观察面。理由是它**降低 P0 自身的执行成本**，
而 web 观察面不改变 P0 的成本。

### 同时：inventory 的结果改变了 retire 的判断

inventory 已完成（AC 全勾，在 fan-in）：**205 脚本 · live 36 · library 72 · ci-only 1 ·
dormant 7 · never-runs-test 8 · unaccounted 81**。

**但 AC7 的窗口差集是关键**：51 个脚本在 15.9h 窗口是低频、在 72h 窗口是 live，
**其中 31 个从 unaccounted 变成 live** ⇒ **真实的 unaccounted 约 50，不是 81**。

**对 [[gap-retire-the-prepare-execute-pipeline-cluster]] 的直接后果**：
`.claude/workflows/*.js` 6 个在 15.9h 窗口全部 unaccounted，
**但 72h 窗口 5 个 live——`prepare-milestone` 被调用 280 次、`execute-milestone` 47 次**。

**经典循环在用它，只是 fast-mode 有意绕过。** 这不是「已死」，是「本模式不用」。
retire 任务必须按 72h 窗口重新评估其规模主张（任务体现在写的是「最后一条 prepare-epoch 是 22 小时前」——
那个观察本身没错，但它只覆盖 fast-mode 一侧）。

## 解冻判据的盲区（外层自查，2026-08-03T04:46:46Z）

**我在 03:56Z 设的解冻判据看不见刚刚真实发生的那次收缩。**

判据原文：

> (a) 有任务节点被删除，或 (b) 有一次落地提交的净行数为负

实际发生的收缩：`reclaim` 回收了 **M277 + M243** 的分支与 worktree，
`milestones/M277` 从约 51MB 降到 **1MB**。

**判据两条都没被触发**：

| 为什么 | 实测 |
|---|---|
| (a) 没有任务节点被删——删的是分支与 worktree 目录 | 删除的 `tasks/*.md`：**0** |
| (b) `git log --numstat` 看不见 worktree 目录的删除 | `milestones/M*/worktrees` **在 `.gitignore` 里**（`git check-ignore` 确认），删除不产生任何 diff |

**⇒ 判据的名字说「图收缩了」，实际测的是「被 git 跟踪的行数减少了」。**
这是今晚同一个失效族的又一个成员，而这次是**我自己在 50 分钟前造的**。

### 修正：加第三条

```bash
# (c) 物理收缩：worktree 条目数、milestone 分支数、或 milestones/ 占用（MB）任一下降
git worktree list | wc -l              # 冻结时 22
git branch --list 'milestone/*' | wc -l # 冻结时 20
du -sm milestones | cut -f1             # 冻结时 1100 MB
```

**当前读数**：worktree 23（新增一个给 retire 用）· 分支 20 · **milestones/ 1033 MB（-67 MB）**。

**⇒ 判据 (c) 已满足：milestones/ 从 1100 MB 降到 1033 MB。图第一次收缩了。**

但收缩幅度很小（-6%），且**真正的 1.1G 大头仍被那 19 个含未落地工作的 worktree 占着**，
等人对 34 项工作的裁定。

**因此：解冻，但不恢复原顺序。** 按 03:56Z 写下的「解冻后重新评估」执行：

| 序 | 任务 | 理由 |
|---|---|---|
| 1 | `gap-no-resource-awareness-heavy-ops-run-blind` | 已是 P1 首位；今晚第三次同一根因抬高不同信号（重型超时 / 两套件并发 / OVER90 假触发） |
| 2 | `gap-retire-the-prepare-execute-pipeline-cluster` | **在飞**，且已被外层限定边界（不得动 worktree） |
| 3 | `gap-serve-task-list-dies-on-one-malformed-task` | 人正在用该页面 |
| 4 | `gap-web-cannot-show-what-the-loop-is-doing-now` | 异步通道 |

**P2 冻结解除**，其余任务恢复正常排队，但排在上面四个之后。
