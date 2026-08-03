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
